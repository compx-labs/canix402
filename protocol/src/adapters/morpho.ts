import { buildSourceMetadata } from "../services/source-metadata.js";
import { OpportunityMarketRecord } from "../types/opportunity.js";
import {
  BASE_CHAIN_ID,
  isEvmAddress,
  isNativeEthAsset,
  normalizeEvmAddress
} from "../execution/evm.js";
import { isOfflineTestRuntime } from "./offline-test-runtime.js";

export const DEFAULT_MORPHO_GRAPHQL_URL = "https://api.morpho.org/graphql";
export const MORPHO_VAULT_OPPORTUNITY_ID_PREFIX = "morpho-vault-";

const PAGE_SIZE = 100;
const REQUEST_TIMEOUT_MS = 8_000;

const VAULTS_QUERY_LISTED = `
query BaseListedVaults($first: Int!, $skip: Int!) {
  vaults(
    first: $first
    skip: $skip
    where: { chainId_in: [${BASE_CHAIN_ID}], listed: true }
  ) {
    items {
      address
      chain { id }
      name
      symbol
      listed
      asset { address symbol decimals }
      state { apy netApy totalAssetsUsd fee }
    }
  }
}
`;

const VAULTS_QUERY_ALL = `
query BaseVaults($first: Int!, $skip: Int!) {
  vaults(
    first: $first
    skip: $skip
    where: { chainId_in: [${BASE_CHAIN_ID}] }
  ) {
    items {
      address
      chain { id }
      name
      symbol
      listed
      asset { address symbol decimals }
      state { apy netApy totalAssetsUsd fee }
    }
  }
}
`;

export interface MorphoVaultAsset {
  address?: string | null;
  symbol?: string | null;
  decimals?: number | null;
}

export interface MorphoVaultState {
  apy?: number | string | null;
  netApy?: number | string | null;
  totalAssetsUsd?: number | string | null;
  fee?: number | string | null;
}

export interface MorphoVaultItem {
  address?: string | null;
  chain?: { id?: number | string | null } | null;
  name?: string | null;
  symbol?: string | null;
  listed?: boolean | null;
  asset?: MorphoVaultAsset | null;
  state?: MorphoVaultState | null;
}

interface MorphoVaultsQueryResponse {
  data?: {
    vaults?: {
      items?: MorphoVaultItem[] | null;
    } | null;
  };
  errors?: Array<{ message?: string }>;
}

export class MorphoAdapterError extends Error {
  public readonly cause?: unknown;

  public constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "MorphoAdapterError";
    this.cause = cause;
  }
}

export interface MorphoAdapterDependencies {
  fetchImpl: typeof fetch;
  graphqlUrl: string;
  onlyListed: boolean;
}

let dependencyOverrides: Partial<MorphoAdapterDependencies> | undefined;

export function setMorphoAdapterDependenciesForTests(
  overrides?: Partial<MorphoAdapterDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): MorphoAdapterDependencies {
  const configuredUrl = process.env.MORPHO_GRAPHQL_URL?.trim();
  const skipLiveCatalog =
    dependencyOverrides === undefined &&
    (configuredUrl === undefined || configuredUrl.length === 0) &&
    isOfflineTestRuntime();

  return {
    fetchImpl: skipLiveCatalog ? rejectLiveMorphoCatalog : fetch,
    graphqlUrl: configuredUrl && configuredUrl.length > 0
      ? configuredUrl
      : DEFAULT_MORPHO_GRAPHQL_URL,
    onlyListed: process.env.MORPHO_ONLY_LISTED !== "false",
    ...dependencyOverrides
  };
}

async function rejectLiveMorphoCatalog(): Promise<Response> {
  throw new MorphoAdapterError(
    "MORPHO_GRAPHQL_URL is not configured; live Morpho catalog is disabled in CI/tests."
  );
}

export function morphoVaultOpportunityId(vaultAddress: string): string {
  return `${MORPHO_VAULT_OPPORTUNITY_ID_PREFIX}${normalizeEvmAddress(vaultAddress)}`;
}

export function parseMorphoVaultAddress(opportunityId: string): string | null {
  if (!opportunityId.startsWith(MORPHO_VAULT_OPPORTUNITY_ID_PREFIX)) {
    return null;
  }
  const address = opportunityId.slice(MORPHO_VAULT_OPPORTUNITY_ID_PREFIX.length);
  return isEvmAddress(address) ? normalizeEvmAddress(address) : null;
}

export async function fetchMorphoOpportunities(
  fetchImpl?: typeof fetch
): Promise<OpportunityMarketRecord[]> {
  const deps = resolveDependencies();
  const fetchFn = fetchImpl ?? deps.fetchImpl;
  const fetchedAt = new Date().toISOString();
  const items: MorphoVaultItem[] = [];

  for (let skip = 0; ; skip += PAGE_SIZE) {
    const page = await fetchVaultPage(deps.graphqlUrl, fetchFn, skip, deps.onlyListed);
    items.push(...page);
    if (page.length < PAGE_SIZE) {
      break;
    }
  }

  return items.flatMap((item) => {
    const normalized = normalizeMorphoVault(item, fetchedAt, { onlyListed: deps.onlyListed });
    return normalized === null ? [] : [normalized];
  });
}

export function normalizeMorphoVault(
  item: MorphoVaultItem,
  fetchedAtIso: string = new Date().toISOString(),
  options: { onlyListed?: boolean } = {}
): OpportunityMarketRecord | null {
  const onlyListed = options.onlyListed !== false;
  if (onlyListed && item.listed !== true) {
    return null;
  }

  const chainId = toNumber(item.chain?.id);
  if (chainId !== BASE_CHAIN_ID) {
    return null;
  }

  const vaultAddress = typeof item.address === "string" ? item.address : "";
  const assetAddress =
    typeof item.asset?.address === "string" ? item.asset.address : "";
  if (!isEvmAddress(vaultAddress) || !isEvmAddress(assetAddress)) {
    return null;
  }
  if (isNativeEthAsset(assetAddress)) {
    return null;
  }

  const netApyFraction = toNumber(item.state?.netApy);
  const tvlUsd = toNumber(item.state?.totalAssetsUsd);
  if (netApyFraction === null || tvlUsd === null || tvlUsd <= 0) {
    return null;
  }

  const assetSymbol =
    typeof item.asset?.symbol === "string" && item.asset.symbol.trim().length > 0
      ? item.asset.symbol.trim()
      : "unknown";
  const vaultName =
    typeof item.name === "string" && item.name.trim().length > 0
      ? item.name.trim()
      : typeof item.symbol === "string" && item.symbol.trim().length > 0
        ? item.symbol.trim()
        : "Morpho vault";
  const feeFraction = toNumber(item.state?.fee);
  const grossApy = toNumber(item.state?.apy);

  const notes = [
    vaultName,
    feeFraction === null ? null : `curator fee ${formatPercent(feeFraction)}`
  ]
    .filter((part): part is string => part !== null)
    .join("; ");

  return {
    protocol: "morpho",
    opportunityType: "lending",
    opportunityId: morphoVaultOpportunityId(vaultAddress),
    assetPair: assetSymbol,
    chain: "base",
    assetAddresses: [normalizeEvmAddress(assetAddress)],
    poolId: normalizeEvmAddress(vaultAddress),
    apy: netApyFraction * 100,
    yieldBasis: "apy",
    tvlUsd,
    ...(grossApy === null ? {} : { apr: grossApy * 100 }),
    ...buildSourceMetadata({
      fetchedAtIso,
      contextNotes: [notes]
    })
  };
}

async function fetchVaultPage(
  graphqlUrl: string,
  fetchImpl: typeof fetch,
  skip: number,
  onlyListed: boolean
): Promise<MorphoVaultItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchImpl(graphqlUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: onlyListed ? VAULTS_QUERY_LISTED : VAULTS_QUERY_ALL,
        variables: {
          first: PAGE_SIZE,
          skip
        }
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      throw new MorphoAdapterError(
        `Morpho GraphQL returned non-2xx status: ${response.status}`
      );
    }

    const payload = (await response.json()) as MorphoVaultsQueryResponse;
    if (payload.errors && payload.errors.length > 0) {
      throw new MorphoAdapterError(
        payload.errors[0]?.message ?? "Morpho GraphQL returned errors."
      );
    }

    const items = payload.data?.vaults?.items;
    if (!Array.isArray(items)) {
      throw new MorphoAdapterError("Morpho GraphQL returned an unexpected payload shape.");
    }
    return items;
  } catch (error) {
    if (error instanceof MorphoAdapterError) {
      throw error;
    }
    throw new MorphoAdapterError("Morpho adapter request failed.", error);
  } finally {
    clearTimeout(timeout);
  }
}

function toNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatPercent(fraction: number): string {
  const percent = fraction * 100;
  const rounded = Number.isInteger(percent)
    ? String(percent)
    : percent.toFixed(2).replace(/\.?0+$/, "");
  return `${rounded}%`;
}
