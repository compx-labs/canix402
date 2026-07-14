import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { WorkerConfig } from "./config.js";
import { GatewayClient, type FetchFn } from "./client.js";
import { registerCanixPrompts, registerCanixResources, registerCanixTools } from "./register.js";

export interface CreateWorkerServerOptions {
  config: WorkerConfig;
  fetchImpl?: FetchFn;
}

export function createCanixWorkerMcpServer(options: CreateWorkerServerOptions): McpServer {
  const client = new GatewayClient(
    {
      gatewayUrl: options.config.gatewayUrl
    },
    options.fetchImpl
  );

  const server = new McpServer(
    {
      name: "canix402-remote",
      version: "1.0.0"
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {}
      },
      instructions: [
        "Remote canix402 MCP server for Algorand DeFi opportunities, execution quotes, and Haystack swaps.",
        `Gateway URL: ${options.config.gatewayUrl}.`,
        "Paid tools are walletless passthrough wrappers.",
        "First paid call returns PAYMENT-REQUIRED details; retry with paymentSignature."
      ].join(" ")
    }
  );

  registerCanixTools(server, client);
  registerCanixResources(server, client);
  registerCanixPrompts(server);

  return server;
}
