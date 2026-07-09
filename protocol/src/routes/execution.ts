import { FastifyInstance, FastifyReply } from "fastify";

import {
  ExecutionError,
  InvalidShapeInputError,
  ShapeBuildError,
  ShapeNotFoundError,
  ShapeStateError,
  ShapeValidationError,
  compileExecutableQuote,
  createExecutionAlgodClient,
  executionRegistry
} from "../execution/index.js";
import { ApiError, ApiSuccess } from "../types/index.js";
import {
  ExecutionQuoteRequest,
  ExecutionQuoteRequestSchema,
  ExecutionQuoteResponseSchema
} from "../types/execution-quote-schema.js";
import type { ExecutableQuote } from "../execution/types.js";

export function registerExecutionRoutes(app: FastifyInstance) {
  app.post<{
    Body: ExecutionQuoteRequest;
    Reply: ApiSuccess<ExecutableQuote> | ApiError;
  }>(
    "/execution/quotes",
    {
      schema: {
        body: ExecutionQuoteRequestSchema,
        response: {
          200: ExecutionQuoteResponseSchema
        }
      }
    },
    async (request, reply) => {
      const { shapeKey, input } = request.body;

      try {
        const quote = await compileExecutableQuote(
          executionRegistry,
          shapeKey,
          input,
          {
            network: "mainnet",
            algod: createExecutionAlgodClient()
          }
        );

        return reply.send({
          data: quote,
          meta: {
            paymentRequired: true,
            executionSubmitted: false
          }
        });
      } catch (error) {
        mapExecutionError(reply, error);
        return;
      }
    }
  );
}

function mapExecutionError(reply: FastifyReply, error: unknown): void {
  if (error instanceof ShapeNotFoundError) {
    reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: error.message,
        details: error.details
      }
    });
    return;
  }

  if (error instanceof InvalidShapeInputError || error instanceof ShapeStateError) {
    reply.status(400).send({
      error: {
        code: "VALIDATION_ERROR",
        message: error.message,
        details: error.details
      }
    });
    return;
  }

  if (error instanceof ShapeValidationError || error instanceof ShapeBuildError) {
    reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: error.message,
        details: error.details
      }
    });
    return;
  }

  if (error instanceof ExecutionError) {
    reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: error.message,
        details: error.details
      }
    });
    return;
  }

  reply.status(500).send({
    error: {
      code: "INTERNAL_ERROR",
      message: "Failed to compile execution quote."
    }
  });
}
