import { Type } from "@sinclair/typebox";
import { FastifyInstance } from "fastify";

import { ApiSuccess } from "../types/index.js";
import {
  OpportunitiesQuery,
  OpportunitiesQuerySchema,
  Protocol
} from "./schemas.js";

interface OpportunityRecord {
  protocol: Protocol;
  opportunityType: "staking" | "lending" | "lp-farming";
  apr: number;
  apy: number;
}

const opportunitiesReplySchema = Type.Object({
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

export function registerOpportunityRoutes(app: FastifyInstance) {
  app.get<{ Querystring: OpportunitiesQuery; Reply: ApiSuccess<OpportunityRecord[]> }>(
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

      const data: OpportunityRecord[] = protocol
        ? [
            {
              protocol,
              opportunityType: "staking",
              apr: 0,
              apy: 0
            }
          ]
        : [];

      return {
        data,
        meta: {
          limit,
          offset,
          includeInactive
        }
      };
    }
  );
}
