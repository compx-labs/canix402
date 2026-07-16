import type { FastifyInstance } from "fastify";

import { fetchCompXTokenPrices } from "../adapters/index.js";
import type { ApiError } from "../types/index.js";
import {
  PricingRequestSchema,
  PricingResponseSchema,
  type PricingRequest,
  type PricingResponse
} from "../types/pricing-schema.js";

export function registerPricingRoutes(app: FastifyInstance): void {
  app.post<{
    Body: PricingRequest;
    Reply: PricingResponse | ApiError;
  }>(
    "/pricing",
    {
      schema: {
        body: PricingRequestSchema,
        response: {
          200: PricingResponseSchema
        }
      }
    },
    async (request) => {
      const uniqueAssetIds = [...new Set(request.body.assetIds)];
      const pricesByAssetId = await fetchCompXTokenPrices(uniqueAssetIds);

      return {
        data: {
          prices: request.body.assetIds.map((assetId) => {
            const price = pricesByAssetId[String(assetId)];
            return {
              assetId: String(assetId),
              priceUsd:
                typeof price === "number" && Number.isFinite(price) && price >= 0
                  ? price
                  : null
            };
          }),
          source: "compx",
          fetchedAt: new Date().toISOString()
        },
        meta: {
          paymentRequired: false,
          executionSubmitted: false
        }
      };
    }
  );
}
