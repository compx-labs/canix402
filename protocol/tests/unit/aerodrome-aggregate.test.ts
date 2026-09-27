import assert from "node:assert/strict";
import test from "node:test";

import {
  protocolsForOpportunityQuery,
  SUPPORTED_AGGREGATE_PROTOCOLS
} from "../../src/services/aggregate-opportunities.js";

test("chain=base includes Aerodrome with Morpho and Aave", () => {
  assert.ok(SUPPORTED_AGGREGATE_PROTOCOLS.includes("aerodrome"));
  assert.deepEqual(protocolsForOpportunityQuery({ chain: "base" }), [
    "morpho",
    "aave",
    "aerodrome"
  ]);
  assert.equal(
    protocolsForOpportunityQuery({ chain: "algorand" }).includes("aerodrome"),
    false
  );
  assert.deepEqual(
    protocolsForOpportunityQuery({ protocol: "aerodrome", chain: "base" }),
    ["aerodrome"]
  );
  assert.deepEqual(
    protocolsForOpportunityQuery({ protocol: "aerodrome", chain: "algorand" }),
    []
  );
});
