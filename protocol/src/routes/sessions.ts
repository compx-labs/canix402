import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";

import { sessionErrorPayload, readSessionHeader } from "../plugins/session-gate.js";
import { getSessionStore } from "../services/session-store.js";
import type { ApiError } from "../types/errors.js";
import type { SessionReceipt } from "../types/session.js";
import {
  SessionRefreshRequestSchema,
  SessionResponseSchema,
  type SessionRefreshRequest,
  type SessionResponse
} from "../types/session-schema.js";

function sessionSuccess(
  receipt: SessionReceipt,
  access: "session" | "receipt",
  paymentRequired: boolean
): SessionResponse {
  return {
    data: receipt,
    meta: {
      paymentRequired,
      access,
      receiptUri: receipt.uri
    }
  };
}

export function registerSessionRoutes(app: FastifyInstance): void {
  app.post<{ Reply: SessionResponse | ApiError }>(
    "/sessions",
    {
      schema: {
        response: {
          200: SessionResponseSchema
        }
      }
    },
    async (_request, reply) => {
      const result = await getSessionStore().create();
      if (!result.ok) {
        return reply.status(503).send(sessionErrorPayload("unavailable"));
      }
      return reply.send(sessionSuccess(result.receipt, "session", true));
    }
  );

  app.post<{
    Body: SessionRefreshRequest | undefined;
    Reply: SessionResponse | ApiError;
  }>(
    "/sessions/refresh",
    {
      schema: {
        body: Type.Optional(SessionRefreshRequestSchema),
        response: {
          200: SessionResponseSchema
        }
      }
    },
    async (request, reply) => {
      const fromHeader = readSessionHeader(request.headers);
      const sessionId = request.body?.sessionId?.trim() || fromHeader;
      const result = await getSessionStore().refresh(sessionId);
      if (!result.ok) {
        return reply.status(503).send(sessionErrorPayload("unavailable"));
      }
      return reply.send(sessionSuccess(result.receipt, "session", true));
    }
  );

  app.get<{
    Params: { sessionId: string };
    Reply: SessionResponse | ApiError;
  }>(
    "/sessions/:sessionId",
    {
      schema: {
        response: {
          200: SessionResponseSchema
        }
      }
    },
    async (request, reply) => {
      const sessionId = request.params.sessionId?.trim();
      if (!sessionId) {
        return reply.status(402).send(sessionErrorPayload("invalid"));
      }
      const receipt = await getSessionStore().get(sessionId);
      if (!receipt) {
        return reply.status(402).send(sessionErrorPayload("invalid"));
      }
      if (receipt.status === "expired") {
        return reply.status(402).send(sessionErrorPayload("expired"));
      }
      return reply.send(sessionSuccess(receipt, "receipt", false));
    }
  );
}
