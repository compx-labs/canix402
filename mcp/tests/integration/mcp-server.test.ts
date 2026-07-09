import assert from "node:assert/strict";
import test from "node:test";

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
      algodUrl: "https://algod.test",
      network: "algorand-mainnet",
      walletMnemonic: undefined
    },
    fetchImpl: async () => new Response("{}", { status: 200 })
  });

  const names = Object.keys(registeredTools(server)).sort();
  assert.deepEqual(names, [
    "canix_get_discovery",
    "canix_get_execution_quote",
    "canix_get_metadata",
    "canix_get_openapi",
    "canix_get_personalized_opportunities",
    "canix_get_protocol_opportunities",
    "canix_health",
    "canix_list_execution_shapes",
    "canix_list_opportunities",
    "canix_search_opportunities"
  ]);

  await server.close();
});

test("canix_health tool returns gateway payload", async () => {
  const server = createCanixMcpServer({
    config: {
      apiUrl: "https://example.test",
      algodUrl: "https://algod.test",
      network: "algorand-mainnet",
      walletMnemonic: undefined
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
      algodUrl: "https://algod.test",
      network: "algorand-mainnet",
      walletMnemonic: undefined
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

test("paid tool without wallet returns WALLET_REQUIRED", async () => {
  const server = createCanixMcpServer({
    config: {
      apiUrl: "https://example.test",
      algodUrl: "https://algod.test",
      network: "algorand-mainnet",
      walletMnemonic: undefined
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

  assert.equal(result.isError, true);
  const text = result.content.find((part) => part.type === "text");
  assert.ok(text?.text);
  assert.match(text.text, /WALLET_REQUIRED/);
  assert.match(text.text, /0\.01/);

  await server.close();
});

test("MCP resources include discovery openapi and shapes", async () => {
  const server = createCanixMcpServer({
    config: {
      apiUrl: "https://example.test",
      algodUrl: "https://algod.test",
      network: "algorand-mainnet",
      walletMnemonic: undefined
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
