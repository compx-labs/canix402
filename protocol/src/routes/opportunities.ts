import algosdk from "algosdk";
import { FastifyInstance } from "fastify";

import { fetchAccountHoldings } from "../services/account-assets.js";
import {
  cacheMetaForResponse,
  fetchOpportunitiesResult,
  SUPPORTED_AGGREGATE_PROTOCOLS
} from "../services/aggregate-opportunities.js";
import { filterOpportunitiesByActivity } from "../services/opportunity-activity.js";
import { rankOpportunities } from "../services/opportunity-ranking.js";
import { formatOpportunitiesForAgent } from "../services/precision.js";
import { selectPersonalizedOpportunities } from "../services/personalized-opportunities.js";
import {
  attachOpportunityRisk,
  loadWalletHealthFactors
} from "../services/opportunity-risk.js";
import { evaluateOpportunityEligibility } from "../services/eligibility.js";
import { ApiError, ApiSuccess } from "../types/index.js";
import { OpportunityRecordV1 } from "../types/opportunity.js";
import {
  OpportunitiesListResponseSchema,
  PersonalizedOpportunitiesListResponseSchema,
  type PersonalizedOpportunityRecord
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
        protocol,
        refresh = false
      } = request.query;

      const { data: fetched, cache } = await fetchOpportunitiesResult(
        protocol ? [protocol] : SUPPORTED_AGGREGATE_PROTOCOLS,
        { refresh }
      );
      const data = filterOpportunitiesByActivity(fetched, includeInactive);
      const pagedData = rankOpportunities(data).slice(offset, offset + limit);

      return {
        data: formatOpportunitiesForAgent(pagedData),
        meta: {
          limit,
          offset,
          includeInactive,
          paymentRequired: true,
          ...cacheMetaForResponse(cache)
        }
      };
    }
  );

  app.get<{
    Querystring: FilteredOpportunitiesQuery;
    Reply: ApiSuccess<OpportunityRecordV1[]> | ApiError;
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
    async (request, reply) => {
      const {
        platform,
        type,
        minApy,
        maxApy,
        minTvlUsd,
        assetIds: assetIdsRaw,
        limit = FilteredOpportunitiesDefaultLimit,
        offset = 0,
        includeInactive = false,
        refresh = false
      } = request.query;

      const platforms = parseProtocolFilters(platform);
      const types = parseOpportunityTypeFilters(type);
      const assetIds = parseAssetIdFilters(assetIdsRaw);
      if (assetIdsRaw !== undefined && assetIds.length === 0) {
        return reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message:
              "Query parameter 'assetIds' must be a comma-separated list of non-negative integer ASA ids (0 = ALGO)."
          }
        });
      }
      const assetIdSet = assetIds.length > 0 ? new Set(assetIds) : null;

      const { data, cache } = await fetchOpportunitiesResult(platforms, { refresh });
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
        if (assetIdSet) {
          const rowAssetIds = row.assetIds ?? [];
          if (!rowAssetIds.some((id) => assetIdSet.has(id))) {
            return false;
          }
        }
        return true;
      });

      const pagedData = rankOpportunities(filtered).slice(offset, offset + limit);
      return reply.send({
        data: formatOpportunitiesForAgent(pagedData),
        meta: {
          limit,
          offset,
          includeInactive,
          paymentRequired: true,
          ...cacheMetaForResponse(cache)
        }
      });
    }
  );

  app.get<{
    Querystring: PersonalizedOpportunitiesQuery;
    Reply: ApiSuccess<PersonalizedOpportunityRecord[]> | ApiError;
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
        includeInactive = false,
        refresh = false
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
      const { data: fetched, cache } = await fetchOpportunitiesResult(
        SUPPORTED_AGGREGATE_PROTOCOLS,
        { refresh }
      );
      const data = filterOpportunitiesByActivity(fetched, includeInactive);

      const healthFactors = await loadWalletHealthFactors(address);
      const withRisk = attachOpportunityRisk(data, { healthFactors });

      const personalized = selectPersonalizedOpportunities(
        withRisk,
        holdings,
        offset + limit,
        { includeInactive }
      ).slice(offset, offset + limit);

      const formatted = formatOpportunitiesForAgent(personalized).map((row, index) => {
        const eligibility = evaluateOpportunityEligibility(
          personalized[index],
          row.opportunityId,
          holdings
        );
        return {
          ...row,
          canEnter: eligibility.canEnter,
          eligibilityFullyCheckable: eligibility.eligibilityFullyCheckable
        };
      });

      return reply.send({
        data: formatted,
        meta: {
          limit,
          offset,
          includeInactive,
          paymentRequired: true,
          address,
          heldAssetCount: holdings.heldAssetIds.size,
          eligibilityApplied: true,
          eligibilityEndpoint: "/eligibility",
          ...cacheMetaForResponse(cache)
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

/** Parse comma-separated ASA ids; keeps safe non-negative integers and dedupes. */
function parseAssetIdFilters(value: string | undefined): number[] {
  if (value === undefined) {
    return [];
  }

  const seen = new Set<number>();
  const ids: number[] = [];
  for (const entry of value.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    if (!/^\d+$/.test(trimmed)) {
      continue;
    }
    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      continue;
    }
    if (seen.has(parsed)) {
      continue;
    }
    seen.add(parsed);
    ids.push(parsed);
  }
  return ids;
}
