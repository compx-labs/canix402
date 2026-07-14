import assert from "node:assert/strict";
import test from "node:test";

import { MCP_TOOL_NAMES } from "@canix402/x402-client";
import type { McpServer } from "@modelcontextprotocol/server";

import { createCanixMcpServer } from "../../src/server.js";

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

function registeredResourceUris(server: McpServer): string[] {
  return Object.keys(
    (server as unknown as { _registeredResources: Record<string, unknown> })
      ._registeredResources
  );
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

test("MCP server registers expected free and paid tools", async () => {
  const server = createCanixMcpServer({
    config: {
      apiUrl: "https://example.test",
      network: "algorand-mainnet"
    },
    fetchImpl: async () => new Response("{}", { status: 200 })
  });

  const names = Object.keys(registeredTools(server)).sort();
  assert.deepEqual(names, [...MCP_TOOL_NAMES].sort());

  await server.close();
});

test("canix_health tool returns gateway payload", async () => {
  const server = createCanixMcpServer({
    config: {
      apiUrl: "https://example.test",
      network: "algorand-mainnet"
    },
    fetchImpl: async (input) => {
      assert.match(String(input), /\/health$/);
      return new Response(
        JSON.stringify({ data: { service: "canix402", status: "ok" } }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
  });

  const result = await registeredTools(server).canix_health!.handler({}, {});
  assert.equal(result.isError, undefined);
  const text = result.content.find((part) => part.type === "text");
  assert.ok(text?.text);
  assert.match(text.text, /canix402/);

  await server.close();
});

test("canix_list_execution_shapes does not call network", async () => {
  let fetchCalls = 0;
  const server = createCanixMcpServer({
    config: {
      apiUrl: "https://example.test",
      network: "algorand-mainnet"
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response("{}", { status: 500 });
    }
  });

  const result = await registeredTools(server).canix_list_execution_shapes!.handler(
    {},
    {}
  );
  assert.equal(fetchCalls, 0);
  assert.equal(result.isError, undefined);
  const text = result.content.find((part) => part.type === "text");
  assert.ok(text?.text);
  assert.match(text.text, /addLiquidity:flexible/);

  await server.close();
});

test("paid tool preflight returns PAYMENT_REQUIRED metadata", async () => {
  const server = createCanixMcpServer({
    config: {
      apiUrl: "https://example.test",
      network: "algorand-mainnet"
    },
    fetchImpl: async () =>
      new Response("payment required", {
        status: 402,
        headers: { "payment-required": encodePaymentRequired("10000") }
      })
  });

  const result = await registeredTools(server).canix_list_opportunities!.handler(
    { limit: 5 },
    {}
  );

  assert.equal(result.isError, undefined);
  const text = result.content.find((part) => part.type === "text");
  assert.ok(text?.text);
  assert.match(text.text, /PAYMENT_REQUIRED/);
  assert.match(text.text, /paymentRequiredHeader/);

  await server.close();
});

test("canix_get_positions forwards address and reports 0.005 preflight price", async () => {
  let requestUrl = "";
  let paymentSignature = "";
  const server = createCanixMcpServer({
    config: {
      apiUrl: "https://example.test",
      network: "algorand-mainnet"
    },
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      paymentSignature = String(
        init?.headers && (init.headers as Record<string, string>)["PAYMENT-SIGNATURE"]
      );
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

  await server.close();
});

test("MCP resources include discovery openapi and shapes", async () => {
  const server = createCanixMcpServer({
    config: {
      apiUrl: "https://example.test",
      network: "algorand-mainnet"
    },
    fetchImpl: async () =>
      new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
  });

  const uris = registeredResourceUris(server).sort();
  assert.deepEqual(uris, [
    "canix://discovery",
    "canix://execution-shapes",
    "canix://openapi"
  ]);

  await server.close();
});
