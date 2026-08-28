import assert from "node:assert/strict";
import test from "node:test";

import {
  ALPHA_ARCADE_STAKING_OPPORTUNITY_ID,
  HAYSTACK_STAKING_OPPORTUNITY_ID,
  normalizeAlphaArcadeStakingOpportunity,
  normalizeCompxLendingOpportunity,
  normalizeDorkFiOpportunity,
  normalizeFolksLendingOpportunity,
  normalizeHaystackStakingOpportunity,
  normalizeMythFarmOpportunity,
  normalizeMythStakingOpportunity,
  normalizePactFarm,
  normalizePactPool,
  normalizeRetiStakingOpportunity,
  normalizeTinymanFarm,
  normalizeTinymanPool
} from "../../src/adapters/index.js";
import { USDC_ASSET_ID } from "../../src/execution/shapes/haystack/constants.js";
import { attachExecutionShapesToOpportunity } from "../../src/services/opportunity-execution-shapes.js";
import {
  COMPX_FETCHED_AT,
  COMPX_USDC_ASSET_ID,
  compxUsdcLendingMarket,
  usdcAssetInfo
} from "../fixtures/adapters/compx-sdk.js";
import {
  DORKFI_FIXTURE_FETCHED_AT,
  dorkfiUsdcLending
} from "../fixtures/adapters/dorkfi-feed.js";
import { folksAlgoLendingFixture } from "../fixtures/adapters/folks-sdk.js";
import {
  PACT_FIXTURE_FETCHED_AT,
  pactAlgoUsdcLp,
  pactJoinedFarm
} from "../fixtures/adapters/pact-pools.js";
import {
  ALPHA_ARCADE_ALPHA_USD_PRICE,
  ALPHA_ARCADE_FIXTURE_FETCHED_AT,
  ALPHA_ARCADE_WINDOW_DAYS,
  alphaArcadePoolSnapshot
} from "../fixtures/adapters/alpha-arcade.js";
import {
  HAYSTACK_FIXTURE_FETCHED_AT,
  HAYSTACK_HAY_USD_PRICE,
  haystackPoolSnapshot
} from "../fixtures/adapters/haystack.js";
import {
  MYTH_ALGO_USD_PRICE,
  MYTH_APP_ID,
  MYTH_ASA_ID,
  MYTH_FIXTURE_FETCHED_AT,
  mythActiveFarm,
  mythListingSnapshot
} from "../fixtures/adapters/myth-finance.js";
import {
  RETI_ALGO_USD_PRICE,
  RETI_FIXTURE_FETCHED_AT,
  retiValidatorSnapshot
} from "../fixtures/adapters/reti.js";
import {
  TINYMAN_FIXTURE_FETCHED_AT,
  tinymanAlgoUsdcWithFarm,
  tinymanCompxAlgoPool
} from "../fixtures/adapters/tinyman-pools.js";
import {
  assertValidMarketRecord,
  assertValidPublicOpportunity
} from "./helpers/assert-market-record.js";

test("normalized Tinyman LP/farm rows attach enter shapes without HTTP or chain", () => {
  const lp = normalizeTinymanPool(tinymanCompxAlgoPool, TINYMAN_FIXTURE_FETCHED_AT);
  assertValidMarketRecord(lp);
  const lpPublic = attachExecutionShapesToOpportunity(lp);
  assertValidPublicOpportunity(lpPublic);
  assert.equal(lpPublic.executionReady, true);
  assert.equal(lpPublic.executionShapes.length, 3);
  assert.ok(lpPublic.executionShapes.every((shape) => shape.action === "addLiquidity"));
  assert.deepEqual(lpPublic.compatibleExitShapes, []);

  const farm = normalizeTinymanFarm(tinymanAlgoUsdcWithFarm, TINYMAN_FIXTURE_FETCHED_AT);
  assertValidMarketRecord(farm);
  const farmPublic = attachExecutionShapesToOpportunity(farm);
  assertValidPublicOpportunity(farmPublic);
  assert.equal(farmPublic.executionReady, true);
  assert.ok(farmPublic.executionShapes.some((shape) => shape.action === "farm"));
});

test("normalized Pact LP/farm rows attach enter shapes and strip poolAppId", () => {
  const lp = normalizePactPool(pactAlgoUsdcLp, PACT_FIXTURE_FETCHED_AT);
  assertValidMarketRecord(lp);
  const lpPublic = attachExecutionShapesToOpportunity(lp);
  assertValidPublicOpportunity(lpPublic);
  assert.equal(lpPublic.executionReady, true);

  const farm = normalizePactFarm(pactAlgoUsdcLp, pactJoinedFarm, PACT_FIXTURE_FETCHED_AT);
  assertValidMarketRecord(farm);
  assert.equal(farm.poolAppId, 1072843805);
  const farmPublic = attachExecutionShapesToOpportunity(farm);
  assertValidPublicOpportunity(farmPublic);
  assert.equal(farmPublic.executionReady, true);
  const addAndFarm = farmPublic.executionShapes.find(
    (shape) => shape.shapeKey === "mainnet:pact:v1:addLiquidityAndFarm:twoSided"
  );
  assert.equal(addAndFarm?.inputHints?.farmAppId, 3625283323);
  assert.equal(addAndFarm?.inputHints?.poolAppId, 1072843805);
});

test("normalized Folks lending rows attach ordered escrow enter steps", () => {
  const record = normalizeFolksLendingOpportunity(folksAlgoLendingFixture());
  assertValidMarketRecord(record);
  const publicRecord = attachExecutionShapesToOpportunity(record);
  assertValidPublicOpportunity(publicRecord);
  assert.equal(publicRecord.executionReady, true);
  assert.deepEqual(
    publicRecord.executionShapes.map((shape) => shape.order),
    [0, 1, 2]
  );
  assert.equal(
    publicRecord.executionShapes[2]?.prerequisiteShapeKeys?.[0],
    publicRecord.executionShapes[1]?.shapeKey
  );
});

test("normalized CompX lending rows attach deposit enter shape from recorded market", () => {
  const record = normalizeCompxLendingOpportunity({
    market: compxUsdcLendingMarket(),
    assetById: new Map([[COMPX_USDC_ASSET_ID, usdcAssetInfo()]]),
    fetchedAtIso: COMPX_FETCHED_AT
  });
  assertValidMarketRecord(record);
  const publicRecord = attachExecutionShapesToOpportunity(record);
  assertValidPublicOpportunity(publicRecord);
  assert.equal(publicRecord.executionReady, true);
  assert.equal(publicRecord.executionShapes[0]?.action, "deposit");
  assert.equal(publicRecord.executionShapes[0]?.inputHints?.marketAppId, 123456);
  assert.equal(publicRecord.executionShapes[0]?.inputHints?.assetId, COMPX_USDC_ASSET_ID);
});

test("normalized Dork.fi lending rows attach deposit enter shape from recorded feed", () => {
  const record = normalizeDorkFiOpportunity(dorkfiUsdcLending, DORKFI_FIXTURE_FETCHED_AT);
  assertValidMarketRecord(record);
  const publicRecord = attachExecutionShapesToOpportunity(record);
  assertValidPublicOpportunity(publicRecord);
  assert.equal(publicRecord.executionReady, true);
  assert.equal(publicRecord.executionShapes[0]?.action, "deposit");
  assert.equal(publicRecord.executionShapes[0]?.inputHints?.poolAppId, 3333688282);
  assert.equal(publicRecord.executionShapes[0]?.inputHints?.assetId, USDC_ASSET_ID);
});

test("normalized Myth dualSTAKE staking/farm rows attach mint enter and redeem exit", () => {
  const staking = normalizeMythStakingOpportunity({
    snapshot: mythListingSnapshot(),
    consensusApr: 5,
    sampleSize: 100,
    algoUsdPrice: MYTH_ALGO_USD_PRICE,
    farm: mythActiveFarm(),
    fetchedAtIso: MYTH_FIXTURE_FETCHED_AT
  });
  assertValidMarketRecord(staking);
  const stakingPublic = attachExecutionShapesToOpportunity(staking);
  assertValidPublicOpportunity(stakingPublic);
  assert.equal(stakingPublic.executionReady, true);
  assert.equal(
    stakingPublic.executionShapes[0]?.shapeKey,
    "mainnet:myth-finance:dualstake-v1:mint:lst"
  );
  assert.equal(stakingPublic.executionShapes[0]?.inputHints?.poolAppId, Number(MYTH_APP_ID));
  assert.deepEqual(stakingPublic.executionShapes[0]?.requiredAssetIds, [0, Number(MYTH_ASA_ID)]);
  assert.equal(
    stakingPublic.compatibleExitShapes[0]?.shapeKey,
    "mainnet:myth-finance:dualstake-v1:redeem:lst"
  );

  const farm = normalizeMythFarmOpportunity({
    snapshot: mythListingSnapshot(),
    farm: mythActiveFarm(),
    algoUsdPrice: MYTH_ALGO_USD_PRICE,
    fetchedAtIso: MYTH_FIXTURE_FETCHED_AT
  });
  assertValidMarketRecord(farm);
  const farmPublic = attachExecutionShapesToOpportunity(farm);
  assertValidPublicOpportunity(farmPublic);
  assert.equal(farmPublic.executionReady, true);
  assert.equal(
    farmPublic.executionShapes[0]?.shapeKey,
    "mainnet:myth-finance:dualstake-v1:mint:lst"
  );
});

test("normalized Haystack staking rows attach stake enter and unstake exit", () => {
  const record = normalizeHaystackStakingOpportunity({
    snapshot: haystackPoolSnapshot(),
    hayUsdPrice: HAYSTACK_HAY_USD_PRICE,
    fetchedAtIso: HAYSTACK_FIXTURE_FETCHED_AT
  });
  assertValidMarketRecord(record);
  const publicRecord = attachExecutionShapesToOpportunity(record);
  assertValidPublicOpportunity(publicRecord);
  assert.equal(publicRecord.executionReady, true);
  assert.equal(publicRecord.opportunityId, HAYSTACK_STAKING_OPPORTUNITY_ID);
  assert.ok(
    publicRecord.executionShapes.some(
      (shape) => shape.shapeKey === "mainnet:haystack:v1:stake:hay"
    )
  );
  assert.equal(publicRecord.compatibleExitShapes.length, 1);
  assert.equal(
    publicRecord.compatibleExitShapes[0]?.shapeKey,
    "mainnet:haystack:v1:unstake:hay"
  );
});

test("normalized Réti staking rows attach stake enter, unstake exit, and validator hints", () => {
  const record = normalizeRetiStakingOpportunity({
    snapshot: retiValidatorSnapshot(),
    consensusApr: 10,
    sampleSize: 32,
    algoUsdPrice: RETI_ALGO_USD_PRICE,
    fetchedAtIso: RETI_FIXTURE_FETCHED_AT
  });
  assertValidMarketRecord(record);
  const publicRecord = attachExecutionShapesToOpportunity(record);
  assertValidPublicOpportunity(publicRecord);
  assert.equal(publicRecord.executionReady, true);
  assert.equal(publicRecord.executionShapes[0]?.shapeKey, "mainnet:reti:v1:stake:algo");
  assert.equal(publicRecord.executionShapes[0]?.inputHints?.validatorId, 7);
  assert.equal(
    publicRecord.compatibleExitShapes[0]?.shapeKey,
    "mainnet:reti:v1:unstake:algo"
  );
});

test("normalized Alpha Arcade staking rows attach stake enter and unstake/claim exits", () => {
  const record = normalizeAlphaArcadeStakingOpportunity({
    snapshot: alphaArcadePoolSnapshot(),
    alphaUsdPrice: ALPHA_ARCADE_ALPHA_USD_PRICE,
    usdcInflowsMicro: 400_000_000n,
    windowDays: ALPHA_ARCADE_WINDOW_DAYS,
    fetchedAtIso: ALPHA_ARCADE_FIXTURE_FETCHED_AT
  });
  assertValidMarketRecord(record);
  const publicRecord = attachExecutionShapesToOpportunity(record);
  assertValidPublicOpportunity(publicRecord);
  assert.equal(publicRecord.executionReady, true);
  assert.equal(publicRecord.opportunityId, ALPHA_ARCADE_STAKING_OPPORTUNITY_ID);
  assert.ok(
    publicRecord.executionShapes.some(
      (shape) => shape.shapeKey === "mainnet:alpha-arcade:v1:stake:alpha"
    )
  );
  assert.ok(
    publicRecord.compatibleExitShapes.some(
      (shape) => shape.shapeKey === "mainnet:alpha-arcade:v1:unstake:alpha"
    )
  );
  assert.ok(
    publicRecord.compatibleExitShapes.some(
      (shape) => shape.shapeKey === "mainnet:alpha-arcade:v1:claimRewards:usdc"
    )
  );
});
