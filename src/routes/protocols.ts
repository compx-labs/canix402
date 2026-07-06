import { Type } from "@sinclair/typebox";
import { FastifyInstance } from "fastify";

import {
  CompXAdapterError,
  DorkFiAdapterError,
  fetchCompXOpportunities,
  fetchFolksFinanceOpportunities,
  fetchDorkFiOpportunities,
  FolksFinanceAdapterError,
  fetchPactOpportunities,
  PactAdapterError,
  fetchTinymanOpportunities,
  TinymanAdapterError
} from "../adapters/index.js";
import { rankOpportunitiesByApy } from "../services/opportunity-ranking.js";
import { formatOpportunitiesForAgent } from "../services/precision.js";
import { ApiSuccess } from "../types/index.js";
import { OpportunityRecordV1 } from "../types/opportunity.js";
import {
  PROTOCOL_OPPORTUNITIES_DEFAULT_LIMIT,
  ProtocolOpportunitiesParams,
  ProtocolOpportunitiesParamsSchema,
  ProtocolOpportunitiesQuery,
  ProtocolOpportunitiesQuerySchema
} from "./schemas.js";

const protocolOpportunitiesReplySchema = Type.Object({
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

export function registerProtocolRoutes(app: FastifyInstance) {
  app.get<{
    Params: ProtocolOpportunitiesParams;
    Querystring: ProtocolOpportunitiesQuery;
    Reply: ApiSuccess<OpportunityRecordV1[]>;
  }>(
    "/protocols/:protocol/opportunities",
    {
      schema: {
        params: ProtocolOpportunitiesParamsSchema,
        querystring: ProtocolOpportunitiesQuerySchema,
        response: {
          200: protocolOpportunitiesReplySchema
        }
      }
    },
    async (request) => {
      const { protocol } = request.params;
      const {
        limit = PROTOCOL_OPPORTUNITIES_DEFAULT_LIMIT,
        offset = 0,
        includeInactive = false
      } = request.query;

      let data: OpportunityRecordV1[] = [];
      try {
        if (protocol === "tinyman") {
          data = await fetchTinymanOpportunities();
        } else if (protocol === "pact") {
          data = await fetchPactOpportunities();
        } else if (protocol === "folks-finance") {
          data = await fetchFolksFinanceOpportunities();
        } else if (protocol === "compx") {
          data = await fetchCompXOpportunities();
        } else if (protocol === "dorkfi") {
          data = await fetchDorkFiOpportunities();
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
}
