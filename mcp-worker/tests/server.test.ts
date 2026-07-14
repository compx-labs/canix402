import assert from "node:assert/strict";
import test from "node:test";

import { MCP_TOOL_NAMES } from "@canix402/x402-client";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { createCanixWorkerMcpServer } from "../src/server.js";

type RegisteredTool = {
  handler: (args: Record<string, unknown>, extra: unknown) => Promise<{
    content: Array<{ type: string; text?: string }>;
    isError?: boolean;
  }>;
};

function registeredTools(server: McpServer): Record<string, RegisteredTool> {
  return (server as unknown as { _registeredTools: Record<string, RegisteredTool> })
    ._registeredTools;
}

function encodePaymentRequired(amount = "10000"): string {
  return Buffer.from(
    JSON.stringify({
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "algorand-mainnet",
          asset: "31566704",
          payTo: "PAYTO",
          maxAmountRequired: amount
        }
      ]
    }),
    "utf-8"
  ).toString("base64");
}

test("worker MCP server registers expected tool names", () => {
  const server = createCanixWorkerMcpServer({
    config: {
      gatewayUrl: "https://gateway.example",
      publicUrl: "https://mcp.example/mcp",
      network: "algorand-mainnet"
    },
    fetchImpl: async () => new Response("{}", { status: 200 })
  });

  const names = Object.keys(registeredTools(server)).sort();
  assert.deepEqual(names, [...MCP_TOOL_NAMES].sort());
});

test("paid tool returns PAYMENT_REQUIRED metadata on preflight", async () => {
  const paymentHeader = encodePaymentRequired("10000");
  const server = createCanixWorkerMcpServer({
    config: {
      gatewayUrl: "https://gateway.example",
      publicUrl: "https://mcp.example/mcp",
      network: "algorand-mainnet"
    },
    fetchImpl: async () =>
      new Response("payment required", {
        status: 402,
        headers: { "payment-required": paymentHeader }
      })
  });

  const result = await registeredTools(server).canix_list_opportunities!.handler(
    { limit: 1 },
    {}
  );

  assert.equal(result.isError, undefined);
  const text = result.content.find((part) => part.type === "text");
  assert.ok(text?.text);
  assert.match(text.text, /PAYMENT_REQUIRED/);
  assert.match(text.text, /paymentRequiredHeader/);
});

test("canix_get_positions forwards address and reports 0.005 preflight price", async () => {
  let requestUrl = "";
  let paymentSignature = "";
  const server = createCanixWorkerMcpServer({
    config: {
      gatewayUrl: "https://gateway.example",
      publicUrl: "https://mcp.example/mcp",
      network: "algorand-mainnet"
    },
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      paymentSignature =
        (init?.headers as Record<string, string> | undefined)?.["PAYMENT-SIGNATURE"] ?? "";
      return new Response("payment required", { status: 402 });
    }
  });

  const result = await registeredTools(server).canix_get_positions!.handler(
    { address: "WALLET", paymentSignature: "signed-payload" },
    {}
  );

  assert.equal(new URL(requestUrl).pathname, "/positions");
  assert.equal(new URL(requestUrl).searchParams.get("address"), "WALLET");
  assert.equal(paymentSignature, "signed-payload");
  const text = result.content.find((part) => part.type === "text");
  assert.ok(text?.text);
  const payload = JSON.parse(text.text) as {
    error: string;
    mcpPayment: { priceUsdc: string };
    request: { query: { address: string } };
  };
  assert.equal(payload.error, "PAYMENT_REQUIRED");
  assert.equal(payload.mcpPayment.priceUsdc, "0.005");
  assert.equal(payload.request.query.address, "WALLET");
});
