export const TABLE_FILLING_TOOLS = new Set([
  "canix_list_opportunities",
  "canix_search_opportunities",
  "canix_get_personalized_opportunities",
  "canix_get_protocol_opportunities"
]);

export interface OpportunityTableRow {
  opportunityId: string;
  protocol: string;
  opportunityType: string;
  assetPair: string;
  apy: number | null;
  yieldBasis: string;
  tvlUsd: number | null;
  executionReady: boolean | null;
  canEnter: boolean | null;
}

export function extractOpportunities(result: unknown): OpportunityTableRow[] | null {
  if (!isRecord(result) || typeof result.error === "string") {
    return null;
  }
  if (!Array.isArray(result.data)) {
    return null;
  }
  const rows = result.data
    .map(normalizeOpportunity)
    .filter((row): row is OpportunityTableRow => row !== null);
  if (result.data.length > 0 && rows.length === 0) {
    return null;
  }
  return rows;
}

export function mergeEligibility(
  rows: OpportunityTableRow[],
  result: unknown
): OpportunityTableRow[] | null {
  if (!isRecord(result) || typeof result.error === "string" || !Array.isArray(result.data)) {
    return null;
  }
  const byId = new Map<string, boolean>();
  for (const item of result.data) {
    if (!isRecord(item) || typeof item.opportunityId !== "string") {
      continue;
    }
    if (typeof item.canEnter === "boolean") {
      byId.set(item.opportunityId, item.canEnter);
    }
  }
  if (byId.size === 0) {
    return null;
  }
  let changed = false;
  const next = rows.map((row) => {
    if (!byId.has(row.opportunityId)) {
      return row;
    }
    changed = true;
    return { ...row, canEnter: byId.get(row.opportunityId) ?? row.canEnter };
  });
  return changed ? next : rows;
}

export function formatApy(value: number | null, yieldBasis: string): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  const suffix = yieldBasis === "apr" ? " APR" : "%";
  return `${value.toFixed(2)}${suffix}`;
}

export function formatTvl(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }
  return `$${value.toFixed(2)}`;
}

function normalizeOpportunity(item: unknown): OpportunityTableRow | null {
  if (!isRecord(item)) {
    return null;
  }
  const opportunityId =
    typeof item.opportunityId === "string" && item.opportunityId.length > 0
      ? item.opportunityId
      : typeof item.id === "string" && item.id.length > 0
        ? item.id
        : "";
  if (!opportunityId) {
    return null;
  }
  const hasOpportunityShape =
    typeof item.protocol === "string" &&
    (typeof item.opportunityType === "string" || typeof item.assetPair === "string");
  if (!hasOpportunityShape) {
    return null;
  }
  return {
    opportunityId,
    protocol: typeof item.protocol === "string" ? item.protocol : "—",
    opportunityType: typeof item.opportunityType === "string" ? item.opportunityType : "—",
    assetPair: typeof item.assetPair === "string" ? item.assetPair : "—",
    apy: finiteNumber(item.apy),
    yieldBasis: typeof item.yieldBasis === "string" ? item.yieldBasis : "apy",
    tvlUsd: finiteNumber(item.tvlUsd),
    executionReady: typeof item.executionReady === "boolean" ? item.executionReady : null,
    canEnter: typeof item.canEnter === "boolean" ? item.canEnter : null
  };
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
