import assert from "node:assert/strict";
import test from "node:test";

import { loadWorkerConfig } from "../src/config.js";

test("loadWorkerConfig uses defaults", () => {
  const config = loadWorkerConfig({}, "https://worker.example/mcp");
  assert.equal(config.gatewayUrl, "https://canix402-api.compx.io");
  assert.equal(config.publicUrl, "https://worker.example/mcp");
  assert.equal(config.network, "algorand-mainnet");
});

test("loadWorkerConfig honors configured URLs", () => {
  const config = loadWorkerConfig({
    CANIX402_GATEWAY_URL: "https://gateway.example/",
    CANIX402_MCP_PUBLIC_URL: "https://mcp.example/mcp/",
    CANIX402_NETWORK: "algorand-mainnet"
  });

  assert.equal(config.gatewayUrl, "https://gateway.example");
  assert.equal(config.publicUrl, "https://mcp.example/mcp");
});
