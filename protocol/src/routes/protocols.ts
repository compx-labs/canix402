import { FastifyInstance } from "fastify";

import {
  cacheMetaForResponse,
  fetchOpportunitiesForProtocolResult,
  summarizeCacheMeta
} from "../services/aggregate-opportunities.js";
import { filterOpportunitiesByActivity } from "../services/opportunity-activity.js";
import { rankOpportunities } from "../services/opportunity-ranking.js";
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
        includeInactive = false,
        refresh = false
      } = request.query;

      const result = await fetchOpportunitiesForProtocolResult(protocol, { refresh });
      const data = filterOpportunitiesByActivity(result.data, includeInactive);
      const pagedData = rankOpportunities(data).slice(offset, offset + limit);
      const cache = summarizeCacheMeta([result]);

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
}
