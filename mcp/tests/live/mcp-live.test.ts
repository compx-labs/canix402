import assert from "node:assert/strict";
import test from "node:test";

import type { McpServer } from "@modelcontextprotocol/server";

import { loadConfig } from "../../src/lib/config.js";
import { X402Client } from "../../src/lib/x402-client.js";
import { createCanixMcpServer } from "../../src/server.js";

const liveEnabled = process.env.CANIX402_LIVE_TESTS === "1";

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

test(
  "live: free health tool against production gateway",
  { skip: !liveEnabled },
  async () => {
    const config = loadConfig();
    const server = createCanixMcpServer({ config });

    const result = await registeredTools(server).canix_health!.handler({}, {});
    assert.equal(result.isError, undefined);
    const text = result.content.find((part) => part.type === "text");
    assert.ok(text?.text);
    assert.match(text.text, /canix402/);

    await server.close();
  }
);

test(
  "live: paid opportunities tool with wallet",
  { skip: !liveEnabled || !loadConfig().walletMnemonic },
  async () => {
    const config = loadConfig();
    assert.ok(config.walletMnemonic, "CANIX402_WALLET_MNEMONIC required for live paid test");

    const client = new X402Client(config);
    const result = await client.fetchPaid("/opportunities", {
      method: "GET",
      query: { limit: 1 },
      estimatedPriceUsdc: "0.01"
    });

    assert.equal(result.status, 200);
    assert.ok(result.paymentResponseHeader);
    const body = result.body as { data?: unknown[] };
    assert.ok(Array.isArray(body.data));
  }
);
