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
    Reply: ApiSuccess<ExecutableQuote> | ApiError;
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
      const { shapeKey, input } = request.body;

      try {
        const quote = await compileExecutableQuote(
          executionRegistry,
          shapeKey,
          input,
          {
            network: "mainnet",
            algod: createExecutionAlgodClient()
          }
        );

        return reply.send({
          data: quote,
          meta: {
            paymentRequired: true,
            executionSubmitted: false
          }
        });
      } catch (error) {
        mapExecutionError(reply, error);
        return;
      }
    }
  );
}

function mapExecutionError(reply: FastifyReply, error: unknown): void {
  if (error instanceof ShapeNotFoundError) {
    reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: error.message,
        details: error.details
      }
    });
    return;
  }

  if (error instanceof InvalidShapeInputError || error instanceof ShapeStateError) {
    reply.status(400).send({
      error: {
        code: "VALIDATION_ERROR",
        message: error.message,
        details: error.details
      }
    });
    return;
  }

  if (error instanceof ShapeValidationError || error instanceof ShapeBuildError) {
    reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: error.message,
        details: executionErrorDetails(error)
      }
    });
    return;
  }

  if (error instanceof ExecutionError) {
    reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: error.message,
        details: executionErrorDetails(error)
      }
    });
    return;
  }

  reply.status(500).send({
    error: {
      code: "INTERNAL_ERROR",
      message: "Failed to compile execution quote."
    }
  });
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
