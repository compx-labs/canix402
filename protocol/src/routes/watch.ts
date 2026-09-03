import algosdk from "algosdk";
import type { FastifyInstance, FastifyRequest } from "fastify";

import type { ApiError } from "../types/errors.js";
import type { WatchFailureReason, WatchReceipt } from "../types/watch.js";
import {
  WatchCreateRequestSchema,
  WatchRefreshRequestSchema,
  WatchResponseSchema,
  type WatchCreateRequest,
  type WatchRefreshRequest,
  type WatchResponse
} from "../types/watch-schema.js";
import { getWatchStore } from "../services/watch-store.js";
import { validateWebhookUrl, WATCH_SECRET_HEADER } from "../services/watch-webhook.js";

function watchSuccess(
  receipt: WatchReceipt,
  access: "watch" | "receipt" | "rotate",
  paymentRequired: boolean
): WatchResponse {
  return {
    data: receipt,
    meta: {
      paymentRequired,
      access,
      receiptUri: receipt.uri,
      secretShown: Boolean(receipt.webhookSecret)
    }
  };
}

function watchErrorPayload(reason: WatchFailureReason): ApiError {
  const messages: Record<WatchFailureReason, { code: ApiError["error"]["code"]; message: string }> = {
    invalid: {
      code: "WATCH_INVALID",
      message: "Watch receipt is unknown. Register a new paid watch with POST /watch."
    },
    expired: {
      code: "WATCH_EXPIRED",
      message: "Watch retainer TTL has elapsed. Pay POST /watch to register again, or POST /watch/refresh before expiry."
    },
    unavailable: {
      code: "WATCH_UNAVAILABLE",
      message: "Watch store is unavailable. Fail-closed; retry later."
    },
    unauthorized: {
      code: "WATCH_UNAUTHORIZED",
      message: "Watch signing secret does not match. Rotate requires X-Canix-Watch-Secret."
    }
  };
  return { error: messages[reason] };
}

function readWatchSecret(headers: FastifyRequest["headers"]): string | undefined {
  const raw = headers[WATCH_SECRET_HEADER] ?? headers["X-Canix-Watch-Secret"];
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(raw) && typeof raw[0] === "string") {
    const trimmed = raw[0].trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

export function registerWatchRoutes(app: FastifyInstance): void {
  app.post<{
    Body: WatchCreateRequest;
    Reply: WatchResponse | ApiError;
  }>(
    "/watch",
    {
      schema: {
        body: WatchCreateRequestSchema,
        response: {
          200: WatchResponseSchema
        }
      }
    },
    async (request, reply) => {
      const { address, thresholds, webhookUrl } = request.body;
      if (!algosdk.isValidAddress(address)) {
        return reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Body field 'address' is not a valid Algorand address."  // pragma: allowlist secret
          }
        });
      }
      const normalizedWebhook = webhookUrl?.trim() || null;
      if (normalizedWebhook) {
        const webhookError = validateWebhookUrl(normalizedWebhook);
        if (webhookError) {
          return reply.status(400).send({
            error: {
              code: "VALIDATION_ERROR",
              message: webhookError
            }
          });
        }
      }
      const result = await getWatchStore().create({
        address,
        thresholds,
        webhookUrl: normalizedWebhook
      });
      if (!result.ok) {
        return reply.status(503).send(watchErrorPayload("unavailable"));
      }
      return reply.send(watchSuccess(result.receipt, "watch", true));
    }
  );

  app.post<{
    Body: WatchRefreshRequest;
    Reply: WatchResponse | ApiError;
  }>(
    "/watch/refresh",
    {
      schema: {
        body: WatchRefreshRequestSchema,
        response: {
          200: WatchResponseSchema
        }
      }
    },
    async (request, reply) => {
      const watchId = request.body.watchId?.trim();
      if (!watchId) {
        return reply.status(402).send(watchErrorPayload("invalid"));
      }
      const result = await getWatchStore().refresh(watchId, {
        rotateSecret: request.body.rotateSecret === true
      });
      if (!result.ok) {
        const status = result.reason === "unavailable" ? 503 : 402;
        return reply.status(status).send(watchErrorPayload(result.reason));
      }
      return reply.send(watchSuccess(result.receipt, "watch", true));
    }
  );

  app.get<{
    Params: { watchId: string };
    Reply: WatchResponse | ApiError;
  }>(
    "/watch/:watchId",
    {
      schema: {
        response: {
          200: WatchResponseSchema
        }
      }
    },
    async (request, reply) => {
      const watchId = request.params.watchId?.trim();
      if (!watchId) {
        return reply.status(402).send(watchErrorPayload("invalid"));
      }
      const result = await getWatchStore().get(watchId);
      if (!result.ok) {
        const status = result.reason === "unavailable" ? 503 : 402;
        return reply.status(status).send(watchErrorPayload(result.reason));
      }
      return reply.send(watchSuccess(result.receipt, "receipt", false));
    }
  );

  app.post<{
    Params: { watchId: string };
    Reply: WatchResponse | ApiError;
  }>(
    "/watch/:watchId/rotate-secret",
    {
      schema: {
        response: {
          200: WatchResponseSchema
        }
      }
    },
    async (request, reply) => {
      const watchId = request.params.watchId?.trim();
      const secret = readWatchSecret(request.headers);
      if (!watchId) {
        return reply.status(402).send(watchErrorPayload("invalid"));
      }
      if (!secret) {
        return reply.status(402).send(watchErrorPayload("unauthorized"));
      }
      const result = await getWatchStore().rotateSecret(watchId, secret);
      if (!result.ok) {
        const status = result.reason === "unavailable" ? 503 : 402;
        return reply.status(status).send(watchErrorPayload(result.reason));
      }
      return reply.send(watchSuccess(result.receipt, "rotate", false));
    }
  );
}
