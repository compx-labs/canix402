import { FastifyInstance } from "fastify";

import { fetchOpportunitiesForProtocol } from "../services/aggregate-opportunities.js";
import { filterOpportunitiesByActivity } from "../services/opportunity-activity.js";
import { rankOpportunitiesByApy } from "../services/opportunity-ranking.js";
import { formatOpportunitiesForAgent } from "../services/precision.js";
import { ApiSuccess } from "../types/index.js";
import { OpportunityRecordV1 } from "../types/opportunity.js";
import { OpportunitiesListResponseSchema } from "../types/opportunity-schema.js";
import {
  PROTOCOL_OPPORTUNITIES_DEFAULT_LIMIT,
  ProtocolOpportunitiesParams,
  ProtocolOpportunitiesParamsSchema,
  ProtocolOpportunitiesQuery,
  ProtocolOpportunitiesQuerySchema
} from "./schemas.js";

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
          200: OpportunitiesListResponseSchema
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

      const data = filterOpportunitiesByActivity(
        await fetchOpportunitiesForProtocol(protocol),
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
}
