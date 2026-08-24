import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { classifySessionBucket } from "../services/payment-policy.js";
import { getSessionStore } from "../services/session-store.js";
import type { ApiError, ApiErrorCode } from "../types/errors.js";
import type { SessionFailureReason, SessionReceipt } from "../types/session.js";

export const SESSION_HEADER = "x-canix-session";
export const SESSION_REMAINING_RESEARCH_HEADER = "x-canix-session-remaining-research";
export const SESSION_REMAINING_QUOTES_HEADER = "x-canix-session-remaining-quotes";
export const SESSION_EXPIRES_HEADER = "x-canix-session-expires-at";

const SESSION_ERROR_CODES: Record<SessionFailureReason, ApiErrorCode> = {
  invalid: "SESSION_INVALID",
  expired: "SESSION_EXPIRED",
  exhausted: "SESSION_EXHAUSTED",
  unavailable: "SESSION_UNAVAILABLE"
};

const SESSION_ERROR_MESSAGES: Record<SessionFailureReason, string> = {
  invalid:
    "Session receipt is missing or unknown. Omit X-Canix-Session and retry with a per-request PAYMENT-SIGNATURE, or buy a new session.",
  expired:
    "Prepaid session has expired. Omit X-Canix-Session and retry with a per-request PAYMENT-SIGNATURE, or POST /sessions / POST /sessions/refresh.",
  exhausted:
    "Prepaid session quota is exhausted. Omit X-Canix-Session and retry with a per-request PAYMENT-SIGNATURE, or refresh the session.",
  unavailable:
    "Session store is unavailable. Omit X-Canix-Session and retry with a per-request PAYMENT-SIGNATURE."
};

export function readSessionHeader(
  headers: FastifyRequest["headers"]
): string | undefined {
  const raw = headers[SESSION_HEADER] ?? headers["X-Canix-Session"];
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

export function sessionErrorPayload(reason: SessionFailureReason): ApiError {
  return {
    error: {
      code: SESSION_ERROR_CODES[reason],
      message: SESSION_ERROR_MESSAGES[reason]
    }
  };
}

function attachReceiptHeaders(reply: FastifyReply, receipt: SessionReceipt): void {
  reply.header(SESSION_REMAINING_RESEARCH_HEADER, String(receipt.remaining.research));
  reply.header(SESSION_REMAINING_QUOTES_HEADER, String(receipt.remaining.quotes));
  reply.header(SESSION_EXPIRES_HEADER, receipt.expiresAt);
}

export function registerSessionGate(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    if (request.method === "OPTIONS") {
      return;
    }
    const path = request.url.split("?")[0] ?? "";
    const token = readSessionHeader(request.headers);
    if (!token) {
      return;
    }
    const bucket = classifySessionBucket(path, request.method);
    if (!bucket) {
      return;
    }
    const result = await getSessionStore().consume(token, bucket);
    if (!result.ok) {
      return reply.status(402).send(sessionErrorPayload(result.reason));
    }
    attachReceiptHeaders(reply, result.receipt);
  });
}
