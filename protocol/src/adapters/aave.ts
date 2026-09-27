import { buildSourceMetadata } from "../services/source-metadata.js";
import { OpportunityMarketRecord } from "../types/opportunity.js";
import {
  BASE_CHAIN_ID,
  isEvmAddress,
  isNativeEthAsset,
  normalizeEvmAddress
} from "../execution/evm.js";
import { isOfflineTestRuntime } from "./offline-test-runtime.js";

export const DEFAULT_AAVE_GRAPHQL_URL = "https://api.v3.aave.com/graphql";
export const AAVE_V3_BASE_POOL = "0xa238dd80c259a72e81d7e4664a9801593f98d1c5";
export const AAVE_LENDING_OPPORTUNITY_ID_PREFIX = "aave-lending-";

const REQUEST_TIMEOUT_MS = 8_000;

const RESERVES_QUERY = `
query AaveV3BaseReserves {
  markets(request: { chainIds: [${BASE_CHAIN_ID}] }) {
    address
    chain { chainId }
    reserves {
      underlyingToken { address symbol decimals }
      aToken { address }
      vToken { address }
      isFrozen
      isPaused
      usdExchangeRate
      size { usd }
      supplyInfo {
        apy { value }
        maxLTV { value }
        liquidationThreshold { value }
      }
      borrowInfo {
        apy { value }
        utilizationRate { value }
        borrowingState
      }
    }
  }
}
`;

export interface AavePercentValue {
  value?: string | number | null;
}

export interface AaveTokenRef {
  address?: string | null;
  symbol?: string | null;
  decimals?: number | null;
}

export interface AaveReserveItem {
  underlyingToken?: AaveTokenRef | null;
  aToken?: AaveTokenRef | null;
  vToken?: AaveTokenRef | null;
  isFrozen?: boolean | null;
  isPaused?: boolean | null;
  usdExchangeRate?: string | number | null;
  size?: { usd?: string | number | null } | null;
  supplyInfo?: {
    apy?: AavePercentValue | null;
    maxLTV?: AavePercentValue | null;
    liquidationThreshold?: AavePercentValue | null;
  } | null;
  borrowInfo?: {
    apy?: AavePercentValue | null;
    utilizationRate?: AavePercentValue | null;
    borrowingState?: string | null;
  } | null;
}

export interface AaveReserveSnapshot {
  underlying: string;
  symbol: string;
  decimals: number;
  aToken: string;
  variableDebtToken: string;
  usdPerToken: number | null;
}

interface AaveMarketsQueryResponse {
  data?: {
    markets?: Array<{
      address?: string | null;
      chain?: { chainId?: number | string | null } | null;
      reserves?: AaveReserveItem[] | null;
    }> | null;
  };
  errors?: Array<{ message?: string }>;
}

export class AaveAdapterError extends Error {
  public readonly cause?: unknown;

  public constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "AaveAdapterError";
    this.cause = cause;
  }
}

export interface AaveAdapterDependencies {
  fetchImpl: typeof fetch;
  graphqlUrl: string;
}

let dependencyOverrides: Partial<AaveAdapterDependencies> | undefined;

export function setAaveAdapterDependenciesForTests(
  overrides?: Partial<AaveAdapterDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): AaveAdapterDependencies {
  const configuredUrl = process.env.AAVE_GRAPHQL_URL?.trim();
  const skipLiveCatalog =
    dependencyOverrides === undefined &&
    (configuredUrl === undefined || configuredUrl.length === 0) &&
    isOfflineTestRuntime();

  return {
    fetchImpl: skipLiveCatalog ? rejectLiveAaveCatalog : fetch,
    graphqlUrl: configuredUrl && configuredUrl.length > 0
      ? configuredUrl
      : DEFAULT_AAVE_GRAPHQL_URL,
    ...dependencyOverrides
  };
}

async function rejectLiveAaveCatalog(): Promise<Response> {
  throw new AaveAdapterError(
    "AAVE_GRAPHQL_URL is not configured; live Aave catalog is disabled in CI/tests."
  );
}

export function aaveLendingOpportunityId(underlying: string): string {
  return `${AAVE_LENDING_OPPORTUNITY_ID_PREFIX}${normalizeEvmAddress(underlying)}`;
}

export function parseAaveUnderlyingAddress(opportunityId: string): string | null {
  if (!opportunityId.startsWith(AAVE_LENDING_OPPORTUNITY_ID_PREFIX)) {
    return null;
  }
  const address = opportunityId.slice(AAVE_LENDING_OPPORTUNITY_ID_PREFIX.length);
  return isEvmAddress(address) ? normalizeEvmAddress(address) : null;
}

export async function fetchAaveOpportunities(
  fetchImpl?: typeof fetch
): Promise<OpportunityMarketRecord[]> {
  const deps = resolveDependencies();
  const fetchedAt = new Date().toISOString();
  const reserves = await fetchAaveMarketReserves(fetchImpl ?? deps.fetchImpl, deps.graphqlUrl);
  return reserves.flatMap((entry) => {
    const normalized = normalizeAaveReserve(entry.reserve, fetchedAt, {
      chainId: entry.chainId
    });
    return normalized === null ? [] : [normalized];
  });
}

export async function fetchAaveReserveSnapshots(
  fetchImpl?: typeof fetch
): Promise<AaveReserveSnapshot[]> {
  const deps = resolveDependencies();
  const reserves = await fetchAaveMarketReserves(fetchImpl ?? deps.fetchImpl, deps.graphqlUrl);
  const snapshots: AaveReserveSnapshot[] = [];
  for (const entry of reserves) {
    if (entry.chainId !== BASE_CHAIN_ID) {
      continue;
    }
    const snapshot = toReserveSnapshot(entry.reserve);
    if (snapshot !== null) {
      snapshots.push(snapshot);
    }
  }
  return snapshots;
}

export function normalizeAaveReserve(
  item: AaveReserveItem,
  fetchedAtIso: string = new Date().toISOString(),
  options: { chainId?: number } = {}
): OpportunityMarketRecord | null {
  if (options.chainId !== undefined && options.chainId !== BASE_CHAIN_ID) {
    return null;
  }
  if (item.isFrozen === true || item.isPaused === true) {
    return null;
  }

  const snapshot = toReserveSnapshot(item);
  if (snapshot === null || isNativeEthAsset(snapshot.underlying)) {
    return null;
  }

  const supplyApy = percentFromFraction(item.supplyInfo?.apy?.value);
  const tvlUsd = toNumber(item.size?.usd);
  if (supplyApy === null || tvlUsd === null || tvlUsd <= 0) {
    return null;
  }

  const borrowingEnabled = item.borrowInfo?.borrowingState === "ENABLED";
  if (supplyApy === 0 && !borrowingEnabled) {
    return null;
  }

  const borrowApr = borrowingEnabled
    ? percentFromFraction(item.borrowInfo?.apy?.value)
    : null;
  const utilization = percentFromFraction(item.borrowInfo?.utilizationRate?.value);
  const ltv = percentFromFraction(item.supplyInfo?.maxLTV?.value);
  const liquidationThreshold = percentFromFraction(
    item.supplyInfo?.liquidationThreshold?.value
  );

  const notes = [
    `${snapshot.symbol} on Aave V3 Base`,
    borrowingEnabled ? null : "borrowing disabled"
  ]
    .filter((part): part is string => part !== null)
    .join("; ");

  return {
    protocol: "aave",
    opportunityType: "lending",
    opportunityId: aaveLendingOpportunityId(snapshot.underlying),
    assetPair: snapshot.symbol,
    chain: "base",
    assetAddresses: [snapshot.underlying],
    poolId: snapshot.underlying,
    apy: supplyApy,
    yieldBasis: "apy",
    tvlUsd,
    ...(borrowApr === null ? {} : { borrowApr }),
    ...buildSourceMetadata({
      fetchedAtIso,
      contextNotes: [notes]
    }),
    risk: {
      ...(utilization === null ? {} : { utilization }),
      ...(ltv === null ? {} : { ltv }),
      ...(liquidationThreshold === null ? {} : { liquidationThreshold }),
      ...(borrowApr === null ? {} : { borrowApr })
    }
  };
}

async function fetchAaveMarketReserves(
  fetchImpl: typeof fetch,
  graphqlUrl: string
): Promise<Array<{ chainId: number; reserve: AaveReserveItem }>> {
  const payload = await postGraphql(fetchImpl, graphqlUrl);
  const markets = payload.data?.markets;
  if (!Array.isArray(markets)) {
    throw new AaveAdapterError("Aave GraphQL returned an unexpected payload shape.");
  }

  const market = markets.find(
    (entry) =>
      typeof entry.address === "string" &&
      normalizeEvmAddress(entry.address) === AAVE_V3_BASE_POOL
  );
  if (market === undefined) {
    throw new AaveAdapterError("Aave GraphQL did not return the Base V3 market.");
  }

  const chainId = toNumber(market.chain?.chainId);
  if (chainId !== BASE_CHAIN_ID) {
    throw new AaveAdapterError("Aave Base market chain id was not 8453.");
  }

  const reserves = market.reserves;
  if (!Array.isArray(reserves)) {
    throw new AaveAdapterError("Aave GraphQL returned an unexpected reserve list.");
  }
  return reserves.map((reserve) => ({ chainId, reserve }));
}

async function postGraphql(
  fetchImpl: typeof fetch,
  graphqlUrl: string
): Promise<AaveMarketsQueryResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(graphqlUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: RESERVES_QUERY }),
      signal: controller.signal
    });
    if (!response.ok) {
      throw new AaveAdapterError(
        `Aave GraphQL returned non-2xx status: ${response.status}`
      );
    }
    const payload = (await response.json()) as AaveMarketsQueryResponse;
    if (payload.errors && payload.errors.length > 0) {
      throw new AaveAdapterError(
        payload.errors[0]?.message ?? "Aave GraphQL returned errors."
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof AaveAdapterError) {
      throw error;
    }
    throw new AaveAdapterError("Aave adapter request failed.", error);
  } finally {
    clearTimeout(timeout);
  }
}

function toReserveSnapshot(item: AaveReserveItem): AaveReserveSnapshot | null {
  const underlying =
    typeof item.underlyingToken?.address === "string" ? item.underlyingToken.address : "";
  const aToken = typeof item.aToken?.address === "string" ? item.aToken.address : "";
  const variableDebt =
    typeof item.vToken?.address === "string" ? item.vToken.address : "";
  if (!isEvmAddress(underlying) || !isEvmAddress(aToken) || !isEvmAddress(variableDebt)) {
    return null;
  }
  const decimals = item.underlyingToken?.decimals;
  if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0) {
    return null;
  }
  const symbol =
    typeof item.underlyingToken?.symbol === "string" &&
    item.underlyingToken.symbol.trim().length > 0
      ? item.underlyingToken.symbol.trim()
      : "unknown";
  return {
    underlying: normalizeEvmAddress(underlying),
    symbol,
    decimals,
    aToken: normalizeEvmAddress(aToken),
    variableDebtToken: normalizeEvmAddress(variableDebt),
    usdPerToken: toNumber(item.usdExchangeRate)
  };
}

function percentFromFraction(value: number | string | null | undefined): number | null {
  const fraction = toNumber(value);
  if (fraction === null) {
    return null;
  }
  return fraction * 100;
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
