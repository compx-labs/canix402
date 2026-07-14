import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Type } from "@sinclair/typebox";
import { FastifyInstance } from "fastify";

import {
  MCP_SERVER_INSTALL_URL,
  MCP_SERVER_REMOTE_URL,
  MCP_SERVER_TRANSPORT,
  MCP_TOOL_NAMES
} from "../constants/mcp.js";
import {
  endpointPolicyMatrix,
  getX402EndpointMetadata
} from "../services/payment-policy.js";
import { ApiSuccess } from "../types/api.js";
import { DiscoveryDocument, DiscoveryEndpointDescriptor } from "../types/discovery.js";

const DEFAULT_PUBLIC_BASE_URL = "https://canix402-api.compx.io";
const DEFAULT_DOCS_URL = "https://canix402.compx.io/x402";
const DEFAULT_LLMS_TXT_URL = "https://canix402.compx.io/llms.txt";

const discoveryReplySchema = Type.Object({
  data: Type.Object({
    service: Type.Literal("canix402"),
    apiVersion: Type.String(),
    discoveryVersion: Type.Literal("1.0.0"),
    capabilities: Type.Array(Type.String()),
    x402ProtocolVersion: Type.Literal(2),
    mcpServer: Type.Optional(
      Type.Object({
        name: Type.String(),
        transport: Type.Union([Type.Literal("streamable-http"), Type.Literal("stdio")]),
        url: Type.Optional(Type.String()),
        install: Type.Optional(Type.String()),
        docsUrl: Type.String(),
        tools: Type.Array(Type.String())
      })
    ),
    endpoints: Type.Array(Type.Any()),
    errorCatalog: Type.Array(Type.Any())
  })
});

const x402ManifestReplySchema = Type.Object({
  service: Type.Literal("canix402"),
  name: Type.Literal("canix402"),
  version: Type.String(),
  description: Type.String(),
  x402Version: Type.Literal(2),
  docsUrl: Type.String(),
  llmsTxtUrl: Type.String(),
  openapiUrl: Type.String(),
  discoveryUrl: Type.String(),
  mcpInstall: Type.Optional(Type.String()),
  mcpUrl: Type.Optional(Type.String()),
  mcpTransport: Type.Optional(Type.String()),
  facilitator: Type.String(),
  chains: Type.Array(Type.Any()),
  resources: Type.Array(Type.Any())
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

  app.get(
    "/.well-known/x402",
    {
      schema: {
        response: {
          200: Type.Object({
            version: Type.Literal(1),
            resources: Type.Array(Type.String())
          })
        }
      }
    },
    async () => buildWellKnownX402FanOut()
  );

  app.get(
    "/.well-known/x402.json",
    {
      schema: {
        response: {
          200: x402ManifestReplySchema
        }
      }
    },
    async () => buildX402Manifest()
  );
}

function buildDiscoveryDocument(): DiscoveryDocument {
  const mcpUrl =
    process.env.X402_MCP_SERVER_URL
    ?? process.env.MCP_SERVER_URL
    ?? MCP_SERVER_REMOTE_URL;

  const endpoints: DiscoveryEndpointDescriptor[] = endpointPolicyMatrix.map((endpoint) => {
    const baseDescriptor: DiscoveryEndpointDescriptor = {
      id: endpoint.id,
      method: endpoint.method,
      path: endpoint.pathPattern,
      access: endpoint.access,
      summary: endpoint.summary,
      ...(endpoint.description ? { description: endpoint.description } : {}),
      tags: endpoint.tags,
      pathParams: endpoint.pathParams ?? [],
      queryParams: endpoint.queryParams ?? [],
      responseCodes:
        endpoint.id === "positions"
          ? [200, 400, 402, 500, 502]
          : endpoint.access === "paid"
            ? [200, 402, 500]
            : [200, 500]
    };

    return endpoint.access === "paid"
      ? {
          ...baseDescriptor,
          x402: getX402EndpointMetadata(endpoint.priceUsdc)
        }
      : baseDescriptor;
  });

  return {
    service: "canix402",
    apiVersion: getApiVersion(),
    discoveryVersion: "1.0.0",
    capabilities: [
      "algorand-defi-opportunities",
      "x402-paid-data",
      "wallet-personalization",
      "agent-discovery",
      "openapi",
      "execution-quotes",
      "mcp-server"
    ],
    x402ProtocolVersion: 2,
    mcpServer: {
      name: "canix402",
      transport: MCP_SERVER_TRANSPORT,
      url: mcpUrl,
      install:
        "Connect your MCP client to the remote canix402 endpoint at /mcp (walletless pass-through).",
      docsUrl: MCP_SERVER_INSTALL_URL,
      tools: [...MCP_TOOL_NAMES]
    },
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

interface X402DiscoveryManifest {
  service: "canix402";
  name: "canix402";
  version: string;
  description: string;
  x402Version: 2;
  docsUrl: string;
  llmsTxtUrl: string;
  openapiUrl: string;
  discoveryUrl: string;
  mcpInstall: string;
  mcpUrl: string;
  mcpTransport: string;
  facilitator: string;
  chains: Array<{
    namespace: "algorand";
    network: string;
    assets: Array<{
      symbol: "USDC";
      assetId: string;
      decimals: 6;
    }>;
  }>;
  resources: Array<{
    id: string;
    method: "GET" | "POST";
    path: string;
    url: string;
    description: string;
    tags: string[];
    price: {
      amount: string;
      currency: "USDC";
      network: string;
      asset: string;
    };
    x402: ReturnType<typeof getX402EndpointMetadata>;
  }>;
}

function buildWellKnownX402FanOut(): { version: 1; resources: string[] } {
  const publicBaseUrl = trimTrailingSlash(
    process.env.X402_PUBLIC_BASE_URL
      ?? process.env.PUBLIC_GATEWAY_BASE_URL
      ?? DEFAULT_PUBLIC_BASE_URL
  );
  const paidEndpoints = endpointPolicyMatrix.filter((endpoint) => endpoint.access === "paid");

  return {
    version: 1,
    resources: paidEndpoints.map((endpoint) => {
      const path = endpoint.pathPattern.replace(":protocol", "{protocol}");
      return `${publicBaseUrl}${path}`;
    })
  };
}

function buildX402Manifest(): X402DiscoveryManifest {
  const publicBaseUrl = trimTrailingSlash(
    process.env.X402_PUBLIC_BASE_URL
      ?? process.env.PUBLIC_GATEWAY_BASE_URL
      ?? DEFAULT_PUBLIC_BASE_URL
  );
  const docsUrl =
    process.env.X402_DOCS_URL ?? process.env.PUBLIC_DOCS_URL ?? DEFAULT_DOCS_URL;
  const llmsTxtUrl =
    process.env.X402_LLMS_TXT_URL ?? process.env.PUBLIC_LLMS_TXT_URL ?? DEFAULT_LLMS_TXT_URL;
  const paidEndpoints = endpointPolicyMatrix.filter((endpoint) => endpoint.access === "paid");
  const defaultX402 = getX402EndpointMetadata();
  const mcpUrl =
    process.env.X402_MCP_SERVER_URL
    ?? process.env.MCP_SERVER_URL
    ?? MCP_SERVER_REMOTE_URL;

  return {
    service: "canix402",
    name: "canix402",
    version: getApiVersion(),
    description:
      "x402-gated Algorand DeFi opportunities data API with USDC payment support.",
    x402Version: 2,
    docsUrl,
    llmsTxtUrl,
    openapiUrl: `${publicBaseUrl}/openapi.json`,
    discoveryUrl: `${publicBaseUrl}/discovery`,
    mcpInstall: MCP_SERVER_INSTALL_URL,
    mcpUrl,
    mcpTransport: MCP_SERVER_TRANSPORT,
    facilitator: defaultX402.facilitator,
    chains: [
      {
        namespace: "algorand",
        network: defaultX402.requirementTemplate.network,
        assets: [
          {
            symbol: "USDC",
            assetId: defaultX402.requirementTemplate.asset,
            decimals: 6
          }
        ]
      }
    ],
    resources: paidEndpoints.map((endpoint) => {
      const x402 = getX402EndpointMetadata(endpoint.priceUsdc);
      const path = endpoint.pathPattern.replace(":protocol", "{protocol}");

      return {
        id: endpoint.id,
        method: endpoint.method,
        path,
        url: `${publicBaseUrl}${path}`,
        description: endpoint.description ?? endpoint.summary,
        tags: endpoint.tags,
        price: {
          amount: x402.requirementTemplate.maxAmountRequired,
          currency: "USDC",
          network: x402.requirementTemplate.network,
          asset: x402.requirementTemplate.asset
        },
        x402
      };
    })
  };
}

function loadOpenApiDocument(): unknown {
  const filePath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../openapi/openapi.json"
  );
  return JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
}

function getApiVersion(): string {
  return process.env.npm_package_version ?? "0.1.0";
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
