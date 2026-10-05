import {
  HAYSTACK_LAUNCH_DEFAULT_LIMIT,
  HAYSTACK_LAUNCH_MAX_LIMIT,
  HAYSTACK_LAUNCH_WINDOW_MS
} from "./launch-constants.js";

export interface HaystackLaunchListRow {
  tokenNum: number;
  assetId: number;
  name: string;
  symbol: string;
  assetUrl: string;
  creator: string;
  bondingTokenId: number;
  launchedAt: string;
  progressPercent: number;
  priceBonding: string;
  priceUsd: string | null;
  realTokenReserves: string;
  realBondingReserves: string;
  initialRealTokenReserves: string;
  bondingTargetUsd: string;
  priceMultiplier: string;
  buyShapeKey: string;
}

export interface HaystackLaunchListQuery {
  q?: string;
  minProgress?: number;
  maxProgress?: number;
  order?: "asc" | "desc";
  launchedAfter?: string;
  launchedBefore?: string;
  limit?: number;
  offset?: number;
}

export interface ResolvedLaunchWindow {
  launchedAfter: string;
  launchedBefore: string;
}

export function resolveLaunchWindow(
  nowMs: number,
  query: Pick<HaystackLaunchListQuery, "launchedAfter" | "launchedBefore">
): ResolvedLaunchWindow {
  const beforeMs = query.launchedBefore ? Date.parse(query.launchedBefore) : nowMs;
  const afterMs = query.launchedAfter
    ? Date.parse(query.launchedAfter)
    : beforeMs - HAYSTACK_LAUNCH_WINDOW_MS;
  return {
    launchedAfter: new Date(afterMs).toISOString(),
    launchedBefore: new Date(beforeMs).toISOString()
  };
}

export function filterAndSortLaunches(
  rows: readonly HaystackLaunchListRow[],
  query: HaystackLaunchListQuery
): { total: number; launches: HaystackLaunchListRow[]; order: "asc" | "desc" } {
  const needle = query.q?.trim().toLowerCase() ?? "";
  const order = query.order ?? "desc";
  const filtered = rows.filter((row) => {
    if (needle.length > 0) {
      const name = row.name.toLowerCase();
      const symbol = row.symbol.toLowerCase();
      if (!name.includes(needle) && !symbol.includes(needle)) {
        return false;
      }
    }
    if (query.minProgress !== undefined && row.progressPercent < query.minProgress) {
      return false;
    }
    if (query.maxProgress !== undefined && row.progressPercent > query.maxProgress) {
      return false;
    }
    return true;
  });
  filtered.sort((left, right) => {
    const progress = left.progressPercent - right.progressPercent;
    if (progress !== 0) {
      return order === "asc" ? progress : -progress;
    }
    return right.tokenNum - left.tokenNum;
  });
  const offset = query.offset ?? 0;
  const limit = query.limit ?? HAYSTACK_LAUNCH_DEFAULT_LIMIT;
  return {
    total: filtered.length,
    order,
    launches: filtered.slice(offset, offset + limit)
  };
}

export function parseLaunchListQuery(raw: {
  q?: string;
  minProgress?: number;
  maxProgress?: number;
  order?: string;
  launchedAfter?: string;
  launchedBefore?: string;
  limit?: number;
  offset?: number;
}): HaystackLaunchListQuery {
  const query: HaystackLaunchListQuery = {};
  if (raw.q !== undefined && raw.q.trim().length > 0) {
    query.q = raw.q.trim();
  }
  if (raw.minProgress !== undefined) {
    query.minProgress = raw.minProgress;
  }
  if (raw.maxProgress !== undefined) {
    query.maxProgress = raw.maxProgress;
  }
  if (raw.order === "asc" || raw.order === "desc") {
    query.order = raw.order;
  }
  if (raw.launchedAfter !== undefined) {
    query.launchedAfter = raw.launchedAfter;
  }
  if (raw.launchedBefore !== undefined) {
    query.launchedBefore = raw.launchedBefore;
  }
  if (raw.limit !== undefined) {
    query.limit = Math.min(HAYSTACK_LAUNCH_MAX_LIMIT, raw.limit);
  }
  if (raw.offset !== undefined) {
    query.offset = raw.offset;
  }
  return query;
}
