import assert from "node:assert/strict";
import test from "node:test";

import {
  PRECISION_DEFAULT_DECIMALS,
  PRECISION_MAX_DECIMALS,
  formatDecimalForAgent,
  formatOpportunityForAgent
} from "../../src/services/precision.js";
import { OpportunityRecordV1 } from "../../src/types/opportunity.js";

test("formatDecimalForAgent keeps clean values unchanged", () => {
  assert.equal(formatDecimalForAgent(0.055), 0.055);
  assert.equal(formatDecimalForAgent(5.1), 5.1);
  assert.equal(formatDecimalForAgent(1_250_000), 1_250_000);
});

test("formatDecimalForAgent strips floating-point noise to the standard scale", () => {
  assert.equal(formatDecimalForAgent(0.1 + 0.2), 0.3);
});

test("formatDecimalForAgent rounds to the default of 6 decimal places", () => {
  assert.equal(formatDecimalForAgent(0.12345678), 0.123457);
});

test("formatDecimalForAgent extends precision for small non-zero values", () => {
  // Would round to 0 at 6 dp, so precision grows up to the 12 dp maximum.
  assert.equal(formatDecimalForAgent(0.00000001234), 0.00000001234);
});

test("formatDecimalForAgent never exceeds the maximum decimal places", () => {
  const formatted = formatDecimalForAgent(0.0000000000009999);
  const decimalPlaces = (formatted.toString().split(".")[1] ?? "").length;
  assert.ok(decimalPlaces <= PRECISION_MAX_DECIMALS);
});

test("formatDecimalForAgent preserves large USD magnitudes without corruption", () => {
  assert.equal(formatDecimalForAgent(1_250_000.123456), 1_250_000.123456);
});

test("formatDecimalForAgent passes through non-finite values", () => {
  assert.equal(Number.isNaN(formatDecimalForAgent(Number.NaN)), true);
});

test("default and max precision constants match the agent contract", () => {
  assert.equal(PRECISION_DEFAULT_DECIMALS, 6);
  assert.equal(PRECISION_MAX_DECIMALS, 12);
});

test("formatOpportunityForAgent formats apy, apr, and tvlUsd only", () => {
  const record: OpportunityRecordV1 = {
    protocol: "folks-finance",
    opportunityType: "lending",
    opportunityId: "folks-lending-42",
    assetPair: "ALGO",
    assetIds: [0],
    apy: 0.05500000000001,
    yieldBasis: "apy",
    apr: 0.04499999999998,
    tvlUsd: 275.0000000001,
    sourceTimestamp: "2026-07-01T12:00:00.000Z",
    fetchedAt: "2026-07-01T12:00:00.000Z"
  };

  const formatted = formatOpportunityForAgent(record);

  assert.equal(formatted.apy, 0.055);
  assert.equal(formatted.apr, 0.045);
  assert.equal(formatted.tvlUsd, 275);
  assert.equal(formatted.opportunityId, "folks-lending-42");
  assert.deepEqual(formatted.assetIds, [0]);
});

test("formatOpportunityForAgent omits apr when absent", () => {
  const record: OpportunityRecordV1 = {
    protocol: "tinyman",
    opportunityType: "lp",
    opportunityId: "x:lp",
    assetPair: "A/B",
    apy: 1.2345678,
    yieldBasis: "apy",
    tvlUsd: 1000,
    sourceTimestamp: "2026-07-01T12:00:00.000Z",
    fetchedAt: "2026-07-01T12:00:00.000Z"
  };

  const formatted = formatOpportunityForAgent(record);

  assert.equal("apr" in formatted, false);
  assert.equal(formatted.apy, 1.234568);
});
