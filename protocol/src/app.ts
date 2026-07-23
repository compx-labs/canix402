import Fastify from "fastify";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";

import {
  CompXAdapterError,
  DorkFiAdapterError,
  FolksFinanceAdapterError,
  HaystackAdapterError,
  MythFinanceAdapterError,
  PactAdapterError,
  RetiAdapterError,
  TinymanAdapterError
} from "./adapters/index.js";
import { AccountAssetsError } from "./services/account-assets.js";
import { AllPositionSourcesUnavailableError } from "./services/aggregate-positions.js";
import { WalletSnapshotError } from "./services/wallet-snapshot.js";
import { ApiError } from "./types/index.js";
import { registerRoutes } from "./routes/index.js";

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
    error instanceof AccountAssetsError ||
    error instanceof WalletSnapshotError ||
    error instanceof AllPositionSourcesUnavailableError
  );
}

export function buildApp() {
  const app = Fastify({
    logger: true
  }).withTypeProvider<TypeBoxTypeProvider>();

  registerRoutes(app);

  app.setErrorHandler((error, _request, reply) => {
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
