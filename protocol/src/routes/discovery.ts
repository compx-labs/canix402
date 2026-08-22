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
import { resolvePublicBaseUrl } from "../constants/public-url.js";
import {
  endpointPolicyMatrix,
  getX402EndpointMetadata
} from "../services/payment-policy.js";
import { ApiSuccess } from "../types/api.js";
import { DiscoveryDocument, DiscoveryEndpointDescriptor } from "../types/discovery.js";

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
  logoUrl: Type.String(),
  bannerUrl: Type.String(),
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

  app.get(
    "/llms.txt",
    {
      schema: {
        response: {
          200: Type.Any()
        }
      }
    },
    async (_request, reply) => reply.type("text/plain; charset=utf-8").send(buildLlmsText())
  );

  app.get(
    "/llms-full.txt",
    {
      schema: {
        response: {
          200: Type.Any()
        }
      }
    },
    async (_request, reply) => reply.type("text/plain; charset=utf-8").send(buildLlmsText(true))
  );

  app.get(
    "/robots.txt",
    {
      schema: {
        response: {
          200: Type.Any()
        }
      }
    },
    async (_request, reply) => reply.type("text/plain; charset=utf-8").send(buildRobotsTxt())
  );

  app.get(
    "/.well-known/agent-card.json",
    {
      schema: {
        response: {
          200: Type.Any()
        }
      }
    },
    async () => buildAgentCard()
  );

  app.get(
    "/.well-known/agent.json",
    {
      schema: {
        response: {
          200: Type.Any()
        }
      }
    },
    async () => buildAgentCard()
  );

  app.get(
    "/.well-known/ai-plugin.json",
    {
      schema: {
        response: {
          200: Type.Any()
        }
      }
    },
    async () => buildAiPluginManifest()
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
        endpoint.id === "positions" ||
        endpoint.id === "positionsClaimable" ||
        endpoint.id === "eligibility" ||
        endpoint.id === "plans" ||
        endpoint.id === "plansRebalance" ||
        endpoint.id === "executionCompose" ||
        endpoint.id === "executionSimulate"
          ? [200, 400, 402, 500, 502]
          : endpoint.id === "tokenPricing"
            ? [200, 400, 502]
          : endpoint.id === "haystackSwapQuote"
            ? [200, 400, 429, 502]
            : endpoint.id === "haystackSwapOptIn"
              ? [200, 400, 502]
              : endpoint.id === "haystackSwapTransactions"
                ? [200, 400, 402, 429, 502]
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
      "intent-plans",
      "rebalance-delta-plans",
      "swap-aware-compose",
      "execution-simulate",
      "haystack-swaps",
      "token-pricing",
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
        code: "NOT_FOUND",
        httpStatus: 404,
        description: "Requested resource was not found."
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
  logoUrl: string;
  bannerUrl: string;
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
  const publicBaseUrl = trimTrailingSlash(resolvePublicBaseUrl());
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
  const publicBaseUrl = resolvePublicBaseUrl();
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
    logoUrl: `${publicBaseUrl}/logo.png?v=2`,
    bannerUrl: `${publicBaseUrl}/banner.png?v=2`,
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

function buildLlmsText(includeAllEndpoints = false): string {
  const publicBaseUrl = getPublicBaseUrl();
  const paidEndpoints = endpointPolicyMatrix.filter((endpoint) => endpoint.access === "paid");
  const freeEndpoints = endpointPolicyMatrix.filter(
    (endpoint) =>
      endpoint.access === "free"
      && ![
        "health",
        "ready",
        "metrics",
        "metadata",
        "root",
        "faviconIco",
        "faviconPng",
        "logoPng",
        "bannerPng",
        "llmsTxt",
        "llmsFullTxt",
        "robotsTxt"
      ].includes(endpoint.id)
  );
  const endpoints = includeAllEndpoints
    ? [...freeEndpoints, ...paidEndpoints]
    : paidEndpoints;

  const lines = [
    "# CANIX402",
    "",
    "> x402-gated Algorand DeFi data and walletless transaction API for autonomous agents.",
    "",
    `Use the public Caddy gateway: ${publicBaseUrl}. The upstream API is private.`,
    `Canonical documentation: ${getDocsSiteUrl()}.`,
    `Full integration guide: ${getDocsSiteUrl()}/llms-full.txt.`,
    "",
    "## Machine-readable contracts",
    "",
    `- Discovery: ${publicBaseUrl}/discovery`,
    `- OpenAPI: ${publicBaseUrl}/openapi.json`,
    `- x402 manifest: ${publicBaseUrl}/.well-known/x402.json`,
    `- MCP: ${getMcpUrl()}`,
    "",
    `## ${includeAllEndpoints ? "API endpoints" : "Paid endpoints"}`,
    ""
  ];

  for (const endpoint of endpoints) {
    const path = endpoint.pathPattern.replace(":protocol", "{protocol}");
    const price =
      endpoint.access === "paid"
        ? ` — ${getX402EndpointMetadata(endpoint.priceUsdc).requirementTemplate.maxAmountRequired} USDC`
        : " — free";
    lines.push(`- ${endpoint.method} ${publicBaseUrl}${path}${price}: ${endpoint.summary}`);
  }

  lines.push(
    "",
    "Unpaid paid-route requests return HTTP 402 with PAYMENT-REQUIRED. Sign a USDC payment client-side and retry with PAYMENT-SIGNATURE. Canix never receives wallet keys or submits transactions.",
    "Do not guess execution construction (pool discovery, opt-ins, min-balance, slippage, liquidity limits, app upgrades). Read protocol/docs/execution-shapes/protocol-caveats.md and GET /execution/shapes meta.caveatsDocsPath."
  );

  return `${lines.join("\n")}\n`;
}

function buildRobotsTxt(): string {
  const publicBaseUrl = getPublicBaseUrl();
  const docsSiteUrl = getDocsSiteUrl();

  return [
    "User-agent: *",
    "Allow: /",
    "",
    `# Canonical agent documentation: ${docsSiteUrl}/llms.txt`,
    `# Gateway LLM index: ${publicBaseUrl}/llms.txt`,
    `# Full reference: ${publicBaseUrl}/llms-full.txt`,
    `# x402 service manifest: ${publicBaseUrl}/.well-known/x402.json`,
    `# A2A-compatible capability card: ${publicBaseUrl}/.well-known/agent-card.json`,
    `# OpenAPI specification: ${publicBaseUrl}/openapi.json`,
    `# Discovery document: ${publicBaseUrl}/discovery`,
    ""
  ].join("\n");
}

function buildAgentCard() {
  const publicBaseUrl = getPublicBaseUrl();
  const docsSiteUrl = getDocsSiteUrl();

  return {
    protocolVersion: "0.3.0",
    name: "canix402",
    description:
      "x402-gated Algorand DeFi data and walletless transaction API for agents. Paid requests settle in USDC through the public Caddy gateway; no API keys or server-side wallet access.",
    url: publicBaseUrl,
    preferredTransport: "HTTP+JSON",
    version: getApiVersion(),
    documentationUrl: `${docsSiteUrl}/llms.txt`,
    iconUrl: `${publicBaseUrl}/logo.png?v=2`,
    provider: {
      organization: "Neon Forge Ltd",
      url: docsSiteUrl,
      contact: "kieran@neonforge.ltd"
    },
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false
    },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: endpointPolicyMatrix
      .filter((endpoint) => endpoint.access === "paid")
      .map((endpoint) => {
        const path = endpoint.pathPattern.replace(":protocol", "{protocol}");

        return {
          id: endpoint.id,
          name: endpoint.summary,
          description: endpoint.description ?? endpoint.summary,
          tags: ["x402", "algorand", "defi", ...endpoint.tags],
          examples: [`${endpoint.method} ${publicBaseUrl}${path}`]
        };
      }),
    x402: {
      protocol: "x402",
      scheme: "exact",
      network: getX402EndpointMetadata().requirementTemplate.network,
      currency: "USDC",
      facilitator: getX402EndpointMetadata().facilitator,
      manifest: `${publicBaseUrl}/.well-known/x402.json`,
      openapi: `${publicBaseUrl}/openapi.json`,
      llmsTxt: `${docsSiteUrl}/llms.txt`,
      logoUrl: `${publicBaseUrl}/logo.png?v=2`,
      bannerUrl: `${publicBaseUrl}/banner.png?v=2`,
      note:
        "Make a normal HTTP request. An unpaid paid-route request returns HTTP 402 with payment requirements; sign client-side and retry with PAYMENT-SIGNATURE."
    }
  };
}

function buildAiPluginManifest() {
  const publicBaseUrl = getPublicBaseUrl();
  const docsSiteUrl = getDocsSiteUrl();

  return {
    schema_version: "v1",
    name_for_human: "canix402",
    name_for_model: "canix402",
    description_for_human:
      "Algorand DeFi data and walletless transaction API for agents, paid per call with USDC using x402.",
    description_for_model:
      "Use this public Caddy gateway for Algorand DeFi opportunities, positions, pricing, swap preparation, and unsigned transaction quotes. Free discovery endpoints describe paid operations. An unpaid paid request returns HTTP 402 with PAYMENT-REQUIRED; sign the requested USDC payment client-side and retry with PAYMENT-SIGNATURE. The service never receives wallet keys or submits transactions.",
    api: {
      type: "openapi",
      url: `${publicBaseUrl}/openapi.json`
    },
    legal_info_url: `${docsSiteUrl}/terms`,
    contact_email: "kieran@neonforge.ltd"
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

function getPublicBaseUrl(): string {
  return resolvePublicBaseUrl();
}

function getDocsSiteUrl(): string {
  return trimTrailingSlash(
    process.env.X402_DOCS_SITE_URL
      ?? process.env.PUBLIC_DOCS_SITE_URL
      ?? "https://canix402.compx.io"
  );
}

function getMcpUrl(): string {
  return process.env.X402_MCP_SERVER_URL ?? process.env.MCP_SERVER_URL ?? MCP_SERVER_REMOTE_URL;
}
