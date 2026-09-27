import type { FastifyInstance } from "fastify";

import { fetchEligibility } from "../services/eligibility.js";
import { parseWalletAddress, WALLET_ADDRESS_ERROR } from "../services/wallet-address.js";
import type { ApiError } from "../types/errors.js";
import type { EligibilityRequest, EligibilityResponse } from "../types/eligibility.js";
import {
  EligibilityRequestSchema,
  EligibilityResponseSchema
} from "../types/eligibility-schema.js";

export function registerEligibilityRoutes(app: FastifyInstance): void {
  app.post<{
    Body: EligibilityRequest;
    Reply: EligibilityResponse | ApiError;
  }>(
    "/eligibility",
    {
      schema: {
        body: EligibilityRequestSchema,
        response: {
          200: EligibilityResponseSchema
        }
      }
    },
    async (request, reply) => {
      const { address } = request.body;
      if (!parseWalletAddress(address)) {
        return reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: `Body field 'address' is invalid. ${WALLET_ADDRESS_ERROR}`
          }
        });
      }

      return reply.send(await fetchEligibility(request.body));
    }
  );
}
