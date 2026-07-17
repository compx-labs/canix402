import assert from "node:assert/strict";
import test from "node:test";

import { executionRegistry } from "../../src/execution/index.js";
import {
  attachExecutionShapesToOpportunity
} from "../../src/services/opportunity-execution-shapes.js";
import {
  attachExecutionShapesToPosition
} from "../../src/services/position-execution-shapes.js";
import type { OpportunityMarketRecord } from "../../src/types/opportunity.js";

test("Tinyman LP enter shapes are three alternatives at order 0", () => {
  const record: OpportunityMarketRecord = {
    protocol: "tinyman",
    opportunityType: "lp",
    opportunityId: "POOLADDR:lp",
    assetPair: "USDC/ALGO",
    assetIds: [31566704, 0],
    apy: 1,
    yieldBasis: "apy",
    tvlUsd: 1000,
    sourceTimestamp: "2026-07-01T00:00:00.000Z",
    fetchedAt: "2026-07-01T00:00:00.000Z"
  };

  const enriched = attachExecutionShapesToOpportunity(record, executionRegistry);
  assert.equal(enriched.executionReady, true);
  assert.equal(enriched.executionShapes.length, 3);
  assert.ok(
    enriched.executionShapes.every(
      (shape) =>
        shape.order === 0 &&
        shape.prerequisiteShapeKeys === undefined &&
        shape.action === "addLiquidity"
    )
  );
  assert.deepEqual(enriched.executionShapes[0]?.requiredAssetIds, [31566704, 0]);
  assert.equal(enriched.executionShapes[0]?.inputHints?.assetAId, 31566704);
  assert.equal(enriched.executionShapes[0]?.inputHints?.assetBId, 0);
});

test("CompX staking enter shapes include stake only", () => {
  const record: OpportunityMarketRecord = {
    protocol: "compx",
    opportunityType: "staking",
    opportunityId: "compx-staking-3500000001",
    assetPair: "COMPX",
    assetIds: [1058926737, 793124631],
    apy: 10,
    yieldBasis: "apr",
    tvlUsd: 500,
    sourceTimestamp: "2026-07-01T00:00:00.000Z",
    fetchedAt: "2026-07-01T00:00:00.000Z"
  };

  const enriched = attachExecutionShapesToOpportunity(record, executionRegistry);
  assert.equal(enriched.executionReady, true);
  assert.equal(enriched.executionShapes.length, 1);
  assert.equal(enriched.executionShapes[0]?.action, "stake");
  assert.deepEqual(enriched.executionShapes[0]?.requiredAssetIds, [1058926737]);
  assert.equal(enriched.executionShapes[0]?.inputHints?.poolAppId, 3500000001);
});

test("Folks lending enter shapes are ordered with prerequisites", () => {
  const record: OpportunityMarketRecord = {
    protocol: "folks-finance",
    opportunityType: "lending",
    opportunityId: "folks-lending-971372237",
    assetPair: "USDC",
    assetIds: [31566704],
    apy: 5,
    yieldBasis: "apy",
    tvlUsd: 1_000_000,
    sourceTimestamp: "2026-07-01T00:00:00.000Z",
    fetchedAt: "2026-07-01T00:00:00.000Z"
  };

  const enriched = attachExecutionShapesToOpportunity(record, executionRegistry);
  assert.equal(enriched.executionReady, true);
  assert.equal(enriched.executionShapes.length, 3);
  assert.deepEqual(
    enriched.executionShapes.map((shape) => shape.variant),
    ["depositEscrow", "optEscrowAsset", "escrow"]
  );
  assert.deepEqual(
    enriched.executionShapes.map((shape) => shape.order),
    [0, 1, 2]
  );
  assert.equal(enriched.executionShapes[0]?.prerequisiteShapeKeys, undefined);
  assert.deepEqual(enriched.executionShapes[1]?.prerequisiteShapeKeys, [
    "mainnet:folks-finance:v2:setup:depositEscrow"
  ]);
  assert.deepEqual(enriched.executionShapes[2]?.prerequisiteShapeKeys, [
    "mainnet:folks-finance:v2:setup:optEscrowAsset"
  ]);
  assert.deepEqual(enriched.executionShapes[2]?.requiredAssetIds, [31566704]);
});

test("Pact farm enter shapes are ordered deploy then stake/addLiquidityAndFarm", () => {
  const record: OpportunityMarketRecord = {
    protocol: "pact",
    opportunityType: "farm",
    opportunityId: "3625283323:farm",
    assetPair: "USDC/ALGO",
    assetIds: [31566704, 0],
    apy: 12,
    yieldBasis: "apr",
    tvlUsd: 50_000,
    sourceTimestamp: "2026-07-01T00:00:00.000Z",
    fetchedAt: "2026-07-01T00:00:00.000Z"
  };

  const enriched = attachExecutionShapesToOpportunity(record, executionRegistry);
  assert.equal(enriched.executionReady, true);
  assert.equal(enriched.executionShapes.length, 3);
  assert.deepEqual(
    enriched.executionShapes.map((shape) => shape.shapeKey),
    [
      "mainnet:pact:v1:farm:deployEscrow",
      "mainnet:pact:v1:farm:stake",
      "mainnet:pact:v1:addLiquidityAndFarm:twoSided"
    ]
  );
  assert.deepEqual(
    enriched.executionShapes.map((shape) => shape.order),
    [0, 1, 1]
  );
  assert.equal(enriched.executionShapes[0]?.prerequisiteShapeKeys, undefined);
  assert.deepEqual(enriched.executionShapes[1]?.prerequisiteShapeKeys, [
    "mainnet:pact:v1:farm:deployEscrow"
  ]);
  assert.deepEqual(enriched.executionShapes[2]?.prerequisiteShapeKeys, [
    "mainnet:pact:v1:farm:deployEscrow"
  ]);
  assert.equal(enriched.executionShapes[0]?.inputHints?.farmAppId, 3625283323);
  assert.equal(enriched.executionShapes[0]?.inputHints?.poolId, "3625283323");
});

test("LP positions expose exit shapes and staking positions expose unstake/claim", () => {
  const lp = attachExecutionShapesToPosition({
    protocol: "tinyman",
    positionType: "lp",
    positionId: "tinyman:lp:1",
    opportunityId: null,
    assetId: 1,
    assetSymbol: "LP",
    amountRaw: "1",
    amount: "1",
    usdValue: 1
  });
  assert.ok(lp.compatibleExitShapeKeys.some((key) => key.includes("removeLiquidity")));
  assert.equal(lp.compatibleManageShapeKeys.length, 0);

  const staked = attachExecutionShapesToPosition({
    protocol: "compx",
    positionType: "staked",
    positionId: "compx:staked:1",
    opportunityId: "compx-staking-1",
    assetId: 1,
    assetSymbol: "COMPX",
    amountRaw: "1",
    amount: "1",
    usdValue: 1
  });
  assert.ok(staked.compatibleExitShapeKeys.some((key) => key.includes("unstake")));
  assert.ok(staked.compatibleManageShapeKeys.some((key) => key.includes("claim")));
});
