import assert from "node:assert/strict";
import test from "node:test";

import {
  fixedPointAprToPercentage,
  HAYSTACK_STAKING_OPPORTUNITY_ID,
  normalizeHaystackStakingOpportunity,
  setHaystackAdapterDependenciesForTests
} from "../../src/adapters/index.js";
import { attachExecutionShapesToOpportunity } from "../../src/services/opportunity-execution-shapes.js";
import { executionRegistry } from "../../src/execution/index.js";
import type { OpportunityMarketRecord } from "../../src/types/opportunity.js";

test("fixedPointAprToPercentage treats 1e6 as 100%", () => {
  assert.equal(fixedPointAprToPercentage(1_000_000n), 100);
  assert.ok(Math.abs((fixedPointAprToPercentage(83540n) ?? 0) - 8.354) < 0.0001);
});

test("normalizeHaystackStakingOpportunity combines EMA APR components", () => {
  const record = normalizeHaystackStakingOpportunity({
    snapshot: {
      appId: 3321763884,
      hayAssetId: 3160000000,
      usdcAssetId: 31566704,
      totalStaked: 1_000_000_000_000n,
      emaAprUsdc: 2_000_000n, // 200%
      emaAprHay: 50_000n, // 5%
      paused: false
    },
    hayUsdPrice: 0.02,
    fetchedAtIso: "2026-07-22T00:00:00.000Z"
  });

  assert.ok(record);
  assert.equal(record?.opportunityId, HAYSTACK_STAKING_OPPORTUNITY_ID);
  assert.equal(record?.protocol, "haystack");
  assert.equal(record?.yieldBasis, "apr");
  assert.equal(record?.apr, 205);
  assert.equal(record?.tvlUsd, 20_000);
  assert.deepEqual(record?.assetIds, [3160000000, 31566704]);
});

test("normalizeHaystackStakingOpportunity drops paused pools", () => {
  const record = normalizeHaystackStakingOpportunity({
    snapshot: {
      appId: 3321763884,
      hayAssetId: 3160000000,
      usdcAssetId: 31566704,
      totalStaked: 1_000_000_000_000n,
      emaAprUsdc: 1_000_000n,
      emaAprHay: 0n,
      paused: true
    },
    hayUsdPrice: 0.02,
    fetchedAtIso: "2026-07-22T00:00:00.000Z"
  });
  assert.equal(record, null);
});

test("Haystack staking opportunity attaches stake enter and unstake/claim shapes", () => {
  const record: OpportunityMarketRecord = {
    protocol: "haystack",
    opportunityType: "staking",
    opportunityId: HAYSTACK_STAKING_OPPORTUNITY_ID,
    assetPair: "HAY/USDC+HAY",
    assetIds: [3160000000, 31566704],
    apy: 10,
    yieldBasis: "apr",
    tvlUsd: 1_000,
    sourceTimestamp: "2026-07-22T00:00:00.000Z",
    fetchedAt: "2026-07-22T00:00:00.000Z"
  };

  const enriched = attachExecutionShapesToOpportunity(record, executionRegistry);
  assert.equal(enriched.executionReady, true);
  assert.ok(
    enriched.executionShapes.some(
      (shape) => shape.shapeKey === "mainnet:haystack:v1:stake:hay"
    )
  );
  assert.equal(enriched.compatibleExitShapes.length, 1);
  assert.equal(
    enriched.compatibleExitShapes[0]?.shapeKey,
    "mainnet:haystack:v1:unstake:hay"
  );
  assert.deepEqual(enriched.compatibleExitShapes[0]?.requiredAssetIds, [3160000000]);
  assert.equal(enriched.compatibleExitShapes[0]?.inputHints?.assetId, 3160000000);
});

test.after(() => {
  setHaystackAdapterDependenciesForTests();
});
