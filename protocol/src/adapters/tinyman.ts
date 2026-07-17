import algosdk, { Algodv2 } from "algosdk";
import { TinymanTAlgoClient } from "@tinymanorg/tinyman-js-sdk";

import {
  CONSENSUS_PAYOUT_FEE_PERCENT,
  estimateConsensusStakingApr,
  type ConsensusStakingAprEstimate
} from "../services/consensus-staking-apr.js";
import { buildSourceMetadata } from "../services/source-metadata.js";
import { OpportunityMarketRecord } from "../types/opportunity.js";

/** Mainnet tALGO ASA (Tinyman liquid staking). */
const TALGO_MAINNET_ASSET_ID = 2537013734;

interface TinymanPoolApiRecord {
  address?: string;
  version?: string;
  is_verified?: boolean | null;
  annual_percentage_rate?: number | string | null;
  annual_percentage_yield?: number | string | null;
  total_annual_percentage_rate?: number | string | null;
  total_annual_percentage_yield?: number | string | null;
  staking_total_annual_percentage_rate?: number | string | null;
  staking_total_annual_percentage_yield?: number | string | null;
  liquidity_in_usd?: number | string | null;
  is_stable?: boolean | null;
  asset_1?: { id?: number | string | null; unit_name?: string | null; name?: string | null };
  asset_2?: { id?: number | string | null; unit_name?: string | null; name?: string | null };
}

interface TinymanApiResponse {
  results?: TinymanPoolApiRecord[];
}

interface TinymanAssetApiRecord {
  price_in_usd?: number | string | null;
}

/** Tinyman deducts 8% of consensus block rewards before accruing into tALGO. */
export const TINYMAN_LIQUID_STAKE_PROTOCOL_FEE = 0.08;
export const TINYMAN_TALGO_STAKING_OPPORTUNITY_ID = "tinyman-staking-talgo";

export class TinymanAdapterError extends Error {
  public readonly cause?: unknown;

  public constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "TinymanAdapterError";
    this.cause = cause;
  }
}

interface TinymanAdapterDependencies {
  estimateConsensusApr: () => Promise<ConsensusStakingAprEstimate>;
  createAlgodClient: () => Algodv2;
  getTAlgoCirculatingSupply: (algod: Algodv2) => Promise<bigint>;
  getAlgoToTAlgoRatio: (algod: Algodv2) => Promise<number>;
  fetchAlgoUsdPrice: (fetchImpl: typeof fetch) => Promise<number | null>;
}

let tinymanDependencyOverrides: Partial<TinymanAdapterDependencies> | undefined;

export function setTinymanAdapterDependenciesForTests(
  overrides?: Partial<TinymanAdapterDependencies>
): void {
  tinymanDependencyOverrides = overrides;
}

function resolveTinymanDependencies(): TinymanAdapterDependencies {
  return {
    estimateConsensusApr: () => estimateConsensusStakingApr(),
    createAlgodClient: createTinymanAlgodClient,
    getTAlgoCirculatingSupply: async (algod) => {
      const client = new TinymanTAlgoClient(algod, "mainnet");
      return client.getCirculatingSupply();
    },
    getAlgoToTAlgoRatio: async (algod) => {
      const client = new TinymanTAlgoClient(algod, "mainnet");
      return client.getRatio();
    },
    fetchAlgoUsdPrice: fetchTinymanAlgoUsdPrice,
    ...tinymanDependencyOverrides
  };
}

export async function fetchTinymanOpportunities(
  fetchImpl: typeof fetch = fetch
): Promise<OpportunityMarketRecord[]> {
  const baseUrl =
    process.env.TINYMAN_API_BASE_URL ?? "https://mainnet.analytics.tinyman.org/api/v1";
  const apiKey = process.env.TINYMAN_API_KEY;
  const query = new URLSearchParams({
    with_statistics: "true",
    limit: process.env.TINYMAN_POOL_LIMIT ?? "100"
  });
  const versions = parseVersions(process.env.TINYMAN_POOL_VERSIONS ?? "2.0");
  for (const version of versions) {
    query.append("version__in", version);
  }
  const requestUrl = `${trimTrailingSlash(baseUrl)}/pools/?${query.toString()}`;
  const fetchedAt = new Date().toISOString();
  const onlyVerified = parseBoolean(process.env.TINYMAN_ONLY_VERIFIED, true);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const requestInit: RequestInit = {
      signal: controller.signal
    };
    if (apiKey) {
      requestInit.headers = { authorization: `Bearer ${apiKey}` };
    }

    const [poolResponse, stakingOpportunity] = await Promise.all([
      fetchImpl(requestUrl, {
        ...requestInit
      }),
      fetchTinymanTAlgoStakingOpportunity(fetchImpl, fetchedAt).catch(() => null)
    ]);

    if (!poolResponse.ok) {
      throw new TinymanAdapterError(
        `Tinyman API returned non-2xx status: ${poolResponse.status}`
      );
    }

    const payload = (await poolResponse.json()) as TinymanApiResponse;
    const records = payload.results ?? [];

    const poolOpportunities = records
      .filter((record) => (onlyVerified ? record.is_verified === true : true))
      .flatMap((record) => normalizeTinymanPoolOpportunities(record, fetchedAt));

    if (stakingOpportunity !== null) {
      return [...poolOpportunities, stakingOpportunity];
    }
    return poolOpportunities;
  } catch (error) {
    if (error instanceof TinymanAdapterError) {
      throw error;
    }

    throw new TinymanAdapterError("Tinyman adapter request failed.", error);
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchTinymanTAlgoStakingOpportunity(
  fetchImpl: typeof fetch = fetch,
  fetchedAtIso: string = new Date().toISOString()
): Promise<OpportunityMarketRecord | null> {
  const dependencies = resolveTinymanDependencies();

  try {
    const algod = dependencies.createAlgodClient();
    const [consensus, circulatingSupply, algoToTAlgoRatio, algoUsdPrice] =
      await Promise.all([
        dependencies.estimateConsensusApr(),
        dependencies.getTAlgoCirculatingSupply(algod),
        dependencies.getAlgoToTAlgoRatio(algod),
        dependencies.fetchAlgoUsdPrice(fetchImpl)
      ]);

    return normalizeTinymanTAlgoStakingOpportunity({
      consensusApr: consensus.apr,
      circulatingSupply,
      algoToTAlgoRatio,
      algoUsdPrice,
      sampleSize: consensus.sampleSize,
      fetchedAtIso
    });
  } catch {
    return null;
  }
}

export function normalizeTinymanTAlgoStakingOpportunity(input: {
  consensusApr: number;
  circulatingSupply: bigint;
  algoToTAlgoRatio: number;
  algoUsdPrice: number | null;
  sampleSize: number;
  fetchedAtIso: string;
}): OpportunityMarketRecord | null {
  const {
    consensusApr,
    circulatingSupply,
    algoToTAlgoRatio,
    algoUsdPrice,
    sampleSize,
    fetchedAtIso
  } = input;

  if (
    !Number.isFinite(consensusApr) ||
    consensusApr < 0 ||
    circulatingSupply <= 0n ||
    !(algoToTAlgoRatio > 0) ||
    !Number.isFinite(algoToTAlgoRatio) ||
    algoUsdPrice === null ||
    !(algoUsdPrice > 0)
  ) {
    return null;
  }

  const stakedAlgoBaseUnits = Number(circulatingSupply) * algoToTAlgoRatio;
  if (!Number.isFinite(stakedAlgoBaseUnits) || stakedAlgoBaseUnits <= 0) {
    return null;
  }

  const tvlUsd = (stakedAlgoBaseUnits / 1_000_000) * algoUsdPrice;
  const apy = consensusApr * (1 - TINYMAN_LIQUID_STAKE_PROTOCOL_FEE);
  if (!Number.isFinite(apy) || !Number.isFinite(tvlUsd) || tvlUsd <= 0) {
    return null;
  }

  return {
    protocol: "tinyman",
    opportunityType: "staking",
    opportunityId: TINYMAN_TALGO_STAKING_OPPORTUNITY_ID,
    assetPair: "ALGO/tALGO",
    assetIds: [0, TALGO_MAINNET_ASSET_ID],
    apy,
    yieldBasis: "apy",
    tvlUsd,
    apr: consensusApr,
    ...buildSourceMetadata({
      fetchedAtIso,
      contextNotes: [
        `Tinyman tALGO liquid staking. APY from Algorand consensus rewards ` +
          `(Foundation bonus + ${CONSENSUS_PAYOUT_FEE_PERCENT}% of fees) / online stake, net of Tinyman's ` +
          `${TINYMAN_LIQUID_STAKE_PROTOCOL_FEE * 100}% protocol fee. ` +
          `Fee share averaged over ${sampleSize} recent blocks.`
      ]
    })
  };
}

async function fetchTinymanAlgoUsdPrice(
  fetchImpl: typeof fetch
): Promise<number | null> {
  const baseUrl =
    process.env.TINYMAN_API_BASE_URL ?? "https://mainnet.analytics.tinyman.org/api/v1";
  const apiKey = process.env.TINYMAN_API_KEY;
  const requestUrl = `${trimTrailingSlash(baseUrl)}/assets/0/`;
  const requestInit: RequestInit = {};
  if (apiKey) {
    requestInit.headers = { authorization: `Bearer ${apiKey}` };
  }

  const response = await fetchImpl(requestUrl, requestInit);
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json()) as TinymanAssetApiRecord;
  return toNumber(payload.price_in_usd);
}

function createTinymanAlgodClient(): Algodv2 {
  const server = process.env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud";
  const token = process.env.X402_ALGOD_TOKEN ?? "";
  return new algosdk.Algodv2(token, trimTrailingSlash(server), "");
}

export function normalizeTinymanPool(
  record: TinymanPoolApiRecord,
  fetchedAtIso: string = new Date().toISOString()
): OpportunityMarketRecord | null {
  const sourceApy =
    toNumber(record.annual_percentage_yield) ??
    toNumber(record.total_annual_percentage_yield);
  const tvlUsd = toNumber(record.liquidity_in_usd);

  if (sourceApy === null || tvlUsd === null) {
    return null;
  }

  const sourceApr =
    toNumber(record.annual_percentage_rate) ??
    toNumber(record.total_annual_percentage_rate);
  // Tinyman's analytics API expresses annual yield/rate fields as decimal
  // fractions (0.280425 = 28.0425%). OpportunityMarketRecord uses percentage
  // points, consistent with the values displayed in Tinyman's UI.
  const apy = toPercentagePoints(sourceApy);
  const apr = sourceApr === null ? null : toPercentagePoints(sourceApr);
  const id = record.address ?? "";
  const pairName = buildPairName(record);
  const assetIds = buildAssetIds(record);
  const usedFallbackIdentifiers = id.length === 0 || pairName.length === 0;

  return {
    protocol: "tinyman",
    opportunityType: "lp",
    opportunityId: id.length > 0 ? `${id}:lp` : `tinyman-${pairName || "unknown"}:lp`,
    assetPair: pairName || "unknown/unknown",
    ...(assetIds.length > 0 ? { assetIds } : {}),
    apy,
    yieldBasis: "apy",
    tvlUsd,
    ...(apr !== null ? { apr } : {}),
    ...buildSourceMetadata({
      fetchedAtIso,
      usedFallbackIdentifiers
    })
  };
}

function normalizeTinymanPoolOpportunities(
  record: TinymanPoolApiRecord,
  fetchedAtIso: string
): OpportunityMarketRecord[] {
  const output: OpportunityMarketRecord[] = [];
  const lpOpportunity = normalizeTinymanPool(record, fetchedAtIso);
  if (lpOpportunity !== null) {
    output.push(lpOpportunity);
  }

  const farmOpportunity = normalizeTinymanFarm(record, fetchedAtIso);
  if (farmOpportunity !== null) {
    output.push(farmOpportunity);
  }

  return output;
}

function normalizeTinymanFarm(
  record: TinymanPoolApiRecord,
  fetchedAtIso: string
): OpportunityMarketRecord | null {
  const sourceStakingApy = toNumber(record.staking_total_annual_percentage_yield);
  const sourceStakingApr = toNumber(record.staking_total_annual_percentage_rate);
  const tvlUsd = toNumber(record.liquidity_in_usd);
  if (tvlUsd === null) {
    return null;
  }

  const hasFarmData =
    (sourceStakingApy !== null && sourceStakingApy > 0) ||
    (sourceStakingApr !== null && sourceStakingApr > 0);
  if (!hasFarmData) {
    return null;
  }
  const stakingApy =
    sourceStakingApy === null ? null : toPercentagePoints(sourceStakingApy);
  const stakingApr =
    sourceStakingApr === null ? null : toPercentagePoints(sourceStakingApr);

  const id = record.address ?? "";
  const pairName = buildPairName(record);
  const assetIds = buildAssetIds(record);
  const usedFallbackIdentifiers = id.length === 0 || pairName.length === 0;

  return {
    protocol: "tinyman",
    opportunityType: "farm",
    opportunityId: id.length > 0 ? `${id}:farm` : `tinyman-${pairName || "unknown"}:farm`,
    assetPair: pairName || "unknown/unknown",
    ...(assetIds.length > 0 ? { assetIds } : {}),
    apy: stakingApy ?? 0,
    yieldBasis: "apy",
    tvlUsd,
    ...(stakingApr !== null ? { apr: stakingApr } : {}),
    ...buildSourceMetadata({
      fetchedAtIso,
      usedFallbackIdentifiers
    })
  };
}

function buildAssetIds(record: TinymanPoolApiRecord): number[] {
  return [record.asset_1?.id, record.asset_2?.id]
    .map((value) => toAssetId(value))
    .filter((value): value is number => value !== null);
}

function toAssetId(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function buildPairName(record: TinymanPoolApiRecord): string {
  const left = record.asset_1?.unit_name ?? record.asset_1?.name;
  const right = record.asset_2?.unit_name ?? record.asset_2?.name;

  if (left && right) {
    return `${left}/${right}`;
  }
  if (left) {
    return `${left}/unknown`;
  }
  if (right) {
    return `unknown/${right}`;
  }

  return "";
}

function toNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toPercentagePoints(value: number): number {
  return value * 100;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function parseVersions(value: string): string[] {
  const versions = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return versions.length > 0 ? versions : ["2.0"];
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return defaultValue;
}
