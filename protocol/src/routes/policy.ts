import type { FastifyInstance } from "fastify";

import {
  PolicyValidationError,
  validatePolicy
} from "../services/policy.js";
import type { ApiError } from "../types/errors.js";
import type { PolicyValidateRequest, PolicyValidateResponse } from "../types/policy.js";
import {
  PolicyValidateRequestSchema,
  PolicyValidateResponseSchema
} from "../types/policy-schema.js";

export function registerPolicyRoutes(app: FastifyInstance): void {
  app.post<{
    Body: PolicyValidateRequest;
    Reply: PolicyValidateResponse | ApiError;
  }>(
    "/policy/validate",
    {
      schema: {
        body: PolicyValidateRequestSchema,
        response: {
          200: PolicyValidateResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (request.body.plan === undefined && request.body.quotes === undefined) {
        return reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Body must include a compiled 'plan' and/or proposed 'quotes[]'."
          }
        });
      }

      try {
        return reply.send(validatePolicy(request.body));
      } catch (error) {
        if (error instanceof PolicyValidationError) {
          return reply.status(400).send({
            error: {
              code: "VALIDATION_ERROR",
              message: error.message
            }
          });
        }
        throw error;
      }
    }
  );
}
