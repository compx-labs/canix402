import assert from "node:assert/strict";
import test from "node:test";

import {
  protocolsForOpportunityQuery,
  SUPPORTED_AGGREGATE_PROTOCOLS
} from "../../src/services/aggregate-opportunities.js";

test("default aggregate protocol set includes Morpho alongside Algorand venues", () => {
  assert.ok(SUPPORTED_AGGREGATE_PROTOCOLS.includes("morpho"));
  assert.ok(SUPPORTED_AGGREGATE_PROTOCOLS.includes("tinyman"));
  assert.deepEqual(protocolsForOpportunityQuery({}), [...SUPPORTED_AGGREGATE_PROTOCOLS]);
});

test("chain=base selects Morpho, Aave, and Aerodrome; chain=algorand excludes them", () => {
  assert.deepEqual(protocolsForOpportunityQuery({ chain: "base" }), [
    "morpho",
    "aave",
    "aerodrome"
  ]);
  assert.equal(
    protocolsForOpportunityQuery({ chain: "algorand" }).includes("morpho"),
    false
  );
  assert.equal(
    protocolsForOpportunityQuery({ chain: "algorand" }).includes("aave"),
    false
  );
  assert.equal(
    protocolsForOpportunityQuery({ chain: "algorand" }).includes("aerodrome"),
    false
  );
  assert.deepEqual(protocolsForOpportunityQuery({ protocol: "tinyman", chain: "base" }), []);
  assert.deepEqual(protocolsForOpportunityQuery({ protocol: "morpho", chain: "algorand" }), []);
  assert.deepEqual(protocolsForOpportunityQuery({ protocol: "morpho", chain: "base" }), [
    "morpho"
  ]);
  assert.deepEqual(protocolsForOpportunityQuery({ protocol: "aave", chain: "base" }), ["aave"]);
});
