import {
  fetchAlphaArcadeOpportunities,
  fetchCompXOpportunities,
  fetchDorkFiOpportunities,
  fetchFolksFinanceOpportunities,
  fetchHaystackOpportunities,
  fetchMythFinanceOpportunities,
  fetchPactOpportunities,
  fetchRetiOpportunities,
  fetchTinymanOpportunities
} from "../adapters/index.js";
import { getAppLogger } from "../observability/logger.js";
import { recordAdapterRequest } from "../observability/metrics.js";
import { OpportunityMarketRecord } from "../types/opportunity.js";
import type { Protocol } from "../routes/schemas.js";
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
  "alpha-arcade"
] as const;

const OPPORTUNITY_CACHE_NETWORK = "mainnet";

export interface AggregateFetchResult {
  data: OpportunityMarketRecord[];
  errors: Array<{ protocol: Protocol; message: string }>;
}

/**
 * Fetch and merge opportunities across the requested protocols.
 *
 * Mirrors the live endpoint behaviour: adapters run concurrently and failures
 * degrade gracefully. If every adapter fails the first rejection is thrown, so
 * callers can surface an error rather than an empty list.
 */
export async function fetchOpportunitiesForProtocols(
  protocols: readonly Protocol[]
): Promise<OpportunityMarketRecord[]> {
  const { data, errors } = await fetchOpportunitiesWithErrors(protocols);
  if (data.length === 0 && errors.length > 0 && errors.length === protocols.length) {
    throw new Error(errors[0]?.message ?? "All opportunity adapters failed.");
  }
  return data;
}

/**
 * Like {@link fetchOpportunitiesForProtocols} but returns per-protocol errors
 * instead of discarding them. Useful for tooling that needs to report which
 * upstreams degraded.
 */
export async function fetchOpportunitiesWithErrors(
  protocols: readonly Protocol[]
): Promise<AggregateFetchResult> {
  const results = await Promise.allSettled(
    protocols.map((protocol) => fetchOpportunitiesForProtocol(protocol))
  );

  const data: OpportunityMarketRecord[] = [];
  const errors: Array<{ protocol: Protocol; message: string }> = [];
  const log = getAppLogger();

  results.forEach((result, index) => {
    const protocol = protocols[index] as Protocol;
    if (result.status === "fulfilled") {
      data.push(...result.value);
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

  return { data, errors };
}

export async function fetchOpportunitiesForProtocol(
  protocol: Protocol
): Promise<OpportunityMarketRecord[]> {
  if (!isOpportunityCacheEnabled()) {
    return fetchOpportunitiesForProtocolUncached(protocol);
  }

  const key = opportunityCacheKey(OPPORTUNITY_CACHE_NETWORK, protocol);
  const ttl = getOpportunitiesCacheTtlSec();
  const { value } = await getOrSetCacheJson(
    key,
    () => fetchOpportunitiesForProtocolUncached(protocol),
    ttl
  );
  return value;
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

  return [];
}
