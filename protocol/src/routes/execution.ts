import algosdk from "algosdk";
import { FastifyInstance, FastifyReply } from "fastify";

import {
  ExecutionError,
  InvalidShapeInputError,
  ShapeBuildError,
  ShapeNotFoundError,
  ShapeStateError,
  ShapeValidationError,
  compileExecutableQuote,
  createExecutionAlgodClient,
  executionRegistry,
  listExecutionShapeCatalog,
  EXECUTION_PROTOCOL_CAVEATS_DOCS_PATH
} from "../execution/index.js";
import { ApiError, ApiSuccess } from "../types/index.js";
import {
  ExecutionQuoteRequest,
  ExecutionQuoteRequestSchema,
  ExecutionQuoteResponseSchema
} from "../types/execution-quote-schema.js";
import {
  ExecutionShapeCatalogEntryDto,
  ExecutionShapesListResponseSchema
} from "../types/execution-shapes-schema.js";
import type { ExecutableQuote } from "../execution/types.js";
import {
  compileCompose,
  ComposeValidationError
} from "../services/compose.js";
import { HaystackRouterError } from "../services/haystack-router.js";
import {
  ComposeRequestSchema,
  ComposeResponseSchema,
  type ComposeRequest,
  type ComposeResponse
} from "../types/compose-schema.js";
import {
  SimulationRequestSchema,
  SimulationResponseSchema,
  type SimulationRequest,
  type SimulationResponse
} from "../types/simulate-schema.js";
import {
  simulateCompiledGroups,
  SimulateValidationError
} from "../services/simulate.js";

export function registerExecutionRoutes(app: FastifyInstance) {
  app.get<{
    Reply: ApiSuccess<ExecutionShapeCatalogEntryDto[]>;
  }>(
    "/execution/shapes",
    {
      schema: {
        response: {
          200: ExecutionShapesListResponseSchema
        }
      }
    },
    async (_request, reply) => {
      const data = listExecutionShapeCatalog(executionRegistry);
      return reply.send({
        data,
        meta: {
          paymentRequired: false,
          shapeCount: data.length,
          note:
            "Catalog metadata only. Compile unsigned groups via paid POST /execution/quotes. Protocol construction caveats: protocol/docs/execution-shapes/protocol-caveats.md",
          caveatsDocsPath: EXECUTION_PROTOCOL_CAVEATS_DOCS_PATH
        }
      });
    }
  );

  app.post<{
    Body: ExecutionQuoteRequest;
    Reply: ApiSuccess<ExecutableQuote[]> | ApiError;
  }>(
    "/execution/quotes",
    {
      schema: {
        body: ExecutionQuoteRequestSchema,
        response: {
          200: ExecutionQuoteResponseSchema
        }
      }
    },
    async (request, reply) => {
      const { quotes: quoteRequests } = request.body;
      const quotes: ExecutableQuote[] = [];
      const context = {
        network: "mainnet" as const,
        algod: createExecutionAlgodClient()
      };

      for (let quoteIndex = 0; quoteIndex < quoteRequests.length; quoteIndex += 1) {
        const item = quoteRequests[quoteIndex]!;
        try {
          quotes.push(
            await compileExecutableQuote(
              executionRegistry,
              item.shapeKey,
              item.input,
              context
            )
          );
        } catch (error) {
          mapExecutionError(reply, error, {
            quoteIndex,
            shapeKey: item.shapeKey
          });
          return;
        }
      }

      return reply.send({
        data: quotes,
        meta: {
          paymentRequired: true,
          executionSubmitted: false,
          quoteCount: quotes.length
        }
      });
    }
  );

  app.post<{
    Body: ComposeRequest;
    Reply: ComposeResponse | ApiError;
  }>(
    "/execution/compose",
    {
      schema: {
        body: ComposeRequestSchema,
        response: {
          200: ComposeResponseSchema
        }
      }
    },
    async (request, reply) => {
      const { address, amount } = request.body;
      if (!algosdk.isValidAddress(address)) {
        return reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Body field 'address' is not a valid Algorand address." // pragma: allowlist secret
          }
        });
      }

      try {
        if (BigInt(amount) <= 0n) {
          return reply.status(400).send({
            error: {
              code: "VALIDATION_ERROR",
              message: "Body field 'amount' must be greater than zero."
            }
          });
        }
      } catch {
        return reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Body field 'amount' must be a base-unit integer string."
          }
        });
      }

      try {
        return reply.send(await compileCompose(request.body));
      } catch (error) {
        if (error instanceof ComposeValidationError) {
          return reply.status(400).send({
            error: {
              code: "VALIDATION_ERROR",
              message: error.message
            }
          });
        }
        if (error instanceof HaystackRouterError) {
          const statusCode =
            error.kind === "validation"
              ? 400
              : error.kind === "rate-limit"
                ? 429
                : 502;
          return reply.status(statusCode).send({
            error: {
              code: error.kind === "validation" ? "VALIDATION_ERROR" : "INTERNAL_ERROR",
              message: error.message,
              ...(error.details === undefined ? {} : { details: error.details })
            }
          });
        }
        throw error;
      }
    }
  );

  app.post<{
    Body: SimulationRequest;
    Reply: SimulationResponse | ApiError;
  }>(
    "/execution/simulate",
    {
      schema: {
        body: SimulationRequestSchema,
        response: {
          200: SimulationResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!algosdk.isValidAddress(request.body.address)) {
        return reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Body field 'address' is not a valid Algorand address." // pragma: allowlist secret
          }
        });
      }

      try {
        return reply.send(await simulateCompiledGroups(request.body));
      } catch (error) {
        if (error instanceof SimulateValidationError) {
          return reply.status(400).send({
            error: {
              code: "VALIDATION_ERROR",
              message: error.message
            }
          });
        }
        throw error;
      }
    }
  );
}

function mapExecutionError(
  reply: FastifyReply,
  error: unknown,
  correlation: { quoteIndex: number; shapeKey: string }
): void {
  const correlationDetails = {
    quoteIndex: correlation.quoteIndex,
    shapeKey: correlation.shapeKey
  };

  if (error instanceof ShapeNotFoundError) {
    reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: error.message,
        details: mergeErrorDetails(error.details, correlationDetails)
      }
    });
    return;
  }

  if (error instanceof InvalidShapeInputError || error instanceof ShapeStateError) {
    reply.status(400).send({
      error: {
        code: "VALIDATION_ERROR",
        message: error.message,
        details: mergeErrorDetails(error.details, correlationDetails)
      }
    });
    return;
  }

  if (error instanceof ShapeValidationError || error instanceof ShapeBuildError) {
    reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: error.message,
        details: mergeErrorDetails(executionErrorDetails(error), correlationDetails)
      }
    });
    return;
  }

  if (error instanceof ExecutionError) {
    reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: error.message,
        details: mergeErrorDetails(executionErrorDetails(error), correlationDetails)
      }
    });
    return;
  }

  reply.status(500).send({
    error: {
      code: "INTERNAL_ERROR",
      message: "Failed to compile execution quote.",
      details: correlationDetails
    }
  });
}

function mergeErrorDetails(
  existing: unknown,
  correlation: { quoteIndex: number; shapeKey: string }
): Record<string, unknown> {
  if (existing === undefined) {
    return { ...correlation };
  }
  if (isRecord(existing) && !Array.isArray(existing)) {
    return { ...existing, ...correlation };
  }
  return { details: existing, ...correlation };
}

function executionErrorDetails(error: ExecutionError): unknown {
  const cause = serializeErrorCause(error.cause);
  if (cause === undefined) {
    return error.details;
  }

  if (error.details === undefined) {
    return { cause };
  }

  if (isRecord(error.details) && !Array.isArray(error.details)) {
    return { ...error.details, cause };
  }

  return {
    details: error.details,
    cause
  };
}

function serializeErrorCause(
  cause: unknown,
  seen = new WeakSet<object>(),
  depth = 0
): unknown {
  if (cause === undefined) {
    return undefined;
  }
  if (
    cause === null
    || typeof cause === "string"
    || typeof cause === "number"
    || typeof cause === "boolean"
  ) {
    return cause;
  }
  if (typeof cause === "bigint") {
    return cause.toString();
  }
  if (typeof cause === "symbol" || typeof cause === "function") {
    return String(cause);
  }
  if (depth >= 5) {
    return "[Max depth reached]";
  }
  if (seen.has(cause)) {
    return "[Circular]";
  }

  seen.add(cause);

  if (cause instanceof Error) {
    const serialized: Record<string, unknown> = {
      name: cause.name,
      message: cause.message
    };

    if (cause.stack !== undefined) {
      serialized.stack = cause.stack;
    }

    copyKnownErrorField(cause, serialized, "code");
    copyKnownErrorField(cause, serialized, "status");
    copyKnownErrorField(cause, serialized, "statusCode");

    const properties = serializeObjectEntries(cause, seen, depth);
    if (Object.keys(properties).length > 0) {
      serialized.properties = properties;
    }

    const nestedCause = (cause as { cause?: unknown }).cause;
    if (nestedCause !== undefined) {
      serialized.cause = serializeErrorCause(nestedCause, seen, depth + 1);
    }

    return serialized;
  }

  if (Array.isArray(cause)) {
    return cause.map((value) => serializeErrorCause(value, seen, depth + 1));
  }

  const serialized = serializeObjectEntries(cause, seen, depth);
  const constructorName = cause.constructor?.name;
  if (constructorName !== undefined && constructorName !== "Object") {
    return {
      type: constructorName,
      ...serialized
    };
  }
  return serialized;
}

function serializeObjectEntries(
  value: object,
  seen: WeakSet<object>,
  depth: number
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      serializeErrorCause(entry, seen, depth + 1)
    ])
  );
}

function copyKnownErrorField(
  source: Error,
  target: Record<string, unknown>,
  field: "code" | "status" | "statusCode"
): void {
  const value = (source as Error & Partial<Record<typeof field, unknown>>)[field];
  if (value !== undefined) {
    target[field] = serializeErrorCause(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
