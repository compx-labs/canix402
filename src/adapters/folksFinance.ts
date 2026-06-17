import { OpportunityRecordV1 } from "../types/opportunity.js";

interface FolksMarketApiRecord {
  id?: string;
  marketName?: string;
  apy?: number | string | null;
  tvlUsd?: number | string | null;
  apr?: number | string | null;
  updatedAt?: string | null;
  type?: string | null;
}

interface FolksApiResponse {
  opportunities?: FolksMarketApiRecord[];
}

export class FolksFinanceAdapterError extends Error {
  public readonly cause?: unknown;

  public constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "FolksFinanceAdapterError";
    this.cause = cause;
  }
}

export async function fetchFolksFinanceOpportunities(
  fetchImpl: typeof fetch = fetch
): Promise<OpportunityRecordV1[]> {
  const baseUrl = process.env.FOLKS_FINANCE_API_BASE_URL;
  if (!baseUrl) {
    throw new FolksFinanceAdapterError("FOLKS_FINANCE_API_BASE_URL is not configured.");
  }

  const apiKey = process.env.FOLKS_FINANCE_API_KEY;
  const requestUrl = `${trimTrailingSlash(baseUrl)}/opportunities`;
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

    const response = await fetchImpl(requestUrl, requestInit);
    if (!response.ok) {
      throw new FolksFinanceAdapterError(
        `Folks Finance API returned non-2xx status: ${response.status}`
      );
    }

    const payload = (await response.json()) as FolksApiResponse;
    const records = payload.opportunities ?? [];

    return records
      .map((record) => normalizeFolksFinanceRecord(record, fetchedAt))
      .filter((record): record is OpportunityRecordV1 => record !== null);
  } catch (error) {
    if (error instanceof FolksFinanceAdapterError) {
      throw error;
    }

    throw new FolksFinanceAdapterError("Folks Finance adapter request failed.", error);
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeFolksFinanceRecord(
  record: FolksMarketApiRecord,
  fetchedAtIso: string = new Date().toISOString()
): OpportunityRecordV1 | null {
  const apy = toNumber(record.apy);
  const tvlUsd = toNumber(record.tvlUsd);
  if (apy === null || tvlUsd === null) {
    return null;
  }

  const apr = toNumber(record.apr);
  const opportunityType = normalizeOpportunityType(record.type);
  const id = record.id ?? "";
  const marketName = record.marketName ?? "";
  const sourceTimestamp = record.updatedAt ?? fetchedAtIso;
  const notes =
    id.length === 0 || marketName.length === 0
      ? "Some source fields were missing; fallback identifiers were used."
      : undefined;

  return {
    protocol: "folks-finance",
    opportunityType,
    opportunityId: id.length > 0 ? id : `folks-${marketName || "unknown"}`,
    assetPair: marketName || "unknown",
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
