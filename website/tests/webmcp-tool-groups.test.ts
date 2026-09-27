import assert from "node:assert/strict";
import test from "node:test";

import { WEBMCP_TOOL_NAMES, getWebMcpTool } from "../src/lib/webmcp/catalog.ts";
import { describeCheckoutError } from "../src/lib/webmcp/wallet-modal.ts";
import {
  HUMAN_TOOL_CATALOG,
  advancedToolGroups,
  humanToolsInGroup,
  sessionUseLabel,
  toolPriceLabel
} from "../src/lib/webmcp/tool-groups.ts";

test("human catalog names exist and stay out of session checkout", () => {
  const human = HUMAN_TOOL_CATALOG.map((entry) => entry.name);
  assert.equal(new Set(human).size, human.length);
  for (const name of human) {
    assert.ok(getWebMcpTool(name), `missing ${name}`);
  }
  assert.equal(human.includes("canix_create_session"), false);
  assert.equal(human.includes("canix_refresh_session"), false);
  assert.equal(human.includes("canix_create_watch"), false);
});

test("every MCP tool is either human or advanced, never both", () => {
  const human = HUMAN_TOOL_CATALOG.map((entry) => entry.name);
  const advanced = advancedToolGroups().flatMap((group) => [...group.names]);
  assert.equal(human.length + advanced.length, WEBMCP_TOOL_NAMES.length);
  assert.deepEqual(new Set([...human, ...advanced]), new Set(WEBMCP_TOOL_NAMES));
  for (const group of advancedToolGroups()) {
    assert.ok(group.names.length > 0);
  }
  assert.deepEqual(
    humanToolsInGroup("opportunities").map((entry) => entry.name),
    [
      "canix_search_opportunities",
      "canix_list_opportunities",
      "canix_get_personalized_opportunities",
      "canix_get_protocol_opportunities",
      "canix_get_opportunity_history"
    ]
  );
});

test("human price and session labels come from the catalog", () => {
  assert.equal(toolPriceLabel("canix_list_opportunities"), "0.01 USDC");
  assert.equal(toolPriceLabel("canix_get_quote"), "Free");
  assert.equal(toolPriceLabel("canix_optin"), "Free");
  assert.equal(sessionUseLabel("canix_search_opportunities"), "Uses 1 research call");
  assert.equal(sessionUseLabel("canix_get_plan"), "Uses 1 quote");
  assert.equal(sessionUseLabel("canix_get_quote"), null);
  assert.equal(getWebMcpTool("canix_create_session")?.fallbackPriceUsdc, "0.25");
});

test("checkout errors use plain language", () => {
  assert.equal(describeCheckoutError("WALLET_REQUIRED"), "Connect a wallet before paying.");
  assert.equal(
    describeCheckoutError("PAYMENT_REJECTED", "User rejected the request."),
    "The wallet rejected the USDC payment."
  );
  assert.equal(describeCheckoutError("COPY_FAILED", "Could not copy the address."), "Could not copy the address.");
  assert.equal(describeCheckoutError("SOMETHING_ELSE"), "Something went wrong. Try again.");
});
