import assert from "node:assert/strict";
import test from "node:test";

import {
  protocolsForOpportunityQuery,
  SUPPORTED_AGGREGATE_PROTOCOLS
} from "../../src/services/aggregate-opportunities.js";

test("default aggregate protocol set includes Aave on Base", () => {
  assert.ok(SUPPORTED_AGGREGATE_PROTOCOLS.includes("aave"));
  assert.deepEqual(protocolsForOpportunityQuery({ chain: "base" }), [
    "morpho",
    "aave",
    "aerodrome"
  ]);
  assert.equal(protocolsForOpportunityQuery({ chain: "algorand" }).includes("aave"), false);
  assert.deepEqual(protocolsForOpportunityQuery({ protocol: "aave", chain: "base" }), ["aave"]);
});
