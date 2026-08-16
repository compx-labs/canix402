import algosdk from "algosdk";
import type { FastifyInstance } from "fastify";

import { compilePlan, PlanValidationError } from "../services/plans.js";
import type { ApiError } from "../types/errors.js";
import type { PlanRequest, PlanResponse } from "../types/plan.js";
import { PlanRequestSchema, PlanResponseSchema } from "../types/plan-schema.js";

export function registerPlanRoutes(app: FastifyInstance): void {
  app.post<{
    Body: PlanRequest;
    Reply: PlanResponse | ApiError;
  }>(
    "/plans",
    {
      schema: {
        body: PlanRequestSchema,
        response: {
          200: PlanResponseSchema
        }
      }
    },
    async (request, reply) => {
      const { address, budget } = request.body;
      if (!algosdk.isValidAddress(address)) {
        return reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Body field 'address' is not a valid Algorand address."  // pragma: allowlist secret
          }
        });
      }

      try {
        if (BigInt(budget.amount) <= 0n) {
          return reply.status(400).send({
            error: {
              code: "VALIDATION_ERROR",
              message: "Body field 'budget.amount' must be greater than zero."
            }
          });
        }
      } catch {
        return reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Body field 'budget.amount' must be a base-unit integer string."
          }
        });
      }

      try {
        return reply.send(await compilePlan(request.body));
      } catch (error) {
        if (error instanceof PlanValidationError) {
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
