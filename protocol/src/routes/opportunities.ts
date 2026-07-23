import algosdk from "algosdk";
import { FastifyInstance } from "fastify";

import { fetchAccountHoldings } from "../services/account-assets.js";
import {
  fetchOpportunitiesForProtocols,
  SUPPORTED_AGGREGATE_PROTOCOLS
} from "../services/aggregate-opportunities.js";
import { filterOpportunitiesByActivity } from "../services/opportunity-activity.js";
import { rankOpportunitiesByApy } from "../services/opportunity-ranking.js";
import { formatOpportunitiesForAgent } from "../services/precision.js";
import { selectPersonalizedOpportunities } from "../services/personalized-opportunities.js";
import { ApiError, ApiSuccess } from "../types/index.js";
import { OpportunityRecordV1 } from "../types/opportunity.js";
import {
  OpportunitiesListResponseSchema,
  PersonalizedOpportunitiesListResponseSchema
} from "../types/opportunity-schema.js";
import {
  AGGREGATE_OPPORTUNITIES_DEFAULT_LIMIT,
  FilteredOpportunitiesDefaultLimit,
  FilteredOpportunitiesQuery,
  FilteredOpportunitiesQuerySchema,
  OpportunitiesQuery,
  OpportunitiesQuerySchema,
  PERSONALIZED_OPPORTUNITIES_DEFAULT_LIMIT,
  PersonalizedOpportunitiesQuery,
  PersonalizedOpportunitiesQuerySchema,
  Protocol,
  SupportedOpportunityTypeValues,
  SupportedProtocolValues
} from "./schemas.js";

export function registerOpportunityRoutes(app: FastifyInstance) {
  app.get<{ Querystring: OpportunitiesQuery; Reply: ApiSuccess<OpportunityRecordV1[]> }>(
    "/opportunities",
    {
      schema: {
        querystring: OpportunitiesQuerySchema,
        response: {
          200: OpportunitiesListResponseSchema
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

      const data = filterOpportunitiesByActivity(
        await fetchOpportunitiesForProtocols(
          protocol ? [protocol] : SUPPORTED_AGGREGATE_PROTOCOLS
        ),
        includeInactive
      );

      const pagedData = rankOpportunitiesByApy(data).slice(offset, offset + limit);

      return {
        data: formatOpportunitiesForAgent(pagedData),
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
          200: OpportunitiesListResponseSchema
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
      const filtered = filterOpportunitiesByActivity(data, includeInactive).filter(
        (row) => {
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
        data: formatOpportunitiesForAgent(pagedData),
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
    Querystring: PersonalizedOpportunitiesQuery;
    Reply: ApiSuccess<OpportunityRecordV1[]> | ApiError;
  }>(
    "/opportunities/personalized",
    {
      schema: {
        querystring: PersonalizedOpportunitiesQuerySchema,
        response: {
          200: PersonalizedOpportunitiesListResponseSchema
        }
      }
    },
    async (request, reply) => {
      const {
        address,
        limit = PERSONALIZED_OPPORTUNITIES_DEFAULT_LIMIT,
        offset = 0,
        includeInactive = false
      } = request.query;

      if (!algosdk.isValidAddress(address)) {
        return reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Query parameter 'address' is not a valid Algorand address."
          }
        });
      }

      const holdings = await fetchAccountHoldings(address);
      const data = filterOpportunitiesByActivity(
        await fetchOpportunitiesForProtocols(SUPPORTED_AGGREGATE_PROTOCOLS),
        includeInactive
      );

      const personalized = selectPersonalizedOpportunities(
        data,
        holdings,
        offset + limit,
        { includeInactive }
      ).slice(offset, offset + limit);

      return reply.send({
        data: formatOpportunitiesForAgent(personalized),
        meta: {
          limit,
          offset,
          includeInactive,
          paymentRequired: true,
          address,
          heldAssetCount: holdings.heldAssetIds.size
        }
      });
    }
  );
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
