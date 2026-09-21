import {
  fetchAlphaArcadeOpportunities,
  fetchCompXOpportunities,
  fetchDorkFiOpportunities,
  fetchFolksFinanceOpportunities,
  fetchHaystackOpportunities,
  fetchMorphoOpportunities,
  fetchMythFinanceOpportunities,
  fetchPactOpportunities,
  fetchRetiOpportunities,
  fetchStammOpportunities,
  fetchTinymanOpportunities
} from "../adapters/index.js";
import { getAppLogger } from "../observability/logger.js";
import { recordAdapterRequest } from "../observability/metrics.js";
import { OpportunityMarketRecord } from "../types/opportunity.js";
import type { Protocol } from "../routes/schemas.js";
import {
  historySnapshotsFromOpportunities,
  scheduleOpportunityHistorySnapshot
} from "./opportunity-history.js";
import {
  getOpportunitiesCacheTtlSec,
  getOrSetCacheJson,
  isOpportunityCacheEnabled,
  opportunityCacheKey
} from "./redis-cache.js";

/**
 * Protocols aggregated by the public `/opportunities` endpoint. The CLI and the
 * HTTP route both source their protocol set from here so the two cannot drift.
 */
export const SUPPORTED_AGGREGATE_PROTOCOLS = [
  "tinyman",
  "pact",
  "folks-finance",
  "compx",
  "dorkfi",
  "myth-finance",
  "haystack",
  "reti",
  "alpha-arcade",
  "stamm",
  "morpho"
] as const;

const BASE_AGGREGATE_PROTOCOLS = new Set<Protocol>(["morpho"]);

export function protocolsForOpportunityQuery(options: {
  protocol?: Protocol | undefined;
  chain?: "algorand" | "base" | undefined;
}): Protocol[] {
  const selected = options.protocol
    ? [options.protocol]
    : [...SUPPORTED_AGGREGATE_PROTOCOLS];
  if (options.chain === "base") {
    return selected.filter((protocol) => BASE_AGGREGATE_PROTOCOLS.has(protocol));
  }
  if (options.chain === "algorand") {
    return selected.filter((protocol) => !BASE_AGGREGATE_PROTOCOLS.has(protocol));
  }
  return selected;
}

const OPPORTUNITY_CACHE_NETWORK = "mainnet";

export interface OpportunityCacheMeta {
  cacheEnabled: boolean;
  cacheHit: boolean;
  cachedAt: string | null;
  cacheTtlSec: number;
}

export interface ProtocolFetchResult {
  data: OpportunityMarketRecord[];
  cacheHit: boolean;
  cachedAt: string | null;
}

export interface AggregateFetchResult {
  data: OpportunityMarketRecord[];
  errors: Array<{ protocol: Protocol; message: string }>;
  cache: OpportunityCacheMeta;
}

export interface FetchOpportunitiesOptions {
  refresh?: boolean;
}

/**
 * Fetch and merge opportunities across the requested protocols.
 *
 * Mirrors the live endpoint behaviour: adapters run concurrently and failures
 * degrade gracefully. If every adapter fails the first rejection is thrown, so
 * callers can surface an error rather than an empty list.
 */
export async function fetchOpportunitiesForProtocols(
  protocols: readonly Protocol[],
  options: FetchOpportunitiesOptions = {}
): Promise<OpportunityMarketRecord[]> {
  const { data } = await fetchOpportunitiesResult(protocols, options);
  return data;
}

/**
 * Aggregate fetch with cache meta. Throws when every requested adapter fails
 * (same semantics as {@link fetchOpportunitiesForProtocols}).
 */
export async function fetchOpportunitiesResult(
  protocols: readonly Protocol[],
  options: FetchOpportunitiesOptions = {}
): Promise<{ data: OpportunityMarketRecord[]; cache: OpportunityCacheMeta }> {
  const { data, errors, cache } = await fetchOpportunitiesWithErrors(protocols, options);
  if (data.length === 0 && errors.length > 0 && errors.length === protocols.length) {
    throw new Error(errors[0]?.message ?? "All opportunity adapters failed.");
  }
  return { data, cache };
}

/**
 * Like {@link fetchOpportunitiesForProtocols} but returns per-protocol errors
 * and cache freshness summary for list response meta.
 */
export async function fetchOpportunitiesWithErrors(
  protocols: readonly Protocol[],
  options: FetchOpportunitiesOptions = {}
): Promise<AggregateFetchResult> {
  const results = await Promise.allSettled(
    protocols.map((protocol) => fetchOpportunitiesForProtocolResult(protocol, options))
  );

  const data: OpportunityMarketRecord[] = [];
  const errors: Array<{ protocol: Protocol; message: string }> = [];
  const fulfilled: ProtocolFetchResult[] = [];
  const log = getAppLogger();

  results.forEach((result, index) => {
    const protocol = protocols[index] as Protocol;
    if (result.status === "fulfilled") {
      data.push(...result.value.data);
      fulfilled.push(result.value);
      return;
    }
    const message =
      result.reason instanceof Error ? result.reason.message : String(result.reason);
    errors.push({ protocol, message });
    log.warn(
      {
        event: "adapter_degraded",
        protocol,
        err: message
      },
      "Opportunity adapter failed"
    );
  });

  return {
    data,
    errors,
    cache: summarizeCacheMeta(fulfilled)
  };
}

/** Single-protocol fetch that returns records plus cache stats for route meta. */
export async function fetchOpportunitiesForProtocolResult(
  protocol: Protocol,
  options: FetchOpportunitiesOptions = {}
): Promise<ProtocolFetchResult> {
  if (!isOpportunityCacheEnabled()) {
    const data = await fetchOpportunitiesForProtocolUncached(protocol);
    scheduleHistorySnapshotFromRecords(data);
    return {
      data,
      cacheHit: false,
      cachedAt: null
    };
  }

  const key = opportunityCacheKey(OPPORTUNITY_CACHE_NETWORK, protocol);
  const ttl = getOpportunitiesCacheTtlSec();
  const { value, cacheHit, cachedAt } = await getOrSetCacheJson(
    key,
    () => fetchOpportunitiesForProtocolUncached(protocol),
    ttl,
    { refresh: options.refresh === true }
  );
  scheduleHistorySnapshotFromRecords(value);
  return { data: value, cacheHit, cachedAt };
}

/**
 * Fetch opportunities for one protocol (records only). Prefer
 * {@link fetchOpportunitiesForProtocolResult} when cache meta is needed.
 */
export async function fetchOpportunitiesForProtocol(
  protocol: Protocol,
  options: FetchOpportunitiesOptions = {}
): Promise<OpportunityMarketRecord[]> {
  const result = await fetchOpportunitiesForProtocolResult(protocol, options);
  return result.data;
}

export function summarizeCacheMeta(
  results: readonly ProtocolFetchResult[]
): OpportunityCacheMeta {
  const cacheEnabled = isOpportunityCacheEnabled();
  const cacheTtlSec = getOpportunitiesCacheTtlSec();

  if (!cacheEnabled || results.length === 0) {
    return {
      cacheEnabled,
      cacheHit: false,
      cachedAt: null,
      cacheTtlSec
    };
  }

  const cacheHit = results.every((result) => result.cacheHit);
  const timestamps = results
    .map((result) => result.cachedAt)
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  // Oldest snapshot among protocols used (conservative aggregate age).
  const cachedAt =
    timestamps.length === 0
      ? null
      : timestamps.reduce((oldest, current) =>
          Date.parse(current) < Date.parse(oldest) ? current : oldest
        );

  return {
    cacheEnabled,
    cacheHit,
    cachedAt,
    cacheTtlSec
  };
}

export function cacheMetaForResponse(cache: OpportunityCacheMeta): {
  cacheEnabled: boolean;
  cacheHit: boolean;
  cachedAt: string | null;
  cacheAgeMs: number | null;
  cacheTtlSec: number;
} {
  const cacheAgeMs =
    cache.cachedAt === null
      ? null
      : Math.max(0, Date.now() - Date.parse(cache.cachedAt));

  return {
    cacheEnabled: cache.cacheEnabled,
    cacheHit: cache.cacheHit,
    cachedAt: cache.cachedAt,
    cacheAgeMs: Number.isFinite(cacheAgeMs) ? cacheAgeMs : null,
    cacheTtlSec: cache.cacheTtlSec
  };
}

async function fetchOpportunitiesForProtocolUncached(
  protocol: Protocol
): Promise<OpportunityMarketRecord[]> {
  const started = process.hrtime.bigint();
  try {
    const records = await fetchOpportunitiesForProtocolUncachedInner(protocol);
    recordAdapterRequest(
      protocol,
      "ok",
      Number(process.hrtime.bigint() - started) / 1e9
    );
    return records;
  } catch (error) {
    recordAdapterRequest(
      protocol,
      "error",
      Number(process.hrtime.bigint() - started) / 1e9
    );
    throw error;
  }
}

async function fetchOpportunitiesForProtocolUncachedInner(
  protocol: Protocol
): Promise<OpportunityMarketRecord[]> {
  if (protocol === "tinyman") {
    return await fetchTinymanOpportunities();
  }
  if (protocol === "pact") {
    return await fetchPactOpportunities();
  }
  if (protocol === "folks-finance") {
    return await fetchFolksFinanceOpportunities();
  }
  if (protocol === "compx") {
    return await fetchCompXOpportunities();
  }
  if (protocol === "dorkfi") {
    return await fetchDorkFiOpportunities();
  }
  if (protocol === "myth-finance") {
    return await fetchMythFinanceOpportunities();
  }
  if (protocol === "haystack") {
    return await fetchHaystackOpportunities();
  }
  if (protocol === "reti") {
    return await fetchRetiOpportunities();
  }
  if (protocol === "alpha-arcade") {
    return await fetchAlphaArcadeOpportunities();
  }
  if (protocol === "stamm") {
    return await fetchStammOpportunities();
  }
  if (protocol === "morpho") {
    return await fetchMorphoOpportunities();
  }

  return [];
}

function scheduleHistorySnapshotFromRecords(
  records: readonly OpportunityMarketRecord[]
): void {
  scheduleOpportunityHistorySnapshot(historySnapshotsFromOpportunities(records));
}
