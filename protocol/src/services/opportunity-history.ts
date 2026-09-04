import { getAppLogger } from "../observability/logger.js";
import type {
  OpportunityHistoryPoint,
  OpportunityHistoryStability,
  OpportunityHistoryWindow,
  OpportunityStabilityBucket
} from "../types/opportunity-history-schema.js";
import type {
  OpportunityMarketRecord,
  OpportunityRisk,
  OpportunityAdapterRisk
} from "../types/opportunity.js";
import {
  CANIX_CACHE_KEY_PREFIX,
  getOrCreateRedisClient
} from "./redis-cache.js";

/** Rolling retention — enough to size a plan, not a warehouse. */
export const OPPORTUNITY_HISTORY_RETENTION_DAYS = 30;
export const OPPORTUNITY_HISTORY_BUCKET_SECONDS = 3_600;
export const OPPORTUNITY_HISTORY_MIN_SAMPLES = 3;

/** Coefficient of variation (stdev / |mean|) thresholds for the stability bucket. */
export const STABILITY_HIGH_MAX_CV = 0.05;
export const STABILITY_MEDIUM_MAX_CV = 0.2;

const WINDOW_SECONDS: Record<OpportunityHistoryWindow, number> = {
  "1d": 86_400,
  "7d": 86_400 * 7,
  "30d": 86_400 * OPPORTUNITY_HISTORY_RETENTION_DAYS
};

const SERIES_KEY_PREFIX = `${CANIX_CACHE_KEY_PREFIX}history:series:`;
const STABILITY_KEY_PREFIX = `${CANIX_CACHE_KEY_PREFIX}history:stability:`;

export interface HistorySnapshotInput {
  opportunityId: string;
  apy: number;
  tvlUsd: number;
}

export interface OpportunityHistoryStore {
  recordSnapshots(
    records: readonly HistorySnapshotInput[],
    now: Date
  ): Promise<number>;
  loadPoints(
    opportunityId: string,
    sinceMs: number
  ): Promise<OpportunityHistoryPoint[]>;
  loadStability(
    opportunityIds: readonly string[],
    now: Date
  ): Promise<Map<string, OpportunityHistoryStability>>;
  reset(): void;
}

const memorySeries = new Map<string, OpportunityHistoryPoint[]>();
let storeOverride: OpportunityHistoryStore | undefined;

export function historySeriesKey(opportunityId: string): string {
  return `${SERIES_KEY_PREFIX}${opportunityId}`;
}

export function historyStabilityKey(opportunityId: string): string {
  return `${STABILITY_KEY_PREFIX}${opportunityId}`;
}

export function windowSeconds(window: OpportunityHistoryWindow): number {
  return WINDOW_SECONDS[window];
}

export function parseHistoryWindow(
  value: string | undefined
): OpportunityHistoryWindow | undefined {
  if (value === undefined || value === "") {
    return "30d";
  }
  if (value === "1d" || value === "7d" || value === "30d") {
    return value;
  }
  return undefined;
}

export function bucketTimestampMs(nowMs: number): number {
  const bucketMs = OPPORTUNITY_HISTORY_BUCKET_SECONDS * 1_000;
  return Math.floor(nowMs / bucketMs) * bucketMs;
}

export function computeHistoryStability(
  points: readonly OpportunityHistoryPoint[]
): OpportunityHistoryStability {
  const sampleCount = points.length;
  if (sampleCount === 0) {
    return { bucket: "unknown", sampleCount: 0 };
  }

  const values = points.map((point) => point.apy);
  const apyMean = mean(values);
  if (sampleCount < 2) {
    return { bucket: "unknown", sampleCount, apyMean };
  }

  const apyStdev = sampleStdev(values, apyMean);
  if (sampleCount < OPPORTUNITY_HISTORY_MIN_SAMPLES) {
    return { bucket: "unknown", sampleCount, apyMean, apyStdev };
  }

  return {
    bucket: stabilityBucketFromCv(coefficientOfVariation(apyStdev, apyMean)),
    sampleCount,
    apyMean,
    apyStdev
  };
}

export function stabilityConstraintPenalty(
  stability: OpportunityHistoryStability | OpportunityStabilityBucket | undefined
): number {
  const bucket =
    typeof stability === "string" ? stability : (stability?.bucket ?? "unknown");
  switch (bucket) {
    case "high":
      return 0;
    case "medium":
      return 1;
    case "low":
      return 2;
    case "unknown":
      return 1;
    default:
      return 1;
  }
}

export function setOpportunityHistoryStoreForTests(
  store?: OpportunityHistoryStore
): void {
  storeOverride = store;
}

/** Pin the in-memory series so tests never depend on REDIS_URL. */
export function useMemoryOpportunityHistoryForTests(): void {
  storeOverride = memoryStore;
}

export function resetOpportunityHistoryForTests(): void {
  memorySeries.clear();
  storeOverride = undefined;
}

export function setOpportunityHistoryPointsForTests(
  opportunityId: string,
  points: readonly OpportunityHistoryPoint[]
): void {
  storeOverride = memoryStore;
  memorySeries.set(
    opportunityId,
    [...points].sort((left, right) => left.ts.localeCompare(right.ts))
  );
}

/**
 * Fire-and-forget snapshot from opportunity aggregation. No-ops without Redis
 * so in-process tests do not leak memory-series state across cases.
 */
export function scheduleOpportunityHistorySnapshot(
  records: readonly HistorySnapshotInput[],
  env: NodeJS.ProcessEnv = process.env
): void {
  if (env.OPPORTUNITY_HISTORY_DISABLED === "1") {
    return;
  }
  if (!env.REDIS_URL?.trim()) {
    return;
  }
  void recordOpportunitySnapshots(records).catch((error: unknown) => {
    getAppLogger().error(
      {
        event: "opportunity_history",
        err: error instanceof Error ? error.message : String(error)
      },
      "Opportunity history snapshot schedule failed"
    );
  });
}

export async function recordOpportunitySnapshots(
  records: readonly HistorySnapshotInput[],
  options: { now?: Date } = {}
): Promise<number> {
  const now = options.now ?? new Date();
  const store = resolveStore();
  try {
    return await store.recordSnapshots(records, now);
  } catch (error) {
    getAppLogger().error(
      {
        event: "opportunity_history",
        err: error instanceof Error ? error.message : String(error)
      },
      "Opportunity history snapshot write failed"
    );
    return 0;
  }
}

export async function loadOpportunityHistory(
  opportunityId: string,
  window: OpportunityHistoryWindow,
  options: { now?: Date } = {}
): Promise<{
  points: OpportunityHistoryPoint[];
  stability: OpportunityHistoryStability;
}> {
  const now = options.now ?? new Date();
  const sinceMs = now.getTime() - windowSeconds(window) * 1_000;
  const store = resolveStore();
  const points = await store.loadPoints(opportunityId, sinceMs);
  return { points, stability: computeHistoryStability(points) };
}

export async function loadHistoryStabilityMap(
  opportunityIds: readonly string[],
  options: { now?: Date } = {}
): Promise<Map<string, OpportunityHistoryStability>> {
  if (opportunityIds.length === 0) {
    return new Map();
  }
  const now = options.now ?? new Date();
  const store = resolveStore();
  try {
    return await store.loadStability(opportunityIds, now);
  } catch (error) {
    getAppLogger().error(
      {
        event: "opportunity_history",
        err: error instanceof Error ? error.message : String(error)
      },
      "Opportunity history stability load failed"
    );
    return new Map();
  }
}

export async function attachHistoryStability<T extends OpportunityMarketRecord>(
  records: readonly T[],
  options: { now?: Date } = {}
): Promise<T[]> {
  if (records.length === 0) {
    return [];
  }
  const ids = records.map((record) => record.opportunityId);
  const byId = await loadHistoryStabilityMap(ids, options);
  return records.map((record) => {
    const stability = byId.get(record.opportunityId);
    // Omit until at least one snapshot exists — do not stamp `unknown` on every row.
    if (stability === undefined || stability.sampleCount === 0) {
      return record;
    }
    return {
      ...record,
      risk: mergeStabilityIntoRisk(record.risk, stability)
    };
  });
}

export function mergeStabilityIntoRisk(
  risk: OpportunityRisk | OpportunityAdapterRisk | undefined,
  stability: OpportunityHistoryStability
): OpportunityRisk {
  const next: OpportunityRisk = {
    ...risk,
    confidence: risk?.confidence ?? "unknown",
    stability: stability.bucket,
    historySampleCount: stability.sampleCount
  };
  if (stability.apyStdev !== undefined) {
    next.apyStdev = stability.apyStdev;
  } else {
    delete next.apyStdev;
  }
  return next;
}

function resolveStore(): OpportunityHistoryStore {
  if (storeOverride) {
    return storeOverride;
  }
  return redisOrMemoryStore;
}

const memoryStore: OpportunityHistoryStore = {
  async recordSnapshots(records, now) {
    const bucketTs = new Date(bucketTimestampMs(now.getTime())).toISOString();
    const cutoffMs =
      now.getTime() - OPPORTUNITY_HISTORY_RETENTION_DAYS * 86_400 * 1_000;
    let written = 0;
    for (const record of records) {
      if (!isFiniteSnapshot(record)) {
        continue;
      }
      const existing = memorySeries.get(record.opportunityId) ?? [];
      if (existing.some((point) => point.ts === bucketTs)) {
        continue;
      }
      const next = [
        ...existing.filter((point) => Date.parse(point.ts) >= cutoffMs),
        { ts: bucketTs, apy: record.apy, tvlUsd: record.tvlUsd }
      ].sort((left, right) => left.ts.localeCompare(right.ts));
      memorySeries.set(record.opportunityId, next);
      written += 1;
    }
    return written;
  },
  async loadPoints(opportunityId, sinceMs) {
    const points = memorySeries.get(opportunityId) ?? [];
    return points.filter((point) => Date.parse(point.ts) >= sinceMs);
  },
  async loadStability(opportunityIds, now) {
    const sinceMs =
      now.getTime() - OPPORTUNITY_HISTORY_RETENTION_DAYS * 86_400 * 1_000;
    const map = new Map<string, OpportunityHistoryStability>();
    for (const opportunityId of opportunityIds) {
      const points = await this.loadPoints(opportunityId, sinceMs);
      map.set(opportunityId, computeHistoryStability(points));
    }
    return map;
  },
  reset() {
    memorySeries.clear();
  }
};

const redisOrMemoryStore: OpportunityHistoryStore = {
  async recordSnapshots(records, now) {
    const client = getOrCreateRedisClient();
    if (!client) {
      return memoryStore.recordSnapshots(records, now);
    }

    const bucketMs = bucketTimestampMs(now.getTime());
    const bucketTs = new Date(bucketMs).toISOString();
    const cutoffMs =
      now.getTime() - OPPORTUNITY_HISTORY_RETENTION_DAYS * 86_400 * 1_000;
    const ttlSeconds = (OPPORTUNITY_HISTORY_RETENTION_DAYS + 1) * 86_400;
    let written = 0;

    for (const record of records) {
      if (!isFiniteSnapshot(record)) {
        continue;
      }
      const seriesKey = historySeriesKey(record.opportunityId);
      const member = JSON.stringify({
        ts: bucketTs,
        apy: record.apy,
        tvlUsd: record.tvlUsd
      } satisfies OpportunityHistoryPoint);
      try {
        // NX by score (hourly bucket), not by JSON member — APY/TVL can change
        // within the hour and would otherwise insert a second point.
        const occupied = await client.zcount(seriesKey, bucketMs, bucketMs);
        if (occupied > 0) {
          continue;
        }
        await client.zadd(seriesKey, bucketMs, member);
        await client.zremrangebyscore(seriesKey, 0, cutoffMs);
        await client.expire(seriesKey, ttlSeconds);
        written += 1;
        const points = decodeSeries(
          await client.zrangebyscore(seriesKey, cutoffMs, now.getTime())
        );
        const stability = computeHistoryStability(points);
        await client.setex(
          historyStabilityKey(record.opportunityId),
          ttlSeconds,
          JSON.stringify(stability)
        );
      } catch (error) {
        getAppLogger().error(
          {
            event: "opportunity_history",
            opportunityId: record.opportunityId,
            err: error instanceof Error ? error.message : String(error)
          },
          "Redis history snapshot failed"
        );
      }
    }
    return written;
  },
  async loadPoints(opportunityId, sinceMs) {
    const client = getOrCreateRedisClient();
    if (!client) {
      return memoryStore.loadPoints(opportunityId, sinceMs);
    }
    try {
      const members = await client.zrangebyscore(
        historySeriesKey(opportunityId),
        sinceMs,
        "+inf"
      );
      return decodeSeries(members);
    } catch (error) {
      getAppLogger().error(
        {
          event: "opportunity_history",
          opportunityId,
          err: error instanceof Error ? error.message : String(error)
        },
        "Redis history series read failed"
      );
      return memoryStore.loadPoints(opportunityId, sinceMs);
    }
  },
  async loadStability(opportunityIds, now) {
    const client = getOrCreateRedisClient();
    if (!client) {
      return memoryStore.loadStability(opportunityIds, now);
    }

    const map = new Map<string, OpportunityHistoryStability>();
    try {
      const pipeline = client.pipeline();
      for (const opportunityId of opportunityIds) {
        pipeline.get(historyStabilityKey(opportunityId));
      }
      const results = await pipeline.exec();
      const missing: string[] = [];
      opportunityIds.forEach((opportunityId, index) => {
        const row = results?.[index];
        if (!row || row[0]) {
          missing.push(opportunityId);
          return;
        }
        const parsed = parseStabilityJson(row[1]);
        if (parsed === undefined) {
          missing.push(opportunityId);
          return;
        }
        map.set(opportunityId, parsed);
      });
      if (missing.length > 0) {
        const sinceMs =
          now.getTime() - OPPORTUNITY_HISTORY_RETENTION_DAYS * 86_400 * 1_000;
        await Promise.all(
          missing.map(async (opportunityId) => {
            const points = await this.loadPoints(opportunityId, sinceMs);
            map.set(opportunityId, computeHistoryStability(points));
          })
        );
      }
      return map;
    } catch (error) {
      getAppLogger().error(
        {
          event: "opportunity_history",
          err: error instanceof Error ? error.message : String(error)
        },
        "Redis history stability pipeline failed"
      );
      return memoryStore.loadStability(opportunityIds, now);
    }
  },
  reset() {
    memoryStore.reset();
  }
};

function isFiniteSnapshot(record: HistorySnapshotInput): boolean {
  return (
    record.opportunityId.length > 0 &&
    Number.isFinite(record.apy) &&
    Number.isFinite(record.tvlUsd)
  );
}

function decodeSeries(members: readonly string[]): OpportunityHistoryPoint[] {
  const points: OpportunityHistoryPoint[] = [];
  for (const member of members) {
    const parsed = parsePointJson(member);
    if (parsed !== undefined) {
      points.push(parsed);
    }
  }
  return points.sort((left, right) => left.ts.localeCompare(right.ts));
}

function parsePointJson(value: string): OpportunityHistoryPoint | undefined {
  try {
    const parsed = JSON.parse(value) as Partial<OpportunityHistoryPoint>;
    if (
      typeof parsed.ts !== "string" ||
      !Number.isFinite(parsed.apy) ||
      !Number.isFinite(parsed.tvlUsd)
    ) {
      return undefined;
    }
    return { ts: parsed.ts, apy: Number(parsed.apy), tvlUsd: Number(parsed.tvlUsd) };
  } catch {
    return undefined;
  }
}

function parseStabilityJson(value: unknown): OpportunityHistoryStability | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as Partial<OpportunityHistoryStability>;
    if (
      parsed.bucket !== "high" &&
      parsed.bucket !== "medium" &&
      parsed.bucket !== "low" &&
      parsed.bucket !== "unknown"
    ) {
      return undefined;
    }
    if (
      typeof parsed.sampleCount !== "number" ||
      !Number.isInteger(parsed.sampleCount) ||
      parsed.sampleCount < 0
    ) {
      return undefined;
    }
    const result: OpportunityHistoryStability = {
      bucket: parsed.bucket,
      sampleCount: parsed.sampleCount
    };
    if (typeof parsed.apyMean === "number" && Number.isFinite(parsed.apyMean)) {
      result.apyMean = parsed.apyMean;
    }
    if (typeof parsed.apyStdev === "number" && Number.isFinite(parsed.apyStdev)) {
      result.apyStdev = parsed.apyStdev;
    }
    return result;
  } catch {
    return undefined;
  }
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStdev(values: readonly number[], valuesMean: number): number {
  if (values.length < 2) {
    return 0;
  }
  const variance =
    values.reduce((sum, value) => sum + (value - valuesMean) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

function coefficientOfVariation(stdev: number, valuesMean: number): number {
  if (!Number.isFinite(stdev) || stdev < 0) {
    return Number.POSITIVE_INFINITY;
  }
  if (valuesMean === 0) {
    return stdev === 0 ? 0 : Number.POSITIVE_INFINITY;
  }
  return stdev / Math.abs(valuesMean);
}

function stabilityBucketFromCv(cv: number): OpportunityStabilityBucket {
  if (!Number.isFinite(cv)) {
    return "low";
  }
  if (cv <= STABILITY_HIGH_MAX_CV) {
    return "high";
  }
  if (cv <= STABILITY_MEDIUM_MAX_CV) {
    return "medium";
  }
  return "low";
}
