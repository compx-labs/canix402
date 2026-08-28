import Fastify from "fastify";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";

import {
  AlphaArcadeAdapterError,
  CompXAdapterError,
  DorkFiAdapterError,
  FolksFinanceAdapterError,
  HaystackAdapterError,
  MythFinanceAdapterError,
  PactAdapterError,
  RetiAdapterError,
  TinymanAdapterError
} from "./adapters/index.js";
import { setAppLogger } from "./observability/logger.js";
import { recordHttpRequest } from "./observability/metrics.js";
import { AccountAssetsError } from "./services/account-assets.js";
import { AllPositionSourcesUnavailableError } from "./services/aggregate-positions.js";
import { WalletSnapshotError } from "./services/wallet-snapshot.js";
import { ApiError } from "./types/index.js";
import { registerRoutes } from "./routes/index.js";
import { registerSessionGate } from "./plugins/session-gate.js";

function isUpstreamAdapterError(error: unknown): boolean {
  return (
    error instanceof TinymanAdapterError ||
    error instanceof PactAdapterError ||
    error instanceof FolksFinanceAdapterError ||
    error instanceof CompXAdapterError ||
    error instanceof DorkFiAdapterError ||
    error instanceof MythFinanceAdapterError ||
    error instanceof HaystackAdapterError ||
    error instanceof RetiAdapterError ||
    error instanceof AlphaArcadeAdapterError ||
    error instanceof AccountAssetsError ||
    error instanceof WalletSnapshotError ||
    error instanceof AllPositionSourcesUnavailableError
  );
}

export function buildApp() {
  const isProduction = process.env.NODE_ENV === "production";
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "info"),
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          'req.headers["payment-signature"]',
          'req.headers["x-canix-session"]',
          "X402_ALGOD_TOKEN",
          "REDIS_URL"
        ],
        remove: true
      }
    }
  }).withTypeProvider<TypeBoxTypeProvider>();

  setAppLogger(app.log);

  app.addHook("onRequest", async (request) => {
    (request as { metricsStartedAt?: bigint }).metricsStartedAt = process.hrtime.bigint();
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAt = (request as { metricsStartedAt?: bigint }).metricsStartedAt;
    const durationSeconds =
      startedAt === undefined
        ? 0
        : Number(process.hrtime.bigint() - startedAt) / 1e9;
    const route =
      request.routeOptions?.url ?? request.url.split("?")[0] ?? "unknown";
    recordHttpRequest(request.method, route, reply.statusCode, durationSeconds);
  });

  registerSessionGate(app);
  registerRoutes(app);

  app.setErrorHandler((error, request, reply) => {
    const details = getValidationDetails(error);
    const payload: ApiError = details
      ? {
          error: {
            code: "VALIDATION_ERROR",
            message: "Request validation failed.",
            details
          }
        }
      : isUpstreamAdapterError(error)
        ? {
            error: {
              code: "INTERNAL_ERROR",
              message: error instanceof Error ? error.message : "Upstream adapter error."
            }
          }
        : {
            error: {
              code: "INTERNAL_ERROR",
              message: "Internal server error."
            }
          };

    const statusCode = details ? 400 : isUpstreamAdapterError(error) ? 502 : 500;
    const code = payload.error.code;

    if (statusCode >= 500) {
      request.log.error(
        {
          err: error,
          code,
          statusCode
        },
        "Request failed"
      );
    } else if (statusCode >= 400) {
      request.log.warn(
        {
          err: error instanceof Error ? error.message : error,
          code,
          statusCode
        },
        "Request rejected"
      );
    }

    reply.status(statusCode).send(payload);
  });

  return app;
}

function getValidationDetails(error: unknown): unknown | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "validation" in error &&
    Array.isArray(error.validation)
  ) {
    return error.validation;
  }

  return null;
}
