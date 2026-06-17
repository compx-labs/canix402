import { Type } from "@sinclair/typebox";
import { FastifyInstance } from "fastify";

import { fetchTinymanOpportunities, TinymanAdapterError } from "../adapters/index.js";
import { ApiSuccess } from "../types/index.js";
import { OpportunityRecordV1 } from "../types/opportunity.js";
import {
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
      const { limit = 50, offset = 0, includeInactive = false } = request.query;

      let data: OpportunityRecordV1[] = [];
      try {
        if (protocol === "tinyman") {
          data = await fetchTinymanOpportunities();
        }
      } catch (error) {
        if (error instanceof TinymanAdapterError) {
          throw error;
        }
        throw error;
      }

      const pagedData = data.slice(offset, offset + limit);

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
