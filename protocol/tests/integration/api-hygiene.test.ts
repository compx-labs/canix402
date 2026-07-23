import assert from "node:assert/strict";
import test from "node:test";

import { filterOpportunitiesByActivity } from "../../src/services/opportunity-activity.js";
import { usdcAmountToMicro } from "../../src/services/payment-policy.js";
import type { OpportunityMarketRecord } from "../../src/types/opportunity.js";

function baseOpportunity(
  overrides: Partial<OpportunityMarketRecord> = {}
): OpportunityMarketRecord {
  return {
    protocol: "reti",
    opportunityType: "staking",
    opportunityId: "reti-staking-1",
    assetPair: "ALGO",
    assetIds: [0],
    apy: 8,
    yieldBasis: "apr",
    tvlUsd: 1_000,
    sourceTimestamp: "2026-07-23T00:00:00.000Z",
    fetchedAt: "2026-07-23T00:00:00.000Z",
    ...overrides
  };
}

test("includeInactive=false drops opportunities with acceptingStake false", () => {
  const active = baseOpportunity({
    opportunityId: "reti-staking-1",
    capacity: {
      stakerSlotsRemaining: 5,
      algoRoomMicroAlgos: "1000",
      acceptingStake: true
    }
  });
  const inactive = baseOpportunity({
    opportunityId: "reti-staking-2",
    capacity: {
      stakerSlotsRemaining: 0,
      algoRoomMicroAlgos: "0",
      acceptingStake: false
    }
  });
  const noCapacity = baseOpportunity({
    opportunityId: "tinyman-lp-1",
    protocol: "tinyman",
    opportunityType: "lp"
  });

  const filtered = filterOpportunitiesByActivity(
    [active, inactive, noCapacity],
    false
  );
  assert.deepEqual(
    filtered.map((row) => row.opportunityId),
    ["reti-staking-1", "tinyman-lp-1"]
  );

  const all = filterOpportunitiesByActivity([active, inactive, noCapacity], true);
  assert.equal(all.length, 3);
});

test("usdcAmountToMicro converts discovery amounts to Caddy micro-USDC", () => {
  assert.equal(usdcAmountToMicro("0.01"), "10000");
  assert.equal(usdcAmountToMicro("0.005"), "5000");
  assert.equal(usdcAmountToMicro("0.1"), "100000");
  assert.equal(usdcAmountToMicro("100"), "100000000");
  assert.equal(usdcAmountToMicro("1.5"), "1500000");
});
