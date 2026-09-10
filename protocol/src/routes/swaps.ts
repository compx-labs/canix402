import type { FastifyInstance, FastifyReply } from "fastify";

import {
  MetaSwapError,
  createMetaSwapService,
  type MetaSwapService
} from "../services/meta-swap-router.js";
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
  service: MetaSwapService = createMetaSwapService()
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
        sendSwapError(reply, error);
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
        sendSwapError(reply, error);
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
        sendSwapError(reply, error);
        return;
      }
    }
  );
}

function sendSwapError(reply: FastifyReply, error: unknown): void {
  if (error instanceof MetaSwapError) {
    const statusCode =
      error.kind === "validation" || error.kind === "expired"
        ? 400
        : error.kind === "configuration"
          ? 503
          : error.kind === "rate-limit"
            ? 429
            : error.kind === "no-route"
              ? 404
              : 502;
    reply.status(statusCode).send({
      error: {
        code:
          error.kind === "validation" || error.kind === "expired"
            ? "VALIDATION_ERROR"
            : error.kind === "no-route"
              ? "NOT_FOUND"
              : "INTERNAL_ERROR",
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details })
      }
    });
    return;
  }

  reply.status(500).send({
    error: {
      code: "INTERNAL_ERROR",
      message: "Failed to process the swap request."
    }
  });
}
