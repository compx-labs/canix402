import { buildSourceMetadata } from "../services/source-metadata.js";
import { OpportunityRecordV1 } from "../types/opportunity.js";

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

export class TinymanAdapterError extends Error {
  public readonly cause?: unknown;

  public constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "TinymanAdapterError";
    this.cause = cause;
  }
}

export async function fetchTinymanOpportunities(
  fetchImpl: typeof fetch = fetch
): Promise<OpportunityRecordV1[]> {
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

    const response = await fetchImpl(requestUrl, {
      ...requestInit
    });

    if (!response.ok) {
      throw new TinymanAdapterError(
        `Tinyman API returned non-2xx status: ${response.status}`
      );
    }

    const payload = (await response.json()) as TinymanApiResponse;
    const records = payload.results ?? [];

    return records
      .filter((record) => (onlyVerified ? record.is_verified === true : true))
      .flatMap((record) => normalizeTinymanPoolOpportunities(record, fetchedAt));
  } catch (error) {
    if (error instanceof TinymanAdapterError) {
      throw error;
    }

    throw new TinymanAdapterError("Tinyman adapter request failed.", error);
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeTinymanPool(
  record: TinymanPoolApiRecord,
  fetchedAtIso: string = new Date().toISOString()
): OpportunityRecordV1 | null {
  const apy =
    toNumber(record.annual_percentage_yield) ??
    toNumber(record.total_annual_percentage_yield);
  const tvlUsd = toNumber(record.liquidity_in_usd);

  if (apy === null || tvlUsd === null) {
    return null;
  }

  const apr =
    toNumber(record.annual_percentage_rate) ??
    toNumber(record.total_annual_percentage_rate);
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
): OpportunityRecordV1[] {
  const output: OpportunityRecordV1[] = [];
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
): OpportunityRecordV1 | null {
  const stakingApy = toNumber(record.staking_total_annual_percentage_yield);
  const stakingApr = toNumber(record.staking_total_annual_percentage_rate);
  const tvlUsd = toNumber(record.liquidity_in_usd);
  if (tvlUsd === null) {
    return null;
  }

  const hasFarmData =
    (stakingApy !== null && stakingApy > 0) ||
    (stakingApr !== null && stakingApr > 0);
  if (!hasFarmData) {
    return null;
  }

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
