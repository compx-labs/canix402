import { Type } from "@sinclair/typebox";
import { FastifyInstance } from "fastify";

import { ApiSuccess } from "../types/index.js";
import {
  Protocol,
  ProtocolOpportunitiesParams,
  ProtocolOpportunitiesParamsSchema,
  ProtocolOpportunitiesQuery,
  ProtocolOpportunitiesQuerySchema
} from "./schemas.js";

interface ProtocolOpportunityRecord {
  protocol: Protocol;
  opportunityType: "staking" | "lending" | "lp-farming";
  apr: number;
  apy: number;
}

const protocolOpportunitiesReplySchema = Type.Object({
  data: Type.Array(
    Type.Object({
      protocol: Type.String(),
      opportunityType: Type.String(),
      apr: Type.Number(),
      apy: Type.Number()
    })
  ),
  meta: Type.Optional(
    Type.Object({
      limit: Type.Integer(),
      offset: Type.Integer(),
      includeInactive: Type.Boolean()
    })
  )
});

export function registerProtocolRoutes(app: FastifyInstance) {
  app.get<{
    Params: ProtocolOpportunitiesParams;
    Querystring: ProtocolOpportunitiesQuery;
    Reply: ApiSuccess<ProtocolOpportunityRecord[]>;
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

      return {
        data: [
          {
            protocol,
            opportunityType: "staking",
            apr: 0,
            apy: 0
          }
        ],
        meta: {
          limit,
          offset,
          includeInactive
        }
      };
    }
  );
}
