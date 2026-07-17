import { FastifyInstance, FastifyReply } from "fastify";

import {
  StrategyConflictError,
  StrategyForbiddenError,
  StrategyNotFoundError,
  StrategyValidationError,
  buildStrategyPaymentNote,
  getStrategyService
} from "../services/strategies.js";
import { ApiError, ApiSuccess } from "../types/index.js";
import {
  StrategyCompileBody,
  StrategyCompileBodySchema,
  StrategyDocument,
  StrategyDocumentSchema,
  StrategyIdParamsSchema,
  StrategyListQuery,
  StrategyListQuerySchema,
  StrategyPublishBody,
  StrategyPublishBodySchema,
  StrategyReviseBody,
  StrategyReviseBodySchema
} from "../types/strategy-schema.js";
import { Type } from "@sinclair/typebox";

const StrategyListResponseSchema = Type.Object({
  data: Type.Object({
    items: Type.Array(StrategyDocumentSchema),
    total: Type.Integer({ minimum: 0 })
  }),
  meta: Type.Record(Type.String(), Type.Unknown())
});

const StrategyDetailResponseSchema = Type.Object({
  data: StrategyDocumentSchema,
  meta: Type.Record(Type.String(), Type.Unknown())
});

export function registerStrategyRoutes(app: FastifyInstance) {
  const strategies = getStrategyService();

  app.get<{
    Querystring: StrategyListQuery;
    Reply: ApiSuccess<{ items: StrategyDocument[]; total: number }> | ApiError;
  }>(
    "/strategies",
    {
      schema: {
        querystring: StrategyListQuerySchema,
        response: { 200: StrategyListResponseSchema }
      }
    },
    async (request) => {
      const result = await strategies.list(request.query);
      return {
        data: result,
        meta: {
          paymentRequired: false,
          holderFeeShareBps: 5000
        }
      };
    }
  );

  app.get<{
    Params: { strategyId: number };
    Reply: ApiSuccess<StrategyDocument> | ApiError;
  }>(
    "/strategies/:strategyId",
    {
      schema: {
        params: StrategyIdParamsSchema,
        response: { 200: StrategyDetailResponseSchema }
      }
    },
    async (request, reply) => {
      try {
        const document = await strategies.get(request.params.strategyId);
        return {
          data: document,
          meta: {
            paymentRequired: false,
            holderFeeShareBps: document.holderFeeShareBps,
            feeDisclosure:
              "50% of strategy compile access fees are paid weekly to the strategy NFT holder."
          }
        };
      } catch (error) {
        return mapStrategyError(reply, error);
      }
    }
  );

  app.post<{
    Body: StrategyPublishBody;
    Reply: ApiSuccess<StrategyDocument> | ApiError;
  }>(
    "/strategies",
    {
      schema: {
        body: StrategyPublishBodySchema,
        response: { 200: StrategyDetailResponseSchema }
      }
    },
    async (request, reply) => {
      try {
        const document = await strategies.publish(request.body);
        return reply.send({
          data: document,
          meta: {
            paymentRequired: true,
            priceUsdc: process.env.X402_PRICE_STRATEGY_PUBLISH_USDC ?? "100",
            holderFeeShareBps: document.holderFeeShareBps
          }
        });
      } catch (error) {
        return mapStrategyError(reply, error);
      }
    }
  );

  app.post<{
    Params: { strategyId: number };
    Body: StrategyReviseBody;
    Reply: ApiSuccess<StrategyDocument> | ApiError;
  }>(
    "/strategies/:strategyId",
    {
      schema: {
        params: StrategyIdParamsSchema,
        body: StrategyReviseBodySchema,
        response: { 200: StrategyDetailResponseSchema }
      }
    },
    async (request, reply) => {
      try {
        const document = await strategies.revise(
          request.params.strategyId,
          request.body
        );
        return reply.send({
          data: document,
          meta: {
            paymentRequired: true,
            priceUsdc: process.env.X402_PRICE_STRATEGY_REVISE_USDC ?? "1",
            holderFeeShareBps: document.holderFeeShareBps
          }
        });
      } catch (error) {
        return mapStrategyError(reply, error);
      }
    }
  );

  app.post<{
    Params: { strategyId: number };
    Body: StrategyCompileBody;
    Reply: ApiSuccess<unknown> | ApiError;
  }>(
    "/strategies/:strategyId/compile",
    {
      schema: {
        params: StrategyIdParamsSchema,
        body: StrategyCompileBodySchema
      }
    },
    async (request, reply) => {
      try {
        const result = await strategies.compile(
          request.params.strategyId,
          request.body
        );
        return reply.send({
          data: {
            strategyId: result.strategy.strategyId,
            quotes: result.quotes,
            feeDisclosure: result.feeDisclosure
          },
          meta: {
            paymentRequired: true,
            priceUsdc: process.env.X402_PRICE_STRATEGY_COMPILE_USDC ?? "0.1",
            paymentNote: buildStrategyPaymentNote(result.strategy.strategyId),
            executionSubmitted: false
          }
        });
      } catch (error) {
        return mapStrategyError(reply, error);
      }
    }
  );
}

function mapStrategyError(reply: FastifyReply, error: unknown): void {
  if (
    error instanceof StrategyValidationError ||
    error instanceof StrategyNotFoundError ||
    error instanceof StrategyForbiddenError ||
    error instanceof StrategyConflictError
  ) {
    reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        details: "details" in error ? error.details : undefined
      }
    });
    return;
  }

  throw error;
}
