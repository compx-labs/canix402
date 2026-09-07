import type { FastifyInstance, FastifyReply } from "fastify";

import {
  FolksRouterError,
  createFolksRouterService,
  type FolksRouterService
} from "../services/folks-router.js";
import type { ApiError } from "../types/index.js";
import {
  FolksSwapOptInRequestSchema,
  FolksSwapQuoteRequestSchema,
  FolksSwapQuoteResponseSchema,
  FolksSwapTransactionsRequestSchema,
  FolksSwapTransactionsResponseSchema,
  SwapOptInResponseSchema,
  type FolksSwapOptInRequest,
  type FolksSwapQuoteRequest,
  type FolksSwapQuoteResponse,
  type FolksSwapTransactionsRequest,
  type FolksSwapTransactionsResponse,
  type SwapOptInResponse
} from "../types/swap-schema.js";

export function registerFolksSwapRoutes(
  app: FastifyInstance,
  service: FolksRouterService = createFolksRouterService()
): void {
  app.post<{
    Body: FolksSwapQuoteRequest;
    Reply: FolksSwapQuoteResponse | ApiError;
  }>(
    "/swaps/folks/quote",
    {
      schema: {
        body: FolksSwapQuoteRequestSchema,
        response: {
          200: FolksSwapQuoteResponseSchema
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
        sendFolksRouterError(reply, error);
        return;
      }
    }
  );

  app.post<{
    Body: FolksSwapOptInRequest;
    Reply: SwapOptInResponse | ApiError;
  }>(
    "/swaps/folks/optin",
    {
      schema: {
        body: FolksSwapOptInRequestSchema,
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
        sendFolksRouterError(reply, error);
        return;
      }
    }
  );

  app.post<{
    Body: FolksSwapTransactionsRequest;
    Reply: FolksSwapTransactionsResponse | ApiError;
  }>(
    "/swaps/folks/transactions",
    {
      schema: {
        body: FolksSwapTransactionsRequestSchema,
        response: {
          200: FolksSwapTransactionsResponseSchema
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
        sendFolksRouterError(reply, error);
        return;
      }
    }
  );
}

function sendFolksRouterError(reply: FastifyReply, error: unknown): void {
  if (error instanceof FolksRouterError) {
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
      message: "Failed to process the Folks Router swap request."
    }
  });
}
