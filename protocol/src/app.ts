import Fastify from "fastify";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";

import {
  CompXAdapterError,
  DorkFiAdapterError,
  FolksFinanceAdapterError,
  PactAdapterError,
  TinymanAdapterError
} from "./adapters/index.js";
import { AccountAssetsError } from "./services/account-assets.js";
import { AllPositionSourcesUnavailableError } from "./services/aggregate-positions.js";
import { WalletSnapshotError } from "./services/wallet-snapshot.js";
import { ApiError } from "./types/index.js";
import { registerRoutes } from "./routes/index.js";

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
      : error instanceof TinymanAdapterError
          || error instanceof PactAdapterError
          || error instanceof FolksFinanceAdapterError
          || error instanceof CompXAdapterError
          || error instanceof DorkFiAdapterError
          || error instanceof AccountAssetsError
          || error instanceof WalletSnapshotError
          || error instanceof AllPositionSourcesUnavailableError
        ? {
            error: {
              code: "INTERNAL_ERROR",
              message: error.message
            }
          }
        : {
            error: {
              code: "INTERNAL_ERROR",
              message: "Internal server error."
            }
          };

    const statusCode =
      details
        ? 400
        : error instanceof TinymanAdapterError
          || error instanceof PactAdapterError
          || error instanceof FolksFinanceAdapterError
          || error instanceof CompXAdapterError
          || error instanceof DorkFiAdapterError
          || error instanceof AccountAssetsError
          || error instanceof WalletSnapshotError
          || error instanceof AllPositionSourcesUnavailableError
          ? 502
          : 500;

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
