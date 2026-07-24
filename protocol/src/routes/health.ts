import { Type } from "@sinclair/typebox";
import { FastifyInstance } from "fastify";

import { metricsContentType, renderMetrics } from "../observability/metrics.js";
import { ApiSuccess } from "../types/index.js";
import { endpointPolicyMatrix } from "../services/payment-policy.js";
import { getReadinessReport, ReadinessStatus } from "../services/readiness.js";
import { SupportedProtocolValues } from "./schemas.js";

interface HealthData {
  service: "canix402";
  status: "ok";
}

interface MetadataData {
  service: "canix402";
  environment: string;
  supportedProtocols: readonly string[];
  endpointPolicy: typeof endpointPolicyMatrix;
}

interface ReadyData {
  service: "canix402";
  status: ReadinessStatus;
  checks: {
    algod: {
      ok: boolean;
      latencyMs?: number;
      error?: string;
    };
    redis: {
      configured: boolean;
      ok: boolean;
      latencyMs?: number;
      error?: string;
    };
  };
}

const healthReplySchema = Type.Object({
  data: Type.Object({
    service: Type.Literal("canix402"),
    status: Type.Literal("ok")
  })
});

const dependencyCheckSchema = Type.Object({
  ok: Type.Boolean(),
  latencyMs: Type.Optional(Type.Number()),
  error: Type.Optional(Type.String())
});

const redisCheckSchema = Type.Object({
  configured: Type.Boolean(),
  ok: Type.Boolean(),
  latencyMs: Type.Optional(Type.Number()),
  error: Type.Optional(Type.String())
});

const readyReplySchema = Type.Object({
  data: Type.Object({
    service: Type.Literal("canix402"),
    status: Type.Union([
      Type.Literal("ready"),
      Type.Literal("degraded"),
      Type.Literal("not_ready")
    ]),
    checks: Type.Object({
      algod: dependencyCheckSchema,
      redis: redisCheckSchema
    })
  })
});

const metadataReplySchema = Type.Object({
  data: Type.Object({
    service: Type.Literal("canix402"),
    environment: Type.String(),
    supportedProtocols: Type.Array(Type.String()),
    endpointPolicy: Type.Array(
      Type.Object({
        id: Type.String(),
        method: Type.Union([Type.Literal("GET"), Type.Literal("POST")]),
        pathPattern: Type.String(),
        access: Type.Union([Type.Literal("free"), Type.Literal("paid")]),
        summary: Type.String(),
        description: Type.Optional(Type.String()),
        tags: Type.Array(Type.String()),
        pathParams: Type.Optional(Type.Array(Type.String())),
        queryParams: Type.Optional(Type.Array(Type.String())),
        priceUsdc: Type.Optional(Type.String())
      })
    )
  })
});

export function registerHealthRoutes(app: FastifyInstance) {
  app.get<{ Reply: ApiSuccess<HealthData> }>(
    "/health",
    {
      schema: {
        response: {
          200: healthReplySchema
        }
      }
    },
    async () => {
      return {
        data: {
          service: "canix402",
          status: "ok"
        }
      };
    }
  );

  app.get<{ Reply: ApiSuccess<ReadyData> }>(
    "/ready",
    {
      schema: {
        response: {
          200: readyReplySchema,
          503: readyReplySchema
        }
      }
    },
    async (_request, reply) => {
      const report = await getReadinessReport();
      const payload = { data: report };
      if (report.status === "not_ready") {
        return reply.status(503).send(payload);
      }
      return reply.status(200).send(payload);
    }
  );

  app.get("/metrics", async (_request, reply) => {
    const body = await renderMetrics();
    return reply
      .header("content-type", metricsContentType())
      .status(200)
      .send(body);
  });

  app.get<{ Reply: ApiSuccess<MetadataData> }>(
    "/metadata",
    {
      schema: {
        response: {
          200: metadataReplySchema
        }
      }
    },
    async () => {
      return {
        data: {
          service: "canix402",
          environment: process.env.NODE_ENV ?? "development",
          supportedProtocols: SupportedProtocolValues,
          endpointPolicy: endpointPolicyMatrix
        }
      };
    }
  );
}
