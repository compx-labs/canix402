import { OpportunityRecordV1 } from "../types/opportunity.js";

interface TinymanPoolApiRecord {
  id?: string;
  pairName?: string;
  apy?: number | string | null;
  tvlUsd?: number | string | null;
  apr?: number | string | null;
  updatedAt?: string | null;
  type?: string | null;
}

interface TinymanApiResponse {
  pools?: TinymanPoolApiRecord[];
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
  const requestUrl = `${trimTrailingSlash(baseUrl)}/pools`;
  const fetchedAt = new Date().toISOString();

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
    const records = payload.pools ?? [];

    return records
      .map((record) => normalizeTinymanPool(record, fetchedAt))
      .filter((record): record is OpportunityRecordV1 => record !== null);
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
  const apy = toNumber(record.apy);
  const tvlUsd = toNumber(record.tvlUsd);

  if (apy === null || tvlUsd === null) {
    return null;
  }

  const apr = toNumber(record.apr);
  const opportunityType = normalizeOpportunityType(record.type);
  const sourceTimestamp = record.updatedAt ?? fetchedAtIso;
  const id = record.id ?? "";
  const pairName = record.pairName ?? "";

  const notes =
    id.length === 0 || pairName.length === 0
      ? "Some source fields were missing; fallback identifiers were used."
      : undefined;

  return {
    protocol: "tinyman",
    opportunityType,
    opportunityId: id.length > 0 ? id : `tinyman-${pairName || "unknown"}`,
    assetPair: pairName || "unknown/unknown",
    apy,
    tvlUsd,
    ...(apr !== null ? { apr } : {}),
    sourceTimestamp,
    fetchedAt: fetchedAtIso,
    ...(notes ? { notes } : {})
  };
}

function normalizeOpportunityType(type: string | null | undefined): OpportunityRecordV1["opportunityType"] {
  const value = (type ?? "").toLowerCase();
  if (value.includes("farm")) {
    return "farm";
  }
  if (value.includes("stake")) {
    return "staking";
  }
  if (value.includes("lend")) {
    return "lending";
  }
  return "lp";
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
