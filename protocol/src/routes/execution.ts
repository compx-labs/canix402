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
  executionRegistry
} from "../execution/index.js";
import { ApiError, ApiSuccess } from "../types/index.js";
import {
  ExecutionQuoteRequest,
  ExecutionQuoteRequestSchema,
  ExecutionQuoteResponseSchema
} from "../types/execution-quote-schema.js";
import type { ExecutableQuote } from "../execution/types.js";

export function registerExecutionRoutes(app: FastifyInstance) {
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
