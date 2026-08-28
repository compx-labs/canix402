import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { WEBMCP_TOOL_NAMES, WEBMCP_TOOLS, getWebMcpTool } from "../src/lib/webmcp/catalog.ts";
import { executeCanixWebMcpToolValue } from "../src/lib/webmcp/execute.ts";
import { isOriginIsolated } from "../src/lib/webmcp/model-context.ts";
import { registerCanixWebMcpTools } from "../src/lib/webmcp/register.ts";
import type { ModelContext } from "../src/lib/webmcp/types.ts";

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SESSION_TOOLS = [
  "canix_create_session",
  "canix_refresh_session",
  "canix_get_session"
] as const;

const LOCKED_MCP_SET = [
  "canix_health",
  "canix_get_metadata",
  "canix_get_discovery",
  "canix_get_openapi",
  "canix_get_token_prices",
  "canix_list_execution_shapes",
  "canix_list_opportunities",
  "canix_search_opportunities",
  "canix_get_personalized_opportunities",
  "canix_check_eligibility",
  "canix_get_plan",
  "canix_get_protocol_opportunities",
  "canix_get_positions",
  "canix_list_claimable",
  "canix_get_execution_quote",
  "canix_get_quote",
  "canix_optin",
  "canix_swap"
] as const;

function encodePaymentRequired(amount = "10000"): string {
  return Buffer.from(
    JSON.stringify({
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "test-network",
          asset: "1",
          payTo: "PAYTO",
          maxAmountRequired: amount
        }
      ]
    }),
    "utf-8"
  ).toString("base64");
}

test("WebMCP catalog is the locked MCP set plus 13.8 session tools", () => {
  assert.deepEqual([...WEBMCP_TOOL_NAMES], [...LOCKED_MCP_SET, ...SESSION_TOOLS]);
  assert.deepEqual(
    WEBMCP_TOOLS.map((tool) => tool.name),
    [...WEBMCP_TOOL_NAMES]
  );
  assert.equal(WEBMCP_TOOLS.length, 21);
});

test("session tools use the shipped 13.8 names", () => {
  for (const name of SESSION_TOOLS) {
    assert.ok(getWebMcpTool(name), `missing ${name}`);
  }
  assert.equal(getWebMcpTool("canix_create_session")?.http.path, "/sessions");
  assert.equal(getWebMcpTool("canix_refresh_session")?.http.path, "/sessions/refresh");
  assert.equal(getWebMcpTool("canix_get_session")?.http.path, "/sessions/{sessionId}");
  assert.equal(getWebMcpTool("canix_create_session")?.allowSessionReceipt, false);
  assert.equal(getWebMcpTool("canix_refresh_session")?.allowSessionReceipt, false);
});

test("paid tool schemas match MCP auth args", () => {
  for (const tool of WEBMCP_TOOLS) {
    const properties = tool.inputSchema.properties;
    if (tool.access === "paid") {
      assert.equal("paymentSignature" in properties, true, `${tool.name} missing paymentSignature`);
    }
    if (tool.allowSessionReceipt) {
      assert.equal("sessionReceipt" in properties, true, `${tool.name} missing sessionReceipt`);
    } else {
      assert.equal("sessionReceipt" in properties, false, `${tool.name} should not take sessionReceipt`);
    }
  }
});

test("execute unknown tool fails closed", async () => {
  const result = await executeCanixWebMcpToolValue("canix_invented", {}, {
    gatewayBaseUrl: "https://gateway.example",
    fetchImpl: async () => {
      throw new Error("fetch should not run");
    }
  });
  assert.deepEqual(result, {
    error: "UNKNOWN_TOOL",
    message: "Unknown Canix WebMCP tool: canix_invented"
  });
});

test("missing path params fail closed without calling the gateway", async () => {
  const result = await executeCanixWebMcpToolValue("canix_get_session", {}, {
    gatewayBaseUrl: "https://gateway.example",
    fetchImpl: async () => {
      throw new Error("fetch should not run");
    }
  });
  assert.equal((result as { error: string }).error, "INVALID_ARGUMENT");
  assert.equal((result as { argument?: string }).argument, "sessionId");
});

test("free tool execute returns the gateway JSON", async () => {
  const result = await executeCanixWebMcpToolValue("canix_health", {}, {
    gatewayBaseUrl: "https://gateway.example",
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "https://gateway.example/health");
      assert.equal(init?.method, "GET");
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }
  });
  assert.deepEqual(result, { status: "ok" });
});

test("paid tool without payment fails closed as PAYMENT_REQUIRED", async () => {
  let seenSignature = "";
  let seenSession = "";
  const result = await executeCanixWebMcpToolValue("canix_list_opportunities", { limit: 5 }, {
    gatewayBaseUrl: "https://gateway.example",
    fetchImpl: async (input, init) => {
      assert.equal(new URL(String(input)).pathname, "/opportunities");
      assert.equal(new URL(String(input)).searchParams.get("limit"), "5");
      const headers = init?.headers as Record<string, string>;
      seenSignature = headers["PAYMENT-SIGNATURE"] ?? "";
      seenSession = headers["X-Canix-Session"] ?? "";
      return new Response(JSON.stringify({ error: "Payment required" }), {
        status: 402,
        headers: { "payment-required": encodePaymentRequired("10000") }
      });
    }
  });
  assert.equal(seenSignature, "");
  assert.equal(seenSession, "");
  assert.equal((result as { error: string }).error, "PAYMENT_REQUIRED");
  assert.equal((result as { mcpPayment: { required: boolean; priceUsdc?: string } }).mcpPayment.required, true);
  assert.equal((result as { mcpPayment: { priceUsdc?: string } }).mcpPayment.priceUsdc, "0.01");
  assert.equal((result as { retry: { arg: string } }).retry.arg, "paymentSignature");
});

test("stale session receipt fails closed as SESSION_*", async () => {
  const result = await executeCanixWebMcpToolValue(
    "canix_list_opportunities",
    { sessionReceipt: "csess_stale" },
    {
      gatewayBaseUrl: "https://gateway.example",
      fetchImpl: async (_input, init) => {
        const headers = init?.headers as Record<string, string>;
        assert.equal(headers["X-Canix-Session"], "csess_stale");
        return new Response(
          JSON.stringify({
            error: { code: "SESSION_EXPIRED", message: "Session TTL elapsed." }
          }),
          { status: 402 }
        );
      }
    }
  );
  assert.equal((result as { error: string }).error, "SESSION_EXPIRED");
  assert.equal((result as { retry: { omitHeader: string } }).retry.omitHeader, "X-Canix-Session");
});

test("paymentSignature wins over sessionReceipt", async () => {
  let seenSignature = "";
  let seenSession = "";
  await executeCanixWebMcpToolValue(
    "canix_list_opportunities",
    { paymentSignature: "sig", sessionReceipt: "csess_live" },
    {
      gatewayBaseUrl: "https://gateway.example",
      fetchImpl: async (_input, init) => {
        const headers = init?.headers as Record<string, string>;
        seenSignature = headers["PAYMENT-SIGNATURE"] ?? "";
        seenSession = headers["X-Canix-Session"] ?? "";
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
    }
  );
  assert.equal(seenSignature, "sig");
  assert.equal(seenSession, "");
});

test("create session cannot be paid with a session receipt", async () => {
  let method = "";
  let body = "";
  let seenSession = "";
  await executeCanixWebMcpToolValue(
    "canix_create_session",
    { sessionReceipt: "csess_live" },
    {
      gatewayBaseUrl: "https://gateway.example",
      fetchImpl: async (input, init) => {
        assert.equal(new URL(String(input)).pathname, "/sessions");
        method = init?.method ?? "";
        body = String(init?.body);
        seenSession = (init?.headers as Record<string, string>)["X-Canix-Session"] ?? "";
        return new Response("{}", {
          status: 402,
          headers: { "payment-required": encodePaymentRequired("250000") }
        });
      }
    }
  );
  assert.equal(method, "POST");
  assert.equal(body, "{}");
  assert.equal(seenSession, "");
});

test("gateway 500 fails closed as GATEWAY_CLIENT_ERROR", async () => {
  const result = await executeCanixWebMcpToolValue("canix_get_metadata", {}, {
    gatewayBaseUrl: "https://gateway.example",
    fetchImpl: async () => new Response("upstream boom", { status: 500 })
  });
  assert.equal((result as { error: string }).error, "GATEWAY_CLIENT_ERROR");
  assert.equal((result as { status: number }).status, 500);
});

test("registerTool is called once per catalog tool", async () => {
  const names: string[] = [];
  const modelContext: ModelContext = {
    async registerTool(tool) {
      names.push(tool.name);
      assert.equal(tool.inputSchema.type, "object");
      assert.equal(typeof tool.execute, "function");
    }
  };

  const status = await registerCanixWebMcpTools({
    gatewayBaseUrl: "https://gateway.example",
    modelContext
  });

  assert.deepEqual(names, [...WEBMCP_TOOL_NAMES]);
  assert.deepEqual(status.registered, [...WEBMCP_TOOL_NAMES]);
  assert.deepEqual(status.failed, []);
  assert.equal(status.originIsolated, true);
});

test("missing WebMCP API returns unavailable without throwing", async () => {
  const status = await registerCanixWebMcpTools({
    gatewayBaseUrl: "https://gateway.example",
    modelContext: null
  });
  assert.equal(status.api, "unavailable");
  assert.deepEqual(status.registered, []);
});

test("source never relaxes document.domain", () => {
  const files = [
    "src/lib/webmcp/model-context.ts",
    "src/lib/webmcp/register.ts",
    "src/lib/webmcp/human-execute.ts",
    "src/lib/webmcp/page-app.ts",
    "src/lib/webmcp/checkout.ts",
    "src/layouts/BaseLayout.astro"
  ];
  for (const relative of files) {
    const source = readFileSync(resolve(websiteRoot, relative), "utf-8");
    assert.equal(source.includes("document.domain ="), false, relative);
    assert.equal(source.includes("document.domain="), false, relative);
  }
  assert.equal(isOriginIsolated(), true);
});
