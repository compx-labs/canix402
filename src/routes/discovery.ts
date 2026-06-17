import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Type } from "@sinclair/typebox";
import { FastifyInstance } from "fastify";

import {
  endpointPolicyMatrix,
  getX402EndpointMetadata
} from "../services/payment-policy.js";
import { ApiSuccess } from "../types/api.js";
import { DiscoveryDocument, DiscoveryEndpointDescriptor } from "../types/discovery.js";

const discoveryReplySchema = Type.Object({
  data: Type.Object({
    service: Type.Literal("canix402"),
    apiVersion: Type.String(),
    discoveryVersion: Type.Literal("1.0.0"),
    capabilities: Type.Array(Type.String()),
    x402ProtocolVersion: Type.Literal(2),
    endpoints: Type.Array(Type.Any()),
    errorCatalog: Type.Array(Type.Any())
  })
});

export function registerDiscoveryRoutes(app: FastifyInstance) {
  app.get<{ Reply: ApiSuccess<DiscoveryDocument> }>(
    "/discovery",
    {
      schema: {
        response: {
          200: discoveryReplySchema
        }
      }
    },
    async () => {
      return {
        data: buildDiscoveryDocument()
      };
    }
  );

  app.get(
    "/openapi.json",
    {
      schema: {
        response: {
          200: Type.Any()
        }
      }
    },
    async () => loadOpenApiDocument()
  );
}

function buildDiscoveryDocument(): DiscoveryDocument {
  const x402Metadata = getX402EndpointMetadata();
  const endpoints: DiscoveryEndpointDescriptor[] = endpointPolicyMatrix.map((endpoint) => {
    const baseDescriptor: DiscoveryEndpointDescriptor = {
      id: endpoint.id,
      method: endpoint.method,
      path: endpoint.pathPattern,
      access: endpoint.access,
      summary: endpoint.summary,
      tags: endpoint.tags,
      pathParams: endpoint.pathParams ?? [],
      queryParams: endpoint.queryParams ?? [],
      responseCodes: endpoint.access === "paid" ? [200, 402, 500] : [200, 500]
    };

    return endpoint.access === "paid"
      ? {
          ...baseDescriptor,
          x402: x402Metadata
        }
      : baseDescriptor;
  });

  return {
    service: "canix402",
    apiVersion: process.env.npm_package_version ?? "0.1.0",
    discoveryVersion: "1.0.0",
    capabilities: [
      "algorand-defi-opportunities",
      "x402-paid-data",
      "agent-discovery",
      "openapi"
    ],
    x402ProtocolVersion: 2,
    endpoints,
    errorCatalog: [
      {
        code: "MISSING_PAYMENT_SIGNATURE",
        httpStatus: 402,
        description: "The paid endpoint was called without PAYMENT-SIGNATURE."
      },
      {
        code: "MALFORMED_PAYMENT_SIGNATURE",
        httpStatus: 402,
        description: "PAYMENT-SIGNATURE payload is malformed."
      },
      {
        code: "EXPIRED_PAYMENT_PROOF",
        httpStatus: 402,
        description: "PAYMENT-SIGNATURE proof has expired."
      },
      {
        code: "VALIDATION_ERROR",
        httpStatus: 400,
        description: "Request validation failed."
      },
      {
        code: "INTERNAL_ERROR",
        httpStatus: 500,
        description: "Internal server error."
      }
    ]
  };
}

function loadOpenApiDocument(): unknown {
  const filePath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../openapi/openapi.json"
  );
  return JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
}
