import { McpServer } from "@modelcontextprotocol/server";

import { loadConfig, type McpConfig } from "./lib/config.js";
import { X402Client, type FetchFn } from "./lib/x402-client.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { registerFreeTools } from "./tools/free.js";
import { registerHaystackTools } from "./tools/haystack.js";
import { registerPaidTools } from "./tools/paid.js";

export interface CreateServerOptions {
  config?: McpConfig;
  fetchImpl?: FetchFn;
}

export function createCanixMcpServer(options: CreateServerOptions = {}): McpServer {
  const config = options.config ?? loadConfig();
  const client = new X402Client(config, options.fetchImpl);

  const server = new McpServer(
    {
      name: "canix402",
      version: "1.0.0"
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {}
      },
      instructions: [
        "canix402 MCP server for Algorand DeFi opportunities, execution quotes, and Haystack swaps.",
        "Always use the Caddy gateway URL configured via CANIX402_API_URL.",
        "Free tools: health, metadata, discovery, openapi, list_execution_shapes.",
        "Paid tools are walletless passthrough wrappers: initial call returns PAYMENT-REQUIRED metadata, retry with paymentSignature.",
        `API URL: ${config.apiUrl}.`
      ].join(" ")
    }
  );

  registerFreeTools(server, client);
  registerPaidTools(server, client);
  registerHaystackTools(server, client);
  registerResources(server, client);
  registerPrompts(server);

  return server;
}
