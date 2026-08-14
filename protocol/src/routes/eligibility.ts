import algosdk from "algosdk";
import type { FastifyInstance } from "fastify";

import { fetchEligibility } from "../services/eligibility.js";
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
      if (!algosdk.isValidAddress(address)) {
        return reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Body field 'address' is not a valid Algorand address."  // pragma: allowlist secret
          }
        });
      }

      return reply.send(await fetchEligibility(request.body));
    }
  );
}
