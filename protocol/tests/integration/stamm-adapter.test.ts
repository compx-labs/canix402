import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeStammLpOpportunity,
  setStammAdapterDependenciesForTests
} from "../../src/adapters/index.js";
import { attachExecutionShapesToOpportunity } from "../../src/services/opportunity-execution-shapes.js";
import { attachExecutionShapesToPosition } from "../../src/services/position-execution-shapes.js";
import { executionRegistry } from "../../src/execution/index.js";
import { buildApp } from "../../src/app.js";
import type { OpportunityMarketRecord } from "../../src/types/opportunity.js";
import {
  STAMM_FIXTURE_FETCHED_AT,
  STAMM_FIXTURE_HOG_ASSET_ID,
  STAMM_FIXTURE_POOL_APP_ID,
  STAMM_FIXTURE_TIER1_LP_ASSET_ID,
  stammAlgoHogPool,
  stammAssetsFixture
} from "../fixtures/adapters/stamm.js";

test.afterEach(() => {
  setStammAdapterDependenciesForTests();
});

test("STAMM LP opportunity attaches mint enter and redeem exit with TVL + asset ids", () => {
  const record = normalizeStammLpOpportunity(
    {
      poolId: STAMM_FIXTURE_POOL_APP_ID,
      assetA: 0,
      assetB: STAMM_FIXTURE_HOG_ASSET_ID,
      lpAssetId: STAMM_FIXTURE_TIER1_LP_ASSET_ID,
      tierIndex: 1,
      feeBps: 10,
      tvlUsd: 9_684.12,
      assetPair: "ALGO/HOG"
    },
    STAMM_FIXTURE_FETCHED_AT
  );
  assert.ok(record);
  const enriched = attachExecutionShapesToOpportunity(record as OpportunityMarketRecord, executionRegistry);
  assert.equal(enriched.executionReady, true);
  assert.equal(enriched.executionShapes.length, 1);
  assert.equal(enriched.executionShapes[0]?.shapeKey, "mainnet:stamm:v1:mint:lp");
  assert.deepEqual(enriched.executionShapes[0]?.requiredAssetIds, [0, STAMM_FIXTURE_HOG_ASSET_ID]);
  assert.equal(enriched.executionShapes[0]?.inputHints?.poolAppId, STAMM_FIXTURE_POOL_APP_ID);
  assert.equal(enriched.executionShapes[0]?.inputHints?.tierIndex, 1);
  assert.equal(
    enriched.executionShapes[0]?.inputHints?.liquidityAssetId,
    STAMM_FIXTURE_TIER1_LP_ASSET_ID
  );
  assert.equal("poolAppId" in enriched, false);
  assert.equal("liquidityAssetId" in enriched, false);
  assert.equal(enriched.compatibleExitShapes.length, 1);
  assert.equal(enriched.compatibleExitShapes[0]?.shapeKey, "mainnet:stamm:v1:redeem:lp");
  assert.deepEqual(enriched.compatibleExitShapes[0]?.requiredAssetIds, [
    STAMM_FIXTURE_TIER1_LP_ASSET_ID
  ]);
  assert.ok((enriched.tvlUsd ?? 0) > 0);
  assert.deepEqual(enriched.assetIds, [0, STAMM_FIXTURE_HOG_ASSET_ID]);
});

test("STAMM LP positions attach redeem via listForPosition", () => {
  const position = attachExecutionShapesToPosition({
    protocol: "stamm",
    positionType: "lp",
    positionId: `stamm:lp:${STAMM_FIXTURE_TIER1_LP_ASSET_ID}`,
    opportunityId: `${STAMM_FIXTURE_POOL_APP_ID}:lp:1`,
    assetId: STAMM_FIXTURE_TIER1_LP_ASSET_ID,
    assetSymbol: "ALGO/HOG LP",
    amountRaw: "1000000",
    amount: "1",
    usdValue: 0.3,
    inputHints: {
      poolAppId: STAMM_FIXTURE_POOL_APP_ID,
      tierIndex: 1,
      liquidityAssetId: STAMM_FIXTURE_TIER1_LP_ASSET_ID
    }
  });
  assert.deepEqual(position.compatibleExitShapeKeys, ["mainnet:stamm:v1:redeem:lp"]);
});

test("GET /protocols/stamm/opportunities emits per-tier LP rows from recorded pools", async () => {
  setStammAdapterDependenciesForTests({
    fetchPools: async () => [stammAlgoHogPool],
    fetchAssets: async () => stammAssetsFixture
  });
  const app = buildApp();
  await app.ready();
  try {
    const response = await app.inject({
      method: "GET",
      url: "/protocols/stamm/opportunities?limit=20&offset=0"
    });
    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      data: Array<{
        protocol: string;
        opportunityType: string;
        opportunityId: string;
        tvlUsd: number;
        assetIds?: number[];
        apy: number;
        executionShapes: Array<{ shapeKey: string }>;
        compatibleExitShapes: Array<{ shapeKey: string }>;
      }>;
    };
    assert.equal(body.data.length, 6);
    assert.ok(body.data.every((row) => row.protocol === "stamm" && row.opportunityType === "lp"));
    assert.ok(body.data.every((row) => row.tvlUsd > 0));
    assert.ok(body.data.every((row) => row.apy === 0));
    const tier1 = body.data.find(
      (row) => row.opportunityId === `${STAMM_FIXTURE_POOL_APP_ID}:lp:1`
    );
    assert.ok(tier1);
    assert.deepEqual(tier1?.assetIds, [0, STAMM_FIXTURE_HOG_ASSET_ID]);
    assert.ok(
      tier1?.executionShapes.some((shape) => shape.shapeKey === "mainnet:stamm:v1:mint:lp")
    );
    assert.ok(
      tier1?.compatibleExitShapes.some((shape) => shape.shapeKey === "mainnet:stamm:v1:redeem:lp")
    );
  } finally {
    await app.close();
  }
});
