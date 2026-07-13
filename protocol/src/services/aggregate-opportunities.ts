import {
  CompXAdapterError,
  DorkFiAdapterError,
  fetchCompXOpportunities,
  fetchDorkFiOpportunities,
  fetchFolksFinanceOpportunities,
  fetchPactOpportunities,
  fetchTinymanOpportunities,
  FolksFinanceAdapterError,
  PactAdapterError,
  TinymanAdapterError
} from "../adapters/index.js";
import { OpportunityRecordV1 } from "../types/opportunity.js";
import type { Protocol } from "../routes/schemas.js";

/**
 * Protocols aggregated by the public `/opportunities` endpoint. The CLI and the
 * HTTP route both source their protocol set from here so the two cannot drift.
 */
export const SUPPORTED_AGGREGATE_PROTOCOLS = [
  "tinyman",
  "pact",
  "folks-finance",
  "compx",
  "dorkfi"
] as const;

export interface AggregateFetchResult {
  data: OpportunityRecordV1[];
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
): Promise<OpportunityRecordV1[]> {
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

  const data: OpportunityRecordV1[] = [];
  const errors: Array<{ protocol: Protocol; message: string }> = [];

  results.forEach((result, index) => {
    const protocol = protocols[index] as Protocol;
    if (result.status === "fulfilled") {
      data.push(...result.value);
      return;
    }
    const message =
      result.reason instanceof Error ? result.reason.message : String(result.reason);
    errors.push({ protocol, message });
  });

  return { data, errors };
}

export async function fetchOpportunitiesForProtocol(
  protocol: Protocol
): Promise<OpportunityRecordV1[]> {
  try {
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
  } catch (error) {
    if (
      error instanceof TinymanAdapterError ||
      error instanceof PactAdapterError ||
      error instanceof FolksFinanceAdapterError ||
      error instanceof CompXAdapterError ||
      error instanceof DorkFiAdapterError
    ) {
      throw error;
    }
    throw error;
  }

  return [];
}
