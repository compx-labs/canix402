import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";

import { EXECUTION_SHAPES } from "../lib/execution-shapes.js";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import type { X402Client } from "../lib/x402-client.js";

export function registerFreeTools(server: McpServer, client: X402Client): void {
  server.registerTool(
    "canix_health",
    {
      description:
        "Check canix402 gateway liveness via GET /health. Free endpoint; no x402 payment required.",
      inputSchema: {}
    },
    async () => {
      try {
        const body = await client.fetchFree("/health");
        return jsonResult(body);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "canix_get_metadata",
    {
      description:
        "Fetch canix402 service metadata and the endpoint policy matrix via GET /metadata. Free endpoint.",
      inputSchema: {}
    },
    async () => {
      try {
        const body = await client.fetchFree("/metadata");
        return jsonResult(body);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "canix_get_discovery",
    {
      description:
        "Fetch the agent discovery catalog via GET /discovery, including free/paid endpoint metadata and x402 requirements. Free endpoint.",
      inputSchema: {}
    },
    async () => {
      try {
        const body = await client.fetchFree("/discovery");
        return jsonResult(body);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "canix_get_openapi",
    {
      description:
        "Fetch the OpenAPI 3.1 contract via GET /openapi.json. Free endpoint. Use for request/response schemas.",
      inputSchema: {}
    },
    async () => {
      try {
        const body = await client.fetchFree("/openapi.json");
        return jsonResult(body);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "canix_get_token_prices",
    {
      description:
        "Fetch CompX USD oracle prices for Algorand asset IDs via POST /pricing. Free endpoint; missing prices are returned as null.",
      inputSchema: {
        assetIds: z.array(z.number().int().min(0)).min(1).max(100)
      }
    },
    async (args) => {
      try {
        const body = await client.fetchFree("/pricing", {
          method: "POST",
          body: { assetIds: args.assetIds }
        });
        return jsonResult(body);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "canix_list_execution_shapes",
    {
      description:
        "List verified execution shape keys that can be passed to canix_get_execution_quote. Local catalog; no payment required.",
      inputSchema: {}
    },
    async () => {
      return jsonResult({
        shapes: EXECUTION_SHAPES,
        note: "Quotes are compiled via paid POST /execution/quotes (0.10 USDC). Canix returns unsigned transactions only."
      });
    }
  );
}
