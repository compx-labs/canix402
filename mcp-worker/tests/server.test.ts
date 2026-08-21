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

test("canix_get_token_prices posts a free pricing request", async () => {
  let method = "";
  let requestBody: unknown;
  let paymentSignature = "";
  const server = createCanixWorkerMcpServer({
    config: {
      gatewayUrl: "https://gateway.example",
      publicUrl: "https://mcp.example/mcp",
      network: "algorand-mainnet"
    },
    fetchImpl: async (input, init) => {
      assert.equal(new URL(String(input)).pathname, "/pricing");
      method = init?.method ?? "";
      requestBody = JSON.parse(String(init?.body));
      paymentSignature =
        (init?.headers as Record<string, string> | undefined)?.["PAYMENT-SIGNATURE"] ?? "";
      return new Response(JSON.stringify({ data: { prices: [] } }), { status: 200 });
    }
  });

  const result = await registeredTools(server).canix_get_token_prices!.handler(
    { assetIds: [0, 31566704] },
    {}
  );

  assert.equal(method, "POST");
  assert.deepEqual(requestBody, { assetIds: [0, 31566704] });
  assert.equal(paymentSignature, "");
  assert.deepEqual(JSON.parse(result.content[0]!.text ?? ""), {
    data: { prices: [] }
  });
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

test("canix_check_eligibility posts body and reports 0.01 preflight price", async () => {
  let requestUrl = "";
  let method = "";
  let requestBody = "";
  let paymentSignature = "";
  const server = createCanixWorkerMcpServer({
    config: {
      gatewayUrl: "https://gateway.example",
      publicUrl: "https://mcp.example/mcp",
      network: "[REDACTED]"
    },
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      method = init?.method ?? "";
      requestBody = String(init?.body);
      paymentSignature =
        (init?.headers as Record<string, string> | undefined)?.["PAYMENT-SIGNATURE"] ?? "";
      return new Response("payment required", { status: 402 });
    }
  });

  const result = await registeredTools(server).canix_check_eligibility!.handler(
    {
      address: "WALLET",
      opportunityIds: ["reti-staking-1"],
      paymentSignature: "signed-payload"
    },
    {}
  );

  assert.equal(new URL(requestUrl).pathname, "/eligibility");
  assert.equal(method, "POST");
  assert.equal(paymentSignature, "signed-payload");
  assert.deepEqual(JSON.parse(requestBody), {
    address: "WALLET",
    opportunityIds: ["reti-staking-1"]
  });
  const text = result.content.find((part) => part.type === "text");
  assert.ok(text?.text);
  const payload = JSON.parse(text.text) as {
    error: string;
    mcpPayment: { priceUsdc: string };
    request: { body: { opportunityIds: string[] } };
  };
  assert.equal(payload.error, "PAYMENT_REQUIRED");
  assert.equal(payload.mcpPayment.priceUsdc, "0.01");
  assert.deepEqual(payload.request.body.opportunityIds, ["reti-staking-1"]);
});

test("canix_get_plan posts body and reports 0.25 preflight price", async () => {
  let requestUrl = "";
  let method = "";
  let requestBody = "";
  let paymentSignature = "";
  const server = createCanixWorkerMcpServer({
    config: {
      gatewayUrl: "https://gateway.example",
      publicUrl: "https://mcp.example/mcp",
      network: "[REDACTED]"
    },
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      method = init?.method ?? "";
      requestBody = String(init?.body);
      paymentSignature =
        (init?.headers as Record<string, string> | undefined)?.["PAYMENT-SIGNATURE"] ?? "";
      return new Response("payment required", { status: 402 });
    }
  });

  const result = await registeredTools(server).canix_get_plan!.handler(
    {
      address: "WALLET",
      budget: { assetId: 0, amount: "1000000" },
      opportunityIds: ["reti-staking-12"],
      paymentSignature: "signed-payload"
    },
    {}
  );

  assert.equal(new URL(requestUrl).pathname, "/plans");
  assert.equal(method, "POST");
  assert.equal(paymentSignature, "signed-payload");
  assert.deepEqual(JSON.parse(requestBody), {
    address: "WALLET",
    budget: { assetId: 0, amount: "1000000" },
    opportunityIds: ["reti-staking-12"]
  });
  const text = result.content.find((part) => part.type === "text");
  assert.ok(text?.text);
  const payload = JSON.parse(text.text) as {
    error: string;
    mcpPayment: { priceUsdc: string };
    request: { body: { budget: { amount: string } } };
  };
  assert.equal(payload.error, "PAYMENT_REQUIRED");
  assert.equal(payload.mcpPayment.priceUsdc, "0.25");
  assert.equal(payload.request.body.budget.amount, "1000000");
});

test("canix_get_rebalance_plan posts body and reports 0.25 preflight price", async () => {
  let requestUrl = "";
  let method = "";
  let requestBody = "";
  let paymentSignature = "";
  const server = createCanixWorkerMcpServer({
    config: {
      gatewayUrl: "https://gateway.example",
      publicUrl: "https://mcp.example/mcp",
      network: "[REDACTED]"
    },
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      method = init?.method ?? "";
      requestBody = String(init?.body);
      paymentSignature =
        (init?.headers as Record<string, string> | undefined)?.["PAYMENT-SIGNATURE"] ?? "";
      return new Response("payment required", { status: 402 });
    }
  });

  const result = await registeredTools(server).canix_get_rebalance_plan!.handler(
    {
      address: "WALLET",
      harvestIdle: true,
      paymentSignature: "signed-payload"
    },
    {}
  );

  assert.equal(new URL(requestUrl).pathname, "/plans/rebalance");
  assert.equal(method, "POST");
  assert.equal(paymentSignature, "signed-payload");
  assert.deepEqual(JSON.parse(requestBody), {
    address: "WALLET",
    harvestIdle: true
  });
  const text = result.content.find((part) => part.type === "text");
  assert.ok(text?.text);
  const payload = JSON.parse(text.text) as {
    error: string;
    mcpPayment: { priceUsdc: string };
    request: { body: { harvestIdle: boolean } };
  };
  assert.equal(payload.error, "PAYMENT_REQUIRED");
  assert.equal(payload.mcpPayment.priceUsdc, "0.25");
  assert.equal(payload.request.body.harvestIdle, true);
});

test("canix_simulate_execution posts body and reports 0.10 preflight price", async () => {
  let requestUrl = "";
  let method = "";
  let requestBody = "";
  let paymentSignature = "";
  const server = createCanixWorkerMcpServer({
    config: {
      gatewayUrl: "https://gateway.example",
      publicUrl: "https://mcp.example/mcp",
      network: "[REDACTED]"
    },
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      method = init?.method ?? "";
      requestBody = String(init?.body);
      paymentSignature =
        (init?.headers as Record<string, string> | undefined)?.["PAYMENT-SIGNATURE"] ?? "";
      return new Response("payment required", { status: 402 });
    }
  });

  const result = await registeredTools(server).canix_simulate_execution!.handler(
    {
      address: "WALLET",
      groups: [{ encodedTransactions: ["AAAA"] }],
      paymentSignature: "signed-payload"
    },
    {}
  );

  assert.equal(new URL(requestUrl).pathname, "/execution/simulate");
  assert.equal(method, "POST");
  assert.equal(paymentSignature, "signed-payload");
  assert.deepEqual(JSON.parse(requestBody), {
    address: "WALLET",
    groups: [{ encodedTransactions: ["AAAA"] }]
  });
  const text = result.content.find((part) => part.type === "text");
  assert.ok(text?.text);
  const payload = JSON.parse(text.text) as {
    error: string;
    mcpPayment: { priceUsdc: string };
  };
  assert.equal(payload.error, "PAYMENT_REQUIRED");
  assert.equal(payload.mcpPayment.priceUsdc, "0.10");
});

test("canix_compose_enter posts body and reports 0.1 preflight price", async () => {
  let requestUrl = "";
  let method = "";
  let requestBody = "";
  let paymentSignature = "";
  const server = createCanixWorkerMcpServer({
    config: {
      gatewayUrl: "https://gateway.example",
      publicUrl: "https://mcp.example/mcp",
      network: "[REDACTED]"
    },
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      method = init?.method ?? "";
      requestBody = String(init?.body);
      paymentSignature =
        (init?.headers as Record<string, string> | undefined)?.["PAYMENT-SIGNATURE"] ?? "";
      return new Response("payment required", { status: 402 });
    }
  });

  const result = await registeredTools(server).canix_compose_enter!.handler(
    {
      address: "WALLET",
      opportunityId: "reti-staking-12",
      fromAssetId: 1,
      amount: "1000000",
      slippage: 1,
      paymentSignature: "signed-payload"
    },
    {}
  );

  assert.equal(new URL(requestUrl).pathname, "/execution/compose");
  assert.equal(method, "POST");
  assert.equal(paymentSignature, "signed-payload");
  assert.deepEqual(JSON.parse(requestBody), {
    address: "WALLET",
    opportunityId: "reti-staking-12",
    fromAssetId: 1,
    amount: "1000000",
    slippage: 1
  });
  const text = result.content.find((part) => part.type === "text");
  assert.ok(text?.text);
  const payload = JSON.parse(text.text) as {
    error: string;
    mcpPayment: { priceUsdc: string };
  };
  assert.equal(payload.error, "PAYMENT_REQUIRED");
  assert.equal(payload.mcpPayment.priceUsdc, "0.1");
});


test("canix_list_claimable forwards address and reports 0.001 preflight price", async () => {
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

  const result = await registeredTools(server).canix_list_claimable!.handler(
    { address: "WALLET", paymentSignature: "signed-payload" },
    {}
  );

  assert.equal(new URL(requestUrl).pathname, "/positions/claimable");
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
  assert.equal(payload.mcpPayment.priceUsdc, "0.001");
  assert.equal(payload.request.query.address, "WALLET");
});

test("Haystack free tools post their bodies and pass responses through", async () => {
  const requests: Array<{ path: string; body: unknown }> = [];
  const server = createCanixWorkerMcpServer({
    config: {
      gatewayUrl: "https://gateway.example",
      publicUrl: "https://mcp.example/mcp",
      network: "algorand-mainnet"
    },
    fetchImpl: async (input, init) => {
      assert.equal(init?.method, "POST");
      requests.push({
        path: new URL(String(input)).pathname,
        body: JSON.parse(String(init?.body))
      });
      return new Response(JSON.stringify({ data: { requestNumber: requests.length } }), {
        status: 200
      });
    }
  });

  const quoteResult = await registeredTools(server).canix_get_quote!.handler(
    {
      address: "WALLET",
      fromAssetId: 0,
      toAssetId: 31566704,
      amount: "1000000",
      maxDepth: 2
    },
    {}
  );
  const quote = { id: "quote-1", route: [{ protocol: "tinyman" }] };
  const optinResult = await registeredTools(server).canix_optin!.handler(
    { address: "WALLET", quote },
    {}
  );

  assert.deepEqual(requests, [
    {
      path: "/swaps/quote",
      body: {
        address: "WALLET",
        fromAssetId: 0,
        toAssetId: 31566704,
        amount: "1000000",
        maxDepth: 2
      }
    },
    {
      path: "/swaps/optin",
      body: { address: "WALLET", quote }
    }
  ]);
  assert.deepEqual(JSON.parse(quoteResult.content[0]!.text ?? ""), {
    data: { requestNumber: 1 }
  });
  assert.deepEqual(JSON.parse(optinResult.content[0]!.text ?? ""), {
    data: { requestNumber: 2 }
  });
});

test("canix_swap forwards paymentSignature and reports 0.005 fallback price", async () => {
  const quote = { id: "quote-1" };
  let requestBody: unknown;
  let paymentSignature = "";
  const server = createCanixWorkerMcpServer({
    config: {
      gatewayUrl: "https://gateway.example",
      publicUrl: "https://mcp.example/mcp",
      network: "algorand-mainnet"
    },
    fetchImpl: async (input, init) => {
      assert.equal(new URL(String(input)).pathname, "/swaps/transactions");
      assert.equal(init?.method, "POST");
      requestBody = JSON.parse(String(init?.body));
      paymentSignature =
        (init?.headers as Record<string, string> | undefined)?.["PAYMENT-SIGNATURE"] ?? "";
      return new Response("payment required", { status: 402 });
    }
  });

  const result = await registeredTools(server).canix_swap!.handler(
    {
      address: "WALLET",
      quote,
      slippage: 0.5,
      paymentSignature: "signed-payload"
    },
    {}
  );

  assert.deepEqual(requestBody, { address: "WALLET", quote, slippage: 0.5 });
  assert.equal(paymentSignature, "signed-payload");
  const payload = JSON.parse(result.content[0]!.text ?? "") as {
    error: string;
    mcpPayment: { priceUsdc: string };
  };
  assert.equal(payload.error, "PAYMENT_REQUIRED");
  assert.equal(payload.mcpPayment.priceUsdc, "0.005");
});
