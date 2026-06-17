import { Type } from "@sinclair/typebox";
import { FastifyInstance } from "fastify";

import { ApiSuccess } from "../types/index.js";
import { SupportedProtocolValues } from "./schemas.js";

interface HealthData {
  service: "canix402";
  status: "ok";
}

interface MetadataData {
  service: "canix402";
  environment: string;
  supportedProtocols: readonly string[];
}

const healthReplySchema = Type.Object({
  data: Type.Object({
    service: Type.Literal("canix402"),
    status: Type.Literal("ok")
  })
});

const metadataReplySchema = Type.Object({
  data: Type.Object({
    service: Type.Literal("canix402"),
    environment: Type.String(),
    supportedProtocols: Type.Array(Type.String())
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
          supportedProtocols: SupportedProtocolValues
        }
      };
    }
  );
}
