import assert from "node:assert/strict";
import test from "node:test";

import {
  ALPHA_ARCADE_STAKING_OPPORTUNITY_ID,
  annualizeTrailingFeeApr,
  normalizeAlphaArcadeStakingOpportunity
} from "../../src/adapters/index.js";
import { attachExecutionShapesToOpportunity } from "../../src/services/opportunity-execution-shapes.js";
import { executionRegistry } from "../../src/execution/index.js";
import type { OpportunityMarketRecord } from "../../src/types/opportunity.js";

test("annualizeTrailingFeeApr scales weekly inflows to APR percent", () => {
  // $10 fees over 7d on $1000 TVL → (10/1000)*(365/7)*100 ≈ 52.14%
  const apr = annualizeTrailingFeeApr({
    usdcInflowsUsd: 10,
    tvlUsd: 1_000,
    windowDays: 7
  });
  assert.ok(apr !== null);
  assert.ok(Math.abs((apr ?? 0) - 52.142857) < 0.001);
});

test("normalizeAlphaArcadeStakingOpportunity builds fee-share staking row", () => {
  const record = normalizeAlphaArcadeStakingOpportunity({
    snapshot: {
      appId: 3626756314,
      alphaAssetId: 2726252423,
      usdcAssetId: 31566704,
      totalStaked: 1_000_000_000_000n, // 1M ALPHA
      appAddress: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ"
    },
    alphaUsdPrice: 0.02,
    usdcInflowsMicro: 400_000_000n, // $400 over window
    windowDays: 7,
    fetchedAtIso: "2026-07-30T00:00:00.000Z"
  });

  assert.ok(record);
  assert.equal(record?.opportunityId, ALPHA_ARCADE_STAKING_OPPORTUNITY_ID);
  assert.equal(record?.protocol, "alpha-arcade");
  assert.equal(record?.yieldBasis, "apr");
  assert.equal(record?.tvlUsd, 20_000);
  assert.deepEqual(record?.assetIds, [2726252423, 31566704]);
  assert.ok((record?.apr ?? 0) > 0);
});

test("normalizeAlphaArcadeStakingOpportunity omits row without trailing inflows", () => {
  const record = normalizeAlphaArcadeStakingOpportunity({
    snapshot: {
      appId: 3626756314,
      alphaAssetId: 2726252423,
      usdcAssetId: 31566704,
      totalStaked: 1_000_000_000_000n,
      appAddress: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ"
    },
    alphaUsdPrice: 0.02,
    usdcInflowsMicro: 0n,
    windowDays: 7,
    fetchedAtIso: "2026-07-30T00:00:00.000Z"
  });
  assert.equal(record, null);
});

test("Alpha Arcade staking opportunity attaches stake enter and unstake/claim exits", () => {
  const record: OpportunityMarketRecord = {
    protocol: "alpha-arcade",
    opportunityType: "staking",
    opportunityId: ALPHA_ARCADE_STAKING_OPPORTUNITY_ID,
    assetPair: "ALPHA/USDC",
    assetIds: [2726252423, 31566704],
    apy: 10,
    yieldBasis: "apr",
    tvlUsd: 1_000,
    sourceTimestamp: "2026-07-30T00:00:00.000Z",
    fetchedAt: "2026-07-30T00:00:00.000Z"
  };

  const enriched = attachExecutionShapesToOpportunity(record, executionRegistry);
  assert.equal(enriched.executionReady, true);
  assert.ok(
    enriched.executionShapes.some(
      (shape) => shape.shapeKey === "mainnet:alpha-arcade:v1:stake:alpha"
    )
  );
  assert.ok(
    enriched.compatibleExitShapes.some(
      (shape) => shape.shapeKey === "mainnet:alpha-arcade:v1:unstake:alpha"
    )
  );
  assert.ok(
    enriched.compatibleExitShapes.some(
      (shape) => shape.shapeKey === "mainnet:alpha-arcade:v1:claimRewards:usdc"
    )
  );
});
