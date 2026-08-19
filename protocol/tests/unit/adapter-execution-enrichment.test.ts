import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeCompxLendingOpportunity,
  normalizeDorkFiOpportunity,
  normalizeFolksLendingOpportunity,
  normalizePactFarm,
  normalizePactPool,
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
