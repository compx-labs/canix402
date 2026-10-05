import { Type } from "@sinclair/typebox";
import type { FastifyInstance, FastifyReply } from "fastify";

import {
  HAYSTACK_BUY_BONDING_SHAPE_KEY,
  HAYSTACK_LAUNCH_MAX_LIMIT
} from "../execution/shapes/haystack/launch-constants.js";
import { parseLaunchListQuery } from "../execution/shapes/haystack/launch-query.js";
import {
  getHaystackLaunch,
  HaystackLaunchError,
  listHaystackLaunches,
  type HaystackLaunchDetail,
  type HaystackLaunchListData
} from "../services/haystack-launches.js";
import type { ApiError, ApiSuccess } from "../types/index.js";

const LaunchRowSchema = Type.Object({
  tokenNum: Type.Integer(),
  assetId: Type.Integer(),
  name: Type.String(),
  symbol: Type.String(),
  assetUrl: Type.String(),
  creator: Type.String(),
  bondingTokenId: Type.Integer(),
  launchedAt: Type.String(),
  progressPercent: Type.Number(),
  priceBonding: Type.String(),
  priceUsd: Type.Union([Type.String(), Type.Null()]),
  realTokenReserves: Type.String(),
  realBondingReserves: Type.String(),
  initialRealTokenReserves: Type.String(),
  bondingTargetUsd: Type.String(),
  priceMultiplier: Type.String(),
  buyShapeKey: Type.String()
});

const LaunchListResponseSchema = Type.Object({
  data: Type.Object({
    launchedAfter: Type.String(),
    launchedBefore: Type.String(),
    order: Type.Union([Type.Literal("asc"), Type.Literal("desc")]),
    total: Type.Integer(),
    launches: Type.Array(LaunchRowSchema)
  }),
  meta: Type.Optional(
    Type.Object({
      paymentRequired: Type.Boolean(),
      shapeKey: Type.String()
    })
  )
});

const LaunchDetailSchema = Type.Object({
  tokenNum: Type.Integer(),
  assetId: Type.Integer(),
  name: Type.String(),
  symbol: Type.String(),
  assetUrl: Type.String(),
  description: Type.String(),
  socialWebsite: Type.String(),
  socialX: Type.String(),
  socialTelegram: Type.String(),
  socialDiscord: Type.String(),
  creator: Type.String(),
  bondingTokenId: Type.Integer(),
  bondingOn: Type.Integer(),
  phase: Type.Union([Type.Literal("bonding"), Type.Literal("graduated")]),
  progressPercent: Type.Number(),
  priceBonding: Type.String(),
  priceUsd: Type.Union([Type.String(), Type.Null()]),
  realTokenReserves: Type.String(),
  realBondingReserves: Type.String(),
  initialRealTokenReserves: Type.String(),
  virtualTokenReserves: Type.String(),
  virtualBondingReserves: Type.String(),
  bondingTargetUsd: Type.String(),
  priceMultiplier: Type.String(),
  poolAppId: Type.Integer(),
  lpTokenId: Type.Integer(),
  buyShapeKey: Type.Union([Type.String(), Type.Null()]),
  userHolding: Type.Union([Type.String(), Type.Null()]),
  note: Type.Union([Type.String(), Type.Null()])
});

const LaunchDetailResponseSchema = Type.Object({
  data: LaunchDetailSchema,
  meta: Type.Optional(
    Type.Object({
      paymentRequired: Type.Boolean()
    })
  )
});

const ListQuerySchema = Type.Object({
  q: Type.Optional(Type.String({ maxLength: 64 })),
  minProgress: Type.Optional(Type.String()),
  maxProgress: Type.Optional(Type.String()),
  order: Type.Optional(Type.String()),
  launchedAfter: Type.Optional(Type.String()),
  launchedBefore: Type.Optional(Type.String()),
  limit: Type.Optional(Type.String()),
  offset: Type.Optional(Type.String())
});

const DetailQuerySchema = Type.Object({
  assetId: Type.Optional(Type.String()),
  address: Type.Optional(Type.String())
});

export function registerHaystackLaunchRoutes(app: FastifyInstance): void {
  app.get<{
    Querystring: {
      q?: string;
      minProgress?: string;
      maxProgress?: string;
      order?: string;
      launchedAfter?: string;
      launchedBefore?: string;
      limit?: string;
      offset?: string;
    };
    Reply: ApiSuccess<HaystackLaunchListData> | ApiError;
  }>(
    "/protocols/haystack/launches",
    {
      schema: {
        querystring: ListQuerySchema,
        response: { 200: LaunchListResponseSchema }
      }
    },
    async (request, reply) => {
      const parsed = parseListQuery(request.query);
      if (parsed.error !== undefined) {
        return sendValidation(reply, parsed.error);
      }
      try {
        const data = await listHaystackLaunches(parsed.query);
        return {
          data,
          meta: {
            paymentRequired: true,
            shapeKey: HAYSTACK_BUY_BONDING_SHAPE_KEY
          }
        };
      } catch (error) {
        return sendLaunchError(reply, error);
      }
    }
  );

  app.get<{
    Params: { tokenNum: string };
    Querystring: { assetId?: string; address?: string };
    Reply: ApiSuccess<HaystackLaunchDetail> | ApiError;
  }>(
    "/protocols/haystack/launches/:tokenNum",
    {
      schema: {
        params: Type.Object({ tokenNum: Type.String() }),
        querystring: DetailQuerySchema,
        response: { 200: LaunchDetailResponseSchema }
      }
    },
    async (request, reply) => {
      const assetId = parseOptionalUint(request.query.assetId, "assetId");
      if (assetId.error) {
        return sendValidation(reply, assetId.error);
      }
      const tokenNum = parseOptionalUint(request.params.tokenNum, "tokenNum");
      if (assetId.value === undefined && tokenNum.error) {
        return sendValidation(reply, tokenNum.error ?? "tokenNum must be an integer.");
      }
      if (request.query.address && !/^[A-Z2-7]{58}$/.test(request.query.address)) {
        return sendValidation(reply, "address must be a valid Algorand address.");
      }
      try {
        const lookup =
          assetId.value === undefined
            ? { tokenNum: tokenNum.value ?? Number(request.params.tokenNum) }
            : { assetId: assetId.value };
        const data = await getHaystackLaunch({
          ...lookup,
          ...(request.query.address ? { address: request.query.address } : {})
        });
        return {
          data,
          meta: { paymentRequired: false }
        };
      } catch (error) {
        return sendLaunchError(reply, error);
      }
    }
  );
}

function parseListQuery(raw: {
  q?: string;
  minProgress?: string;
  maxProgress?: string;
  order?: string;
  launchedAfter?: string;
  launchedBefore?: string;
  limit?: string;
  offset?: string;
}): { query: ReturnType<typeof parseLaunchListQuery>; error?: undefined } | { error: string } {
  const minProgress = parseOptionalPercent(raw.minProgress, "minProgress");
  if (minProgress.error) {
    return { error: minProgress.error };
  }
  const maxProgress = parseOptionalPercent(raw.maxProgress, "maxProgress");
  if (maxProgress.error) {
    return { error: maxProgress.error };
  }
  if (
    minProgress.value !== undefined &&
    maxProgress.value !== undefined &&
    minProgress.value > maxProgress.value
  ) {
    return { error: "minProgress must be less than or equal to maxProgress." };
  }
  if (raw.order !== undefined && raw.order !== "asc" && raw.order !== "desc") {
    return { error: "order must be asc or desc." };
  }
  const limit = parseOptionalUint(raw.limit, "limit");
  if (limit.error) {
    return { error: limit.error };
  }
  if (limit.value !== undefined && (limit.value < 1 || limit.value > HAYSTACK_LAUNCH_MAX_LIMIT)) {
    return { error: `limit must be from 1 to ${HAYSTACK_LAUNCH_MAX_LIMIT}.` };
  }
  const offset = parseOptionalUint(raw.offset, "offset");
  if (offset.error) {
    return { error: offset.error };
  }
  return {
    query: parseLaunchListQuery({
      ...(raw.q !== undefined ? { q: raw.q } : {}),
      ...(minProgress.value !== undefined ? { minProgress: minProgress.value } : {}),
      ...(maxProgress.value !== undefined ? { maxProgress: maxProgress.value } : {}),
      ...(raw.order !== undefined ? { order: raw.order } : {}),
      ...(raw.launchedAfter !== undefined ? { launchedAfter: raw.launchedAfter } : {}),
      ...(raw.launchedBefore !== undefined ? { launchedBefore: raw.launchedBefore } : {}),
      ...(limit.value !== undefined ? { limit: limit.value } : {}),
      ...(offset.value !== undefined ? { offset: offset.value } : {})
    })
  };
}

function parseOptionalPercent(
  value: string | undefined,
  field: string
): { value?: number; error?: string } {
  if (value === undefined || value.trim() === "") {
    return {};
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    return { error: `${field} must be a number from 0 to 100.` };
  }
  return { value: parsed };
}

function parseOptionalUint(
  value: string | undefined,
  field: string
): { value?: number; error?: string } {
  if (value === undefined || value.trim() === "") {
    return {};
  }
  if (!/^\d+$/.test(value)) {
    return { error: `${field} must be an integer.` };
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    return { error: `${field} is out of range.` };
  }
  return { value: parsed };
}

function sendValidation(reply: FastifyReply, message: string) {
  return reply.status(400).send({
    error: { code: "VALIDATION_ERROR", message }
  });
}

function sendLaunchError(reply: FastifyReply, error: unknown) {
  if (error instanceof HaystackLaunchError) {
    const status = error.kind === "not-found" ? 404 : error.kind === "validation" ? 400 : 502;
    return reply.status(status).send({
      error: {
        code: error.kind === "not-found" ? "NOT_FOUND" : error.kind === "validation" ? "VALIDATION_ERROR" : "INTERNAL_ERROR",
        message: error.message
      }
    });
  }
  return reply.status(502).send({
    error: {
      code: "INTERNAL_ERROR",
      message: "Failed to read Haystack launches."
    }
  });
}
