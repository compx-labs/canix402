import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/server";

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
        "Prepaid session policy (budget N/M, TTL, receipt URI template). Remaining quota is canix://session/{sessionId}, GET /sessions/{sessionId}, or canix_get_session. Sessions are receipts, not keys.",
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

  server.registerResource(
    "session-receipt",
    new ResourceTemplate("canix://session/{sessionId}", { list: undefined }),
    {
      description:
        "Prepaid session receipt remaining N/M (GET /sessions/{sessionId}). Unknown or expired receipts return 402 SESSION_INVALID/SESSION_EXPIRED.",
      mimeType: "application/json"
    },
    async (uri, { sessionId }) => {
      const id = Array.isArray(sessionId) ? sessionId[0] : sessionId;
      const path = `/sessions/${encodeURIComponent(String(id ?? ""))}`;
      const result = await client.fetchPaid(path, { method: "GET" });
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(result.body, null, 2)
          }
        ]
      };
    }
  );

  server.registerResource(
    "watch",
    "canix://watch",
    {
      description:
        "Watch retainer policy (TTL, price, signature/idempotency headers). Receipts and recent firings are canix://watch/{watchId}, GET /watch/{watchId}, or canix_get_watch. Watchers are address + callback only — no wallet keys.",
      mimeType: "application/json"
    },
    async (uri) => {
      const body = (await client.fetchFree("/discovery")) as {
        data?: { watchPolicy?: unknown };
        watchPolicy?: unknown;
      };
      const watchPolicy = body?.data?.watchPolicy ?? body?.watchPolicy ?? body;
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(watchPolicy, null, 2)
          }
        ]
      };
    }
  );

  server.registerResource(
    "watch-receipt",
    new ResourceTemplate("canix://watch/{watchId}", { list: undefined }),
    {
      description:
        "Watch retainer receipt and recent threshold firings (GET /watch/{watchId}). Unknown or expired receipts return 402 WATCH_INVALID/WATCH_EXPIRED.",
      mimeType: "application/json"
    },
    async (uri, { watchId }) => {
      const id = Array.isArray(watchId) ? watchId[0] : watchId;
      const path = `/watch/${encodeURIComponent(String(id ?? ""))}`;
      const result = await client.fetchPaid(path, { method: "GET" });
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(result.body, null, 2)
          }
        ]
      };
    }
  );
}
