import type { McpServer } from "@modelcontextprotocol/server";

import type { X402Client } from "./lib/x402-client.js";

export function registerResources(server: McpServer, client: X402Client): void {
  server.registerResource(
    "discovery",
    "canix://discovery",
    {
      description: "Live canix402 discovery document (GET /discovery)",
      mimeType: "application/json"
    },
    async (uri) => {
      const body = await client.fetchFree("/discovery");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(body, null, 2)
          }
        ]
      };
    }
  );

  server.registerResource(
    "openapi",
    "canix://openapi",
    {
      description: "Live canix402 OpenAPI contract (GET /openapi.json)",
      mimeType: "application/json"
    },
    async (uri) => {
      const body = await client.fetchFree("/openapi.json");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(body, null, 2)
          }
        ]
      };
    }
  );

  server.registerResource(
    "execution-shapes",
    "canix://execution-shapes",
    {
      description:
        "Live verified execution shape catalog (GET /execution/shapes). Metadata only; quotes remain paid. meta.caveatsDocsPath is protocol/docs/execution-shapes/protocol-caveats.md.",
      mimeType: "application/json"
    },
    async (uri) => {
      const body = await client.fetchFree("/execution/shapes");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(body, null, 2)
          }
        ]
      };
    }
  );

  server.registerResource(
    "session",
    "canix://session",
    {
      description:
        "Prepaid session policy (budget N/M, TTL, receipt URI template). Remaining quota is GET /sessions/{sessionId} or canix_get_session. Sessions are receipts, not keys.",
      mimeType: "application/json"
    },
    async (uri) => {
      const body = (await client.fetchFree("/discovery")) as {
        data?: { sessionPolicy?: unknown };
        sessionPolicy?: unknown;
      };
      const sessionPolicy = body?.data?.sessionPolicy ?? body?.sessionPolicy ?? body;
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(sessionPolicy, null, 2)
          }
        ]
      };
    }
  );
}
