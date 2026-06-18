import { Type } from "@sinclair/typebox";
import { FastifyInstance } from "fastify";

import {
  fetchFolksFinanceOpportunities,
  FolksFinanceAdapterError,
  fetchPactOpportunities,
  PactAdapterError,
  fetchTinymanOpportunities,
  TinymanAdapterError
} from "../adapters/index.js";
import { rankOpportunitiesByApy } from "../services/opportunity-ranking.js";
import { ApiSuccess } from "../types/index.js";
import { OpportunityRecordV1 } from "../types/opportunity.js";
import {
  AGGREGATE_OPPORTUNITIES_DEFAULT_LIMIT,
  FilteredOpportunitiesDefaultLimit,
  FilteredOpportunitiesQuery,
  FilteredOpportunitiesQuerySchema,
  OpportunitiesQuery,
  OpportunitiesQuerySchema,
  Protocol,
  SupportedOpportunityTypeValues,
  SupportedProtocolValues
} from "./schemas.js";

const opportunitiesReplySchema = Type.Object({
  data: Type.Array(
    Type.Object({
      protocol: Type.String(),
      opportunityId: Type.String(),
      opportunityType: Type.String(),
      assetPair: Type.String(),
      apr: Type.Optional(Type.Number()),
      apy: Type.Number(),
      tvlUsd: Type.Number(),
      sourceTimestamp: Type.String(),
      fetchedAt: Type.String(),
      notes: Type.Optional(Type.String())
    })
  ),
  meta: Type.Optional(
    Type.Object({
      limit: Type.Integer(),
      offset: Type.Integer(),
      includeInactive: Type.Boolean(),
      paymentRequired: Type.Boolean()
    })
  )
});

export function registerOpportunityRoutes(app: FastifyInstance) {
  app.get<{ Querystring: OpportunitiesQuery; Reply: ApiSuccess<OpportunityRecordV1[]> }>(
    "/opportunities",
    {
      schema: {
        querystring: OpportunitiesQuerySchema,
        response: {
          200: opportunitiesReplySchema
        }
      }
    },
    async (request) => {
      const {
        limit = AGGREGATE_OPPORTUNITIES_DEFAULT_LIMIT,
        offset = 0,
        includeInactive = false,
        protocol
      } = request.query;

      const data = await fetchOpportunitiesForProtocols(
        protocol ? [protocol] : SUPPORTED_AGGREGATE_PROTOCOLS
      );

      const pagedData = rankOpportunitiesByApy(data).slice(offset, offset + limit);

      return {
        data: pagedData,
        meta: {
          limit,
          offset,
          includeInactive,
          paymentRequired: true
        }
      };
    }
  );

  app.get<{
    Querystring: FilteredOpportunitiesQuery;
    Reply: ApiSuccess<OpportunityRecordV1[]>;
  }>(
    "/opportunities/search",
    {
      schema: {
        querystring: FilteredOpportunitiesQuerySchema,
        response: {
          200: opportunitiesReplySchema
        }
      }
    },
    async (request) => {
      const {
        platform,
        type,
        minApy,
        maxApy,
        minTvlUsd,
        limit = FilteredOpportunitiesDefaultLimit,
        offset = 0,
        includeInactive = false
      } = request.query;

      const platforms = parseProtocolFilters(platform);
      const types = parseOpportunityTypeFilters(type);

      const data = await fetchOpportunitiesForProtocols(platforms);
      const filtered = data.filter((row) => {
        if (types.length > 0 && !types.includes(row.opportunityType)) {
          return false;
        }
        if (minApy !== undefined && row.apy < minApy) {
          return false;
        }
        if (maxApy !== undefined && row.apy > maxApy) {
          return false;
        }
        if (minTvlUsd !== undefined && row.tvlUsd < minTvlUsd) {
          return false;
        }
        return true;
      });

      const pagedData = rankOpportunitiesByApy(filtered).slice(offset, offset + limit);
      return {
        data: pagedData,
        meta: {
          limit,
          offset,
          includeInactive,
          paymentRequired: true
        }
      };
    }
  );
}

const SUPPORTED_AGGREGATE_PROTOCOLS = ["tinyman", "pact", "folks-finance"] as const;

async function fetchOpportunitiesForProtocols(
  protocols: readonly Protocol[]
): Promise<OpportunityRecordV1[]> {
  const results = await Promise.allSettled(
    protocols.map((protocol) => fetchOpportunitiesForProtocol(protocol))
  );

  const fulfilledResults = results.filter(
    (result): result is PromiseFulfilledResult<OpportunityRecordV1[]> =>
      result.status === "fulfilled"
  );
  if (fulfilledResults.length === 0) {
    const firstRejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    throw firstRejected?.reason ?? new Error("All opportunity adapters failed.");
  }

  return fulfilledResults.flatMap((result) => result.value);
}

async function fetchOpportunitiesForProtocol(protocol: Protocol): Promise<OpportunityRecordV1[]> {
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
    if (SupportedProtocolValues.includes(protocol)) {
      return [];
    }
  } catch (error) {
    if (
      error instanceof TinymanAdapterError ||
      error instanceof PactAdapterError ||
      error instanceof FolksFinanceAdapterError
    ) {
      throw error;
    }
    throw error;
  }

  return [];
}

function parseProtocolFilters(value: string | undefined): Protocol[] {
  if (!value) {
    return [...SUPPORTED_AGGREGATE_PROTOCOLS];
  }

  const selected = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry): entry is Protocol => SupportedProtocolValues.includes(entry as Protocol));
  return selected.length > 0 ? selected : [...SUPPORTED_AGGREGATE_PROTOCOLS];
}

function parseOpportunityTypeFilters(value: string | undefined): OpportunityRecordV1["opportunityType"][] {
  if (!value) {
    return [];
  }

  const allowed = new Set<OpportunityRecordV1["opportunityType"]>(
    SupportedOpportunityTypeValues
  );
  return value
    .split(",")
    .map((entry) => entry.trim() as OpportunityRecordV1["opportunityType"])
    .filter((entry) => allowed.has(entry));
}
