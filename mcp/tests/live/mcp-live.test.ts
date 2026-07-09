import assert from "node:assert/strict";
import test from "node:test";

import type { McpServer } from "@modelcontextprotocol/server";

import { loadConfig } from "../../src/lib/config.js";
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
  "live: paid opportunities tool returns payment requirement",
  { skip: !liveEnabled },
  async () => {
    const config = loadConfig();

    const server = createCanixMcpServer({ config });
    const result = await registeredTools(server).canix_list_opportunities!.handler(
      { limit: 1 },
      {}
    );

    assert.equal(result.isError, undefined);
    const text = result.content.find((part) => part.type === "text");
    assert.ok(text?.text);
    assert.match(text.text, /PAYMENT_REQUIRED|mcpPayment/);

    await server.close();
  }
);
