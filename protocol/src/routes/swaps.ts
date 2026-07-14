import type { FastifyInstance, FastifyReply } from "fastify";

import {
  HaystackRouterError,
  createHaystackService,
  type HaystackService
} from "../services/haystack-router.js";
import type { ApiError } from "../types/index.js";
import {
  SwapOptInRequestSchema,
  SwapOptInResponseSchema,
  SwapQuoteRequestSchema,
  SwapQuoteResponseSchema,
  SwapTransactionsRequestSchema,
  SwapTransactionsResponseSchema,
  type SwapOptInRequest,
  type SwapOptInResponse,
  type SwapQuoteRequest,
  type SwapQuoteResponse,
  type SwapTransactionsRequest,
  type SwapTransactionsResponse
} from "../types/swap-schema.js";

export function registerSwapRoutes(
  app: FastifyInstance,
  service: HaystackService = createHaystackService()
): void {
  app.post<{
    Body: SwapQuoteRequest;
    Reply: SwapQuoteResponse | ApiError;
  }>(
    "/swaps/quote",
    {
      schema: {
        body: SwapQuoteRequestSchema,
        response: {
          200: SwapQuoteResponseSchema
        }
      }
    },
    async (request, reply) => {
      try {
        const quote = await service.getQuote(request.body);
        return reply.send({
          data: quote,
          meta: {
            paymentRequired: false,
            executionSubmitted: false
          }
        });
      } catch (error) {
        sendHaystackError(reply, error);
        return;
      }
    }
  );

  app.post<{
    Body: SwapOptInRequest;
    Reply: SwapOptInResponse | ApiError;
  }>(
    "/swaps/optin",
    {
      schema: {
        body: SwapOptInRequestSchema,
        response: {
          200: SwapOptInResponseSchema
        }
      }
    },
    async (request, reply) => {
      try {
        const data = await service.buildOptIns(
          request.body.address,
          request.body.quote
        );
        return reply.send({
          data,
          meta: {
            paymentRequired: false,
            executionSubmitted: false
          }
        });
      } catch (error) {
        sendHaystackError(reply, error);
        return;
      }
    }
  );

  app.post<{
    Body: SwapTransactionsRequest;
    Reply: SwapTransactionsResponse | ApiError;
  }>(
    "/swaps/transactions",
    {
      schema: {
        body: SwapTransactionsRequestSchema,
        response: {
          200: SwapTransactionsResponseSchema
        }
      }
    },
    async (request, reply) => {
      try {
        const data = await service.buildSwapTransactions(
          request.body.address,
          request.body.quote,
          request.body.slippage
        );
        return reply.send({
          data,
          meta: {
            paymentRequired: true,
            executionSubmitted: false
          }
        });
      } catch (error) {
        sendHaystackError(reply, error);
        return;
      }
    }
  );
}

function sendHaystackError(reply: FastifyReply, error: unknown): void {
  if (error instanceof HaystackRouterError) {
    const statusCode =
      error.kind === "validation"
        ? 400
        : error.kind === "rate-limit"
          ? 429
          : 502;
    reply.status(statusCode).send({
      error: {
        code: error.kind === "validation" ? "VALIDATION_ERROR" : "INTERNAL_ERROR",
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details })
      }
    });
    return;
  }

  reply.status(500).send({
    error: {
      code: "INTERNAL_ERROR",
      message: "Failed to process the Haystack swap request."
    }
  });
}
