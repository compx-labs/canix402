import { Type } from "@sinclair/typebox";
import { FastifyInstance } from "fastify";

import {
  fetchTinymanOpportunities,
  TinymanAdapterError
} from "../adapters/index.js";
import { ApiSuccess } from "../types/index.js";
import { OpportunityRecordV1 } from "../types/opportunity.js";
import {
  OpportunitiesQuery,
  OpportunitiesQuerySchema,
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
      const { limit = 50, offset = 0, includeInactive = false, protocol } =
        request.query;

      let data: OpportunityRecordV1[] = [];

      try {
        if (protocol === "tinyman") {
          data = await fetchTinymanOpportunities();
        } else if (protocol === undefined) {
          data = await fetchTinymanOpportunities();
        } else if (SupportedProtocolValues.includes(protocol)) {
          data = [];
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
