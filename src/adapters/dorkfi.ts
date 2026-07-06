import { OpportunityRecordV1 } from "../types/opportunity.js";

interface DorkFiOpportunityApiRecord {
  type?: string | null;
  assetName?: string | null;
  apy?: number | string | null;
  tvl?: number | string | null;
  assetId?: number | string | null;
  network?: string | null;
  appId?: number | string | null;
}

type DorkFiApiResponse = DorkFiOpportunityApiRecord[];

export class DorkFiAdapterError extends Error {
  public readonly cause?: unknown;

  public constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "DorkFiAdapterError";
    this.cause = cause;
  }
}

export async function fetchDorkFiOpportunities(
  fetchImpl: typeof fetch = fetch
): Promise<OpportunityRecordV1[]> {
  const baseUrl = process.env.DORKFI_API_BASE_URL;
  if (!baseUrl) {
    throw new DorkFiAdapterError("DORKFI_API_BASE_URL is not configured.");
  }

  const apiKey = process.env.DORKFI_API_KEY;
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

    const response = await fetchImpl(baseUrl, requestInit);
    if (!response.ok) {
      throw new DorkFiAdapterError(
        `Dork.fi API returned non-2xx status: ${response.status}`
      );
    }

    const payload = (await response.json()) as DorkFiApiResponse;
    if (!Array.isArray(payload)) {
      throw new DorkFiAdapterError("Dork.fi API returned an unexpected payload shape.");
    }

    return payload.flatMap((record) => {
      const normalized = normalizeDorkFiOpportunity(record, fetchedAt);
      return normalized === null ? [] : [normalized];
    });
  } catch (error) {
    if (error instanceof DorkFiAdapterError) {
      throw error;
    }

    throw new DorkFiAdapterError("Dork.fi adapter request failed.", error);
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeDorkFiOpportunity(
  record: DorkFiOpportunityApiRecord,
  fetchedAtIso: string = new Date().toISOString()
): OpportunityRecordV1 | null {
  if (!isAlgorandNetwork(record.network)) {
    return null;
  }

  const opportunityType = toOpportunityType(record.type);
  const apy = toNumber(record.apy);
  const tvlUsd = toNumber(record.tvl);
  if (opportunityType === null || apy === null || tvlUsd === null) {
    return null;
  }

  const assetPair = normalizeAssetPair(record.assetName);
  const appId = normalizeIdentifier(record.appId);
  const assetId = toAssetId(record.assetId);
  const sourceTimestamp = fetchedAtIso;
  const notes =
    appId.length === 0 || assetPair === "unknown"
      ? "Some source fields were missing; fallback identifiers were used."
      : undefined;

  const fallbackAssetId = assetId !== null ? String(assetId) : toSlug(assetPair);
  const opportunityId = [
    "dorkfi",
    "algorand",
    appId.length > 0 ? appId : "unknown-app",
    fallbackAssetId,
    opportunityType
  ].join(":");

  return {
    protocol: "dorkfi",
    opportunityType,
    opportunityId,
    assetPair,
    ...(assetId !== null ? { assetIds: [assetId] } : {}),
    apy,
    tvlUsd,
    sourceTimestamp,
    fetchedAt: fetchedAtIso,
    ...(notes ? { notes } : {})
  };
}

function isAlgorandNetwork(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().toLowerCase().includes("algorand");
}

function toOpportunityType(
  value: string | null | undefined
): OpportunityRecordV1["opportunityType"] | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "lp" ||
    normalized === "farm" ||
    normalized === "staking" ||
    normalized === "lending"
  ) {
    return normalized;
  }

  if (normalized === "liquidity" || normalized === "liquidity-pool") {
    return "lp";
  }
  if (normalized === "lend" || normalized === "loan") {
    return "lending";
  }

  return null;
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

function toAssetId(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeAssetPair(value: string | null | undefined): string {
  if (!value) {
    return "unknown";
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "unknown";
}

function normalizeIdentifier(value: number | string | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  const asString = String(value).trim();
  return asString.length > 0 ? asString : "";
}

function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
