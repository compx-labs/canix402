import { buildSourceMetadata } from "../services/source-metadata.js";
import { OpportunityRecordV1 } from "../types/opportunity.js";

interface PactPoolApiRecord {
  id?: number | string;
  on_chain_id?: number | string;
  tvl_usd?: number | string | null;
  apr_7d?: number | string | null;
  apr_7d_all?: number | string | null;
  is_verified?: boolean | null;
  primary_asset?: {
    algoid?: number | string | null;
    unit_name?: string | null;
    name?: string | null;
  };
  secondary_asset?: {
    algoid?: number | string | null;
    unit_name?: string | null;
    name?: string | null;
  };
}

interface PactFarmApiRecord {
  on_chain_id?: number | string;
  pool?: number | string;
  apr?: number | string | null;
  average_apr?: number | string | null;
  tvl_usd?: number | string | null;
}

type PactPoolsResponse = PactPoolApiRecord[];
type PactFarmsResponse = PactFarmApiRecord[];

interface PactFetchPayload {
  pools: PactPoolApiRecord[];
  farms: PactFarmApiRecord[];
}

export class PactAdapterError extends Error {
  public readonly cause?: unknown;

  public constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "PactAdapterError";
    this.cause = cause;
  }
}

export async function fetchPactOpportunities(
  fetchImpl: typeof fetch = fetch
): Promise<OpportunityRecordV1[]> {
  const baseUrl = process.env.PACT_API_BASE_URL;
  if (!baseUrl) {
    throw new PactAdapterError("PACT_API_BASE_URL is not configured.");
  }

  const apiKey = process.env.PACT_API_KEY;
  const base = trimTrailingSlash(baseUrl);
  const poolsRequestUrl = `${base}/pools/all?ordering=-tvl_usd&deprecated=false`;
  const farmsRequestUrl = `${base}/farms/all?ordering=-tvl_usd`;
  const fetchedAt = new Date().toISOString();
  const onlyVerified = parseBoolean(process.env.PACT_ONLY_VERIFIED, true);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const requestInit: RequestInit = {
      signal: controller.signal
    };
    if (apiKey) {
      requestInit.headers = { authorization: `Bearer ${apiKey}` };
    }

    const payload = await fetchPactPayload({
      fetchImpl,
      requestInit,
      poolsRequestUrl,
      farmsRequestUrl
    });
    const farmsByPoolId = groupFarmsByPoolId(payload.farms);

    return payload.pools
      .filter((record) => (onlyVerified ? record.is_verified === true : true))
      .flatMap((record) =>
        normalizePactPoolOpportunities(
          record,
          farmsByPoolId.get(getPoolId(record)) ?? [],
          fetchedAt
        )
      );
  } catch (error) {
    if (error instanceof PactAdapterError) {
      throw error;
    }

    throw new PactAdapterError("Pact adapter request failed.", error);
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizePactPool(
  record: PactPoolApiRecord,
  fetchedAtIso: string = new Date().toISOString()
): OpportunityRecordV1 | null {
  const sourceApy =
    toNumber(record.apr_7d_all) ??
    toNumber(record.apr_7d);
  const tvlUsd = toNumber(record.tvl_usd);
  if (sourceApy === null || tvlUsd === null) {
    return null;
  }

  const sourceApr =
    toNumber(record.apr_7d) ??
    toNumber(record.apr_7d_all);
  // Pact's API exposes APR metrics as decimal fractions (2.955135 = 295.5135%).
  // OpportunityRecordV1 uses percentage points, matching the Pact UI.
  const apy = toPercentagePoints(sourceApy);
  const apr = sourceApr === null ? null : toPercentagePoints(sourceApr);
  const id = getPoolId(record);
  const pairName = buildPairName(record);
  const assetIds = buildAssetIds(record);
  const usedFallbackIdentifiers = id.length === 0 || pairName.length === 0;

  return {
    protocol: "pact",
    opportunityType: "lp",
    opportunityId: id.length > 0 ? `${id}:lp` : `pact-${pairName || "unknown"}:lp`,
    assetPair: pairName || "unknown/unknown",
    ...(assetIds.length > 0 ? { assetIds } : {}),
    apy,
    yieldBasis: "apr",
    tvlUsd,
    ...(apr !== null ? { apr } : {}),
    ...buildSourceMetadata({
      fetchedAtIso,
      usedFallbackIdentifiers
    })
  };
}

function normalizePactPoolOpportunities(
  pool: PactPoolApiRecord,
  farms: PactFarmApiRecord[],
  fetchedAtIso: string
): OpportunityRecordV1[] {
  const output: OpportunityRecordV1[] = [];
  const lpOpportunity = normalizePactPool(pool, fetchedAtIso);
  if (lpOpportunity !== null) {
    output.push(lpOpportunity);
  }

  for (const farm of farms) {
    const farmOpportunity = normalizePactFarm(pool, farm, fetchedAtIso);
    if (farmOpportunity !== null) {
      output.push(farmOpportunity);
    }
  }

  return output;
}

function normalizePactFarm(
  pool: PactPoolApiRecord,
  farm: PactFarmApiRecord,
  fetchedAtIso: string
): OpportunityRecordV1 | null {
  const sourceApr = toNumber(farm.apr);
  const sourceAverageApr = toNumber(farm.average_apr);
  const hasFarmIncentives =
    (sourceApr !== null && sourceApr > 0) ||
    (sourceAverageApr !== null && sourceAverageApr > 0);
  if (!hasFarmIncentives) {
    return null;
  }

  const apy = toPercentagePoints(sourceAverageApr ?? sourceApr ?? 0);
  const apr = sourceApr === null ? null : toPercentagePoints(sourceApr);
  const tvlUsd = toNumber(pool.tvl_usd) ?? toNumber(farm.tvl_usd);
  if (tvlUsd === null) {
    return null;
  }

  const poolId = getPoolId(pool);
  const farmId = getFarmId(farm);
  const pairName = buildPairName(pool);
  const assetIds = buildAssetIds(pool);
  const usedFallbackIdentifiers = poolId.length === 0 || pairName.length === 0;

  const baseId = farmId.length > 0 ? farmId : poolId;

  return {
    protocol: "pact",
    opportunityType: "farm",
    opportunityId: baseId.length > 0 ? `${baseId}:farm` : `pact-${pairName || "unknown"}:farm`,
    assetPair: pairName || "unknown/unknown",
    ...(assetIds.length > 0 ? { assetIds } : {}),
    apy,
    yieldBasis: "apr",
    tvlUsd,
    ...(apr !== null ? { apr } : {}),
    ...buildSourceMetadata({
      fetchedAtIso,
      usedFallbackIdentifiers
    })
  };
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

function buildAssetIds(record: PactPoolApiRecord): number[] {
  return [record.primary_asset?.algoid, record.secondary_asset?.algoid]
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

function buildPairName(record: PactPoolApiRecord): string {
  const left = record.primary_asset?.unit_name ?? record.primary_asset?.name;
  const right = record.secondary_asset?.unit_name ?? record.secondary_asset?.name;
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

function getPoolId(record: PactPoolApiRecord): string {
  const id = record.on_chain_id ?? record.id;
  return id === undefined || id === null ? "" : String(id);
}

function getFarmId(record: PactFarmApiRecord): string {
  const id = record.on_chain_id;
  return id === undefined || id === null ? "" : String(id);
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

function groupFarmsByPoolId(farms: PactFarmApiRecord[]): Map<string, PactFarmApiRecord[]> {
  const grouped = new Map<string, PactFarmApiRecord[]>();
  for (const farm of farms) {
    const poolId =
      farm.pool === undefined || farm.pool === null
        ? ""
        : String(farm.pool);
    if (poolId.length === 0) {
      continue;
    }
    const existing = grouped.get(poolId);
    if (existing) {
      existing.push(farm);
      continue;
    }
    grouped.set(poolId, [farm]);
  }
  return grouped;
}

async function fetchPactPayload(params: {
  fetchImpl: typeof fetch;
  requestInit: RequestInit;
  poolsRequestUrl: string;
  farmsRequestUrl: string;
}): Promise<PactFetchPayload> {
  const {
    fetchImpl,
    requestInit,
    poolsRequestUrl,
    farmsRequestUrl
  } = params;

  const [poolsResponse, farmsResponse] = await Promise.all([
    fetchImpl(poolsRequestUrl, requestInit),
    fetchImpl(farmsRequestUrl, requestInit)
  ]);

  if (!poolsResponse.ok) {
    throw new PactAdapterError(
      `Pact pools API returned non-2xx status: ${poolsResponse.status}`
    );
  }
  if (!farmsResponse.ok) {
    throw new PactAdapterError(
      `Pact farms API returned non-2xx status: ${farmsResponse.status}`
    );
  }

  const pools = (await poolsResponse.json()) as PactPoolsResponse;
  const farms = (await farmsResponse.json()) as PactFarmsResponse;
  return {
    pools: Array.isArray(pools) ? pools : [],
    farms: Array.isArray(farms) ? farms : []
  };
}
