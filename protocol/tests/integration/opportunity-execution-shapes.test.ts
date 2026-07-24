import assert from "node:assert/strict";
import test from "node:test";

import { executionRegistry } from "../../src/execution/index.js";
import { pactAddLiquidityAndFarmTwoSidedShape } from "../../src/execution/shapes/pact/add-liquidity-and-farm-two-sided.js";
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
  assert.deepEqual(enriched.compatibleExitShapes, []);
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
    poolAppId: 3495906641,
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
  assert.equal(enriched.executionShapes[2]?.inputHints?.farmAppId, 3625283323);
  assert.equal(enriched.executionShapes[2]?.inputHints?.poolAppId, 3495906641);
  assert.notEqual(
    enriched.executionShapes[2]?.inputHints?.poolAppId,
    enriched.executionShapes[2]?.inputHints?.farmAppId
  );
  // Farm id must not be overloaded into poolId; composite shapes need poolAppId.
  assert.equal(enriched.executionShapes[2]?.inputHints?.poolId, undefined);
  assert.equal(
    (enriched as { poolAppId?: number }).poolAppId,
    undefined
  );
});

test("Pact ALGO/USDC farm 3585364727 hints include distinct AMM poolAppId", () => {
  const farmAppId = 3585364727;
  const poolAppId = 2966876920;
  const record: OpportunityMarketRecord = {
    protocol: "pact",
    opportunityType: "farm",
    opportunityId: `${farmAppId}:farm`,
    assetPair: "ALGO/USDC",
    assetIds: [0, 31566704],
    poolAppId,
    apy: 14,
    yieldBasis: "apr",
    tvlUsd: 3_147,
    sourceTimestamp: "2026-07-23T00:00:00.000Z",
    fetchedAt: "2026-07-23T00:00:00.000Z"
  };

  const enriched = attachExecutionShapesToOpportunity(record, executionRegistry);
  const addAndFarm = enriched.executionShapes.find(
    (shape) => shape.shapeKey === "mainnet:pact:v1:addLiquidityAndFarm:twoSided"
  );
  assert.ok(addAndFarm);
  assert.equal(addAndFarm?.inputHints?.farmAppId, farmAppId);
  assert.equal(addAndFarm?.inputHints?.poolAppId, poolAppId);
  assert.notEqual(addAndFarm?.inputHints?.poolAppId, addAndFarm?.inputHints?.farmAppId);
  assert.equal(addAndFarm?.inputHints?.assetAId, 0);
  assert.equal(addAndFarm?.inputHints?.assetBId, 31566704);
  assert.ok(addAndFarm?.requiredInputs.includes("poolAppId"));
  assert.ok(addAndFarm?.requiredInputs.includes("farmAppId"));

  // Hints alone must satisfy poolAppId validation when merged into a quote input.
  const parsed = pactAddLiquidityAndFarmTwoSidedShape.parseInput({
    userAddress: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ",
    ...addAndFarm?.inputHints,
    assetAAmount: "1000000",
    assetBAmount: "1000000",
    maxSlippageBps: 50
  });
  assert.equal(parsed.farmAppId, farmAppId);
  assert.equal(parsed.poolAppId, poolAppId);
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

  const farmedLp = attachExecutionShapesToPosition({
    protocol: "tinyman",
    positionType: "lp",
    positionId: "tinyman:lp:1",
    opportunityId: "pool:lp",
    assetId: 1,
    assetSymbol: "LP",
    amountRaw: "1",
    amount: "1",
    usdValue: 1,
    caveats: [
      "Committed to Tinyman farm staking; farm stakes the full wallet LP balance."
    ]
  });
  assert.ok(
    farmedLp.compatibleExitShapeKeys.includes(
      "mainnet:tinyman:staking-v1:farm:uncommit"
    )
  );

  const farmReward = attachExecutionShapesToPosition({
    protocol: "tinyman",
    positionType: "reward",
    positionId: "tinyman:reward:pool:258:2200000000",
    opportunityId: "pool:farm",
    assetId: 2200000000,
    assetSymbol: "TINY",
    amountRaw: "1",
    amount: "1",
    usdValue: 1,
    inputHints: {
      programId: 258,
      poolId: "pool",
      assetId: 2200000000
    }
  });
  assert.deepEqual(farmReward.compatibleManageShapeKeys, [
    "mainnet:tinyman:staking-v1:farm:claimRewards"
  ]);
  assert.deepEqual(farmReward.compatibleExitShapeKeys, []);
  assert.deepEqual(farmReward.inputHints, {
    programId: 258,
    poolId: "pool",
    assetId: 2200000000
  });

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

test("Liquid-staking wallet positions attach exclusive burn/unstake/redeem exits", () => {
  const talgo = attachExecutionShapesToPosition({
    protocol: "tinyman",
    positionType: "staked",
    positionId: "tinyman:staked:talgo:2537013734",
    opportunityId: "tinyman-staking-talgo",
    assetId: 2537013734,
    assetSymbol: "tALGO",
    amountRaw: "1000000",
    amount: "1",
    usdValue: 1
  });
  assert.deepEqual(talgo.compatibleExitShapeKeys, [
    "mainnet:tinyman:liquid-stake-v1:burn:tAlgo"
  ]);
  assert.deepEqual(talgo.compatibleManageShapeKeys, []);

  const stalgo = attachExecutionShapesToPosition({
    protocol: "tinyman",
    positionType: "staked",
    positionId: "tinyman:staked:stalgo:2537023208",
    opportunityId: "tinyman-staking-stalgo",
    assetId: 2537023208,
    assetSymbol: "stALGO",
    amountRaw: "1000000",
    amount: "1",
    usdValue: 1
  });
  assert.deepEqual(stalgo.compatibleExitShapeKeys, [
    "mainnet:tinyman:restake-v1:decreaseStake:stAlgo"
  ]);
  assert.deepEqual(stalgo.compatibleManageShapeKeys, [
    "mainnet:tinyman:restake-v1:claimRewards:stAlgo"
  ]);

  const xalgo = attachExecutionShapesToPosition({
    protocol: "folks-finance",
    positionType: "staked",
    positionId: "folks-finance:staked:xalgo:1134696561",
    opportunityId: "folks-staking-xalgo",
    assetId: 1134696561,
    assetSymbol: "xALGO",
    amountRaw: "1000000",
    amount: "1",
    usdValue: 1
  });
  assert.deepEqual(xalgo.compatibleExitShapeKeys, [
    "mainnet:folks-finance:xalgo-v1:unstake:immediate"
  ]);

  const myth = attachExecutionShapesToPosition({
    protocol: "myth-finance",
    positionType: "staked",
    positionId: "myth-finance:staked:3028076093:3028084000",
    opportunityId: "myth-staking-3028076093",
    assetId: 3028084000,
    assetSymbol: "memoALGO",
    amountRaw: "1000000",
    amount: "1",
    usdValue: 1
  });
  assert.deepEqual(myth.compatibleExitShapeKeys, [
    "mainnet:myth-finance:dualstake-v1:redeem:lst"
  ]);
});

test("Tinyman tALGO staking attaches mint enter and burn exit", () => {
  const record: OpportunityMarketRecord = {
    protocol: "tinyman",
    opportunityType: "staking",
    opportunityId: "tinyman-staking-talgo",
    assetPair: "ALGO/tALGO",
    assetIds: [0, 2537013734],
    apy: 4,
    yieldBasis: "apy",
    tvlUsd: 100_000,
    sourceTimestamp: "2026-07-17T00:00:00.000Z",
    fetchedAt: "2026-07-17T00:00:00.000Z"
  };

  const enriched = attachExecutionShapesToOpportunity(record, executionRegistry);
  assert.equal(enriched.executionReady, true);
  assert.equal(enriched.executionShapes.length, 1);
  assert.equal(
    enriched.executionShapes[0]?.shapeKey,
    "mainnet:tinyman:liquid-stake-v1:mint:tAlgo"
  );
  assert.deepEqual(enriched.executionShapes[0]?.requiredAssetIds, [0]);
  assert.equal(enriched.executionShapes[0]?.inputHints?.assetId, 0);
  assert.equal(enriched.compatibleExitShapes.length, 1);
  assert.equal(
    enriched.compatibleExitShapes[0]?.shapeKey,
    "mainnet:tinyman:liquid-stake-v1:burn:tAlgo"
  );
  assert.deepEqual(enriched.compatibleExitShapes[0]?.requiredAssetIds, [
    2537013734
  ]);
  assert.equal(enriched.compatibleExitShapes[0]?.inputHints?.assetId, 2537013734);
  assert.equal(
    enriched.compatibleExitShapes[0]?.inputHints?.depositAssetId,
    2537013734
  );
});

test("Tinyman stALGO staking attaches increase enter and decrease exit", () => {
  const record: OpportunityMarketRecord = {
    protocol: "tinyman",
    opportunityType: "staking",
    opportunityId: "tinyman-staking-stalgo",
    assetPair: "tALGO/stALGO",
    assetIds: [2537013734, 2537023208],
    apy: 12,
    yieldBasis: "apr",
    tvlUsd: 50_000,
    sourceTimestamp: "2026-07-17T00:00:00.000Z",
    fetchedAt: "2026-07-17T00:00:00.000Z"
  };

  const enriched = attachExecutionShapesToOpportunity(record, executionRegistry);
  assert.equal(enriched.executionReady, true);
  assert.equal(enriched.executionShapes.length, 1);
  assert.equal(
    enriched.executionShapes[0]?.shapeKey,
    "mainnet:tinyman:restake-v1:increaseStake:stAlgo"
  );
  assert.deepEqual(enriched.executionShapes[0]?.requiredAssetIds, [2537013734]);
  assert.equal(enriched.executionShapes[0]?.inputHints?.assetId, 2537013734);
  assert.equal(enriched.compatibleExitShapes.length, 1);
  assert.equal(
    enriched.compatibleExitShapes[0]?.shapeKey,
    "mainnet:tinyman:restake-v1:decreaseStake:stAlgo"
  );
  assert.deepEqual(enriched.compatibleExitShapes[0]?.requiredAssetIds, [
    2537023208
  ]);
});

test("Folks xALGO staking attaches stake enter and unstake exit", () => {
  const record: OpportunityMarketRecord = {
    protocol: "folks-finance",
    opportunityType: "staking",
    opportunityId: "folks-staking-xalgo",
    assetPair: "ALGO/xALGO",
    assetIds: [0, 1134696561],
    apy: 3.5,
    yieldBasis: "apy",
    tvlUsd: 1_000_000,
    sourceTimestamp: "2026-07-17T00:00:00.000Z",
    fetchedAt: "2026-07-17T00:00:00.000Z"
  };

  const enriched = attachExecutionShapesToOpportunity(record, executionRegistry);
  assert.equal(enriched.executionReady, true);
  assert.equal(enriched.executionShapes.length, 1);
  assert.equal(
    enriched.executionShapes[0]?.shapeKey,
    "mainnet:folks-finance:xalgo-v1:stake:immediate"
  );
  assert.deepEqual(enriched.executionShapes[0]?.requiredAssetIds, [0]);
  assert.equal(enriched.executionShapes[0]?.inputHints?.assetId, 0);
  assert.equal(enriched.compatibleExitShapes.length, 1);
  assert.equal(
    enriched.compatibleExitShapes[0]?.shapeKey,
    "mainnet:folks-finance:xalgo-v1:unstake:immediate"
  );
  assert.deepEqual(enriched.compatibleExitShapes[0]?.requiredAssetIds, [
    1134696561
  ]);
  assert.equal(enriched.compatibleExitShapes[0]?.inputHints?.assetId, 1134696561);
  assert.equal(
    enriched.compatibleExitShapes[0]?.inputHints?.depositAssetId,
    1134696561
  );
});

test("Dork.fi USDC lending opportunity and supplied position share pool-based opportunityId", () => {
  const opportunityId = "dorkfi:algorand:3333688282:31566704:lending";
  const record: OpportunityMarketRecord = {
    protocol: "dorkfi",
    opportunityType: "lending",
    opportunityId,
    assetPair: "USDC",
    assetIds: [31566704],
    apy: 5,
    yieldBasis: "apy",
    tvlUsd: 1_000_000,
    sourceTimestamp: "2026-07-22T00:00:00.000Z",
    fetchedAt: "2026-07-22T00:00:00.000Z"
  };

  const enriched = attachExecutionShapesToOpportunity(record, executionRegistry);
  assert.equal(enriched.executionReady, true);
  assert.equal(
    enriched.executionShapes[0]?.shapeKey,
    "mainnet:dorkfi:v1:deposit:asa"
  );
  assert.equal(enriched.executionShapes[0]?.inputHints?.poolAppId, 3333688282);
  assert.equal(enriched.executionShapes[0]?.inputHints?.marketAppId, 3210682240);
  assert.equal(enriched.executionShapes[0]?.inputHints?.assetId, 31566704);

  // On-chain ASA fallback positions must use the same opportunityId scheme so
  // clients can match enter → position → withdraw via exact equality.
  const position = attachExecutionShapesToPosition({
    protocol: "dorkfi",
    positionType: "supplied",
    positionId: "dorkfi:supplied:3210682240",
    opportunityId,
    assetId: 31566704,
    assetSymbol: "USDC",
    amountRaw: "1000000",
    amount: "1",
    usdValue: null,
    inputHints: {
      poolAppId: 3333688282,
      marketAppId: 3210682240,
      assetId: 31566704
    }
  });
  assert.equal(position.opportunityId, enriched.opportunityId);
  assert.ok(
    position.compatibleExitShapeKeys.includes("mainnet:dorkfi:v1:withdraw:asa")
  );
  assert.deepEqual(position.inputHints, {
    poolAppId: 3333688282,
    marketAppId: 3210682240,
    assetId: 31566704
  });
  // Withdraw quotes can use position inputHints or opportunity enter hints.
  assert.equal(enriched.executionShapes[0]?.inputHints?.marketAppId, 3210682240);
  assert.notEqual(
    enriched.executionShapes[0]?.inputHints?.marketAppId,
    enriched.executionShapes[0]?.inputHints?.poolAppId
  );
});

test("Myth dualSTAKE staking attaches mint enter and redeem exit", () => {
  const record: OpportunityMarketRecord = {
    protocol: "myth-finance",
    opportunityType: "staking",
    opportunityId: "myth-staking-3028076093",
    assetPair: "ALGO/MemO→memoALGO",
    assetIds: [0, 885835936, 3028084000],
    apy: 4.2,
    yieldBasis: "apy",
    tvlUsd: 50_000,
    sourceTimestamp: "2026-07-22T00:00:00.000Z",
    fetchedAt: "2026-07-22T00:00:00.000Z"
  };

  const enriched = attachExecutionShapesToOpportunity(record, executionRegistry);
  assert.equal(enriched.executionReady, true);
  assert.equal(enriched.executionShapes.length, 1);
  assert.equal(
    enriched.executionShapes[0]?.shapeKey,
    "mainnet:myth-finance:dualstake-v1:mint:lst"
  );
  assert.deepEqual(enriched.executionShapes[0]?.requiredAssetIds, [0, 885835936]);
  assert.equal(enriched.executionShapes[0]?.inputHints?.poolAppId, 3028076093);
  assert.equal(enriched.executionShapes[0]?.inputHints?.assetAId, 0);
  assert.equal(enriched.executionShapes[0]?.inputHints?.assetBId, 885835936);
  assert.equal(enriched.compatibleExitShapes.length, 1);
  assert.equal(
    enriched.compatibleExitShapes[0]?.shapeKey,
    "mainnet:myth-finance:dualstake-v1:redeem:lst"
  );
  assert.deepEqual(enriched.compatibleExitShapes[0]?.requiredAssetIds, [
    3028084000
  ]);
  assert.equal(enriched.compatibleExitShapes[0]?.inputHints?.assetId, 3028084000);
  assert.equal(enriched.compatibleExitShapes[0]?.inputHints?.poolAppId, 3028076093);
});

test("Myth farm attaches mint enter and redeem exit", () => {
  const record: OpportunityMarketRecord = {
    protocol: "myth-finance",
    opportunityType: "farm",
    opportunityId: "myth-farm-2933534328",
    assetPair: "fooALGO farm (FOO)",
    assetIds: [0, 1284444444, 2933535000],
    apy: 0.0582,
    yieldBasis: "apr",
    tvlUsd: 10_000,
    sourceTimestamp: "2026-07-22T00:00:00.000Z",
    fetchedAt: "2026-07-22T00:00:00.000Z"
  };

  const enriched = attachExecutionShapesToOpportunity(record, executionRegistry);
  assert.equal(enriched.executionReady, true);
  assert.equal(
    enriched.executionShapes[0]?.shapeKey,
    "mainnet:myth-finance:dualstake-v1:mint:lst"
  );
  assert.equal(
    enriched.compatibleExitShapes[0]?.shapeKey,
    "mainnet:myth-finance:dualstake-v1:redeem:lst"
  );
});

test("Réti staking attaches stake enter with validatorId hint", () => {
  const record: OpportunityMarketRecord = {
    protocol: "reti",
    opportunityType: "staking",
    opportunityId: "reti-staking-12",
    assetPair: "ALGO",
    assetIds: [0],
    apy: 8.5,
    yieldBasis: "apr",
    tvlUsd: 50_000,
    sourceTimestamp: "2026-07-23T00:00:00.000Z",
    fetchedAt: "2026-07-23T00:00:00.000Z",
    entryRequirements: {
      minAmount: { assetId: 0, amount: "1000000000" },
      eligibilityFullyCheckable: true
    },
    capacity: {
      stakerSlotsRemaining: 20,
      algoRoomMicroAlgos: "1000000000",
      acceptingStake: true
    }
  };

  const enriched = attachExecutionShapesToOpportunity(record, executionRegistry);
  assert.equal(enriched.executionReady, true);
  assert.equal(enriched.executionShapes.length, 1);
  assert.equal(enriched.executionShapes[0]?.shapeKey, "mainnet:reti:v1:stake:algo");
  assert.equal(enriched.executionShapes[0]?.inputHints?.validatorId, 12);
  assert.deepEqual(enriched.executionShapes[0]?.requiredAssetIds, [0]);
  assert.equal(enriched.compatibleExitShapes.length, 1);
  assert.equal(
    enriched.compatibleExitShapes[0]?.shapeKey,
    "mainnet:reti:v1:unstake:algo"
  );
  assert.deepEqual(enriched.compatibleExitShapes[0]?.requiredAssetIds, [0]);
  assert.equal(enriched.compatibleExitShapes[0]?.inputHints?.validatorId, 12);
  assert.equal(enriched.compatibleExitShapes[0]?.inputHints?.assetId, 0);

  const position = attachExecutionShapesToPosition({
    protocol: "reti",
    positionType: "staked",
    positionId: "reti:staked:12:99",
    opportunityId: "reti-staking-12",
    assetId: 0,
    assetSymbol: "ALGO",
    amountRaw: "2000000000",
    amount: "2000",
    usdValue: 400,
    inputHints: { validatorId: 12, poolAppId: 99, assetId: 0 }
  });
  assert.deepEqual(position.compatibleExitShapeKeys, ["mainnet:reti:v1:unstake:algo"]);
});
