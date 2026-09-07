import assert from "node:assert/strict";
import test from "node:test";

import {
  allocateTierTvlUsd,
  fetchStammOpportunities,
  normalizeStammLpOpportunity,
  normalizeStammPoolTiers,
  setStammAdapterDependenciesForTests,
  stammLpOpportunityId,
  STAMM_UNKNOWN_APY_NOTE,
  StammAdapterError
} from "../../src/adapters/index.js";
import { SOURCE_TIMESTAMP_FETCH_PROXY_NOTE } from "../../src/services/source-metadata.js";
import {
  STAMM_FIXTURE_FETCHED_AT,
  STAMM_FIXTURE_HOG_ASSET_ID,
  STAMM_FIXTURE_POOL_APP_ID,
  STAMM_FIXTURE_RESERVE_A_MICRO,
  STAMM_FIXTURE_TIER1_LP_ASSET_ID,
  STAMM_FIXTURE_TIER1_RESERVE_A,
  STAMM_FIXTURE_TVL_USD_MICRO,
  stammAlgoHogPool,
  stammAssetsFixture,
  stammDropTiersPool
} from "../fixtures/adapters/stamm.js";
import { assertValidMarketRecord } from "./helpers/assert-market-record.js";

test.afterEach(() => {
  setStammAdapterDependenciesForTests();
});

test("stammLpOpportunityId matches HOGSWAP position opportunityId", () => {
  assert.equal(
    stammLpOpportunityId(STAMM_FIXTURE_POOL_APP_ID, 1),
    `${STAMM_FIXTURE_POOL_APP_ID}:lp:1`
  );
});

test("allocateTierTvlUsd uses reserve share and drops empty or missing TVL", () => {
  const poolTvlUsd = STAMM_FIXTURE_TVL_USD_MICRO / 1_000_000;
  const allocated = allocateTierTvlUsd({
    poolTvlUsd,
    poolReserveA: STAMM_FIXTURE_RESERVE_A_MICRO,
    poolReserveB: 25_974_340_595n,
    tierReserveA: STAMM_FIXTURE_TIER1_RESERVE_A,
    tierReserveB: 19_347_221_619n
  });
  assert.ok(allocated !== null);
  assert.ok(Math.abs((allocated ?? 0) - poolTvlUsd * (Number(STAMM_FIXTURE_TIER1_RESERVE_A) / Number(STAMM_FIXTURE_RESERVE_A_MICRO))) < 1e-9);

  assert.equal(
    allocateTierTvlUsd({
      poolTvlUsd: null,
      poolReserveA: 1n,
      poolReserveB: 1n,
      tierReserveA: 1n,
      tierReserveB: 1n
    }),
    null
  );
  assert.equal(
    allocateTierTvlUsd({
      poolTvlUsd: 100,
      poolReserveA: 1n,
      poolReserveB: 1n,
      tierReserveA: 0n,
      tierReserveB: 0n
    }),
    null
  );
});

test("normalizeStammPoolTiers emits one LP row per active tier with TVL and no invented APY", () => {
  const records = normalizeStammPoolTiers(
    stammAlgoHogPool,
    stammAssetsFixture,
    STAMM_FIXTURE_FETCHED_AT
  );
  assert.equal(records.length, 6);
  for (const record of records) {
    assertValidMarketRecord(record);
    assert.equal(record.protocol, "stamm");
    assert.equal(record.opportunityType, "lp");
    assert.equal(record.assetPair, "ALGO/HOG");
    assert.deepEqual(record.assetIds, [0, STAMM_FIXTURE_HOG_ASSET_ID]);
    assert.equal(record.apy, 0);
    assert.equal(record.yieldBasis, "apr");
    assert.equal(record.apr, undefined);
    assert.equal(record.poolAppId, STAMM_FIXTURE_POOL_APP_ID);
    assert.ok((record.tvlUsd ?? 0) > 0);
    assert.match(record.notes ?? "", new RegExp(SOURCE_TIMESTAMP_FETCH_PROXY_NOTE));
    assert.ok((record.notes ?? "").includes(STAMM_UNKNOWN_APY_NOTE));
  }

  const tier1 = records.find((row) => row.opportunityId === `${STAMM_FIXTURE_POOL_APP_ID}:lp:1`);
  assertValidMarketRecord(tier1 ?? null);
  assert.equal(tier1?.liquidityAssetId, STAMM_FIXTURE_TIER1_LP_ASSET_ID);
  assert.match(tier1?.notes ?? "", /fee 10 bps/);
  assert.match(tier1?.notes ?? "", new RegExp(`lp_asset_id ${STAMM_FIXTURE_TIER1_LP_ASSET_ID}`));
});

test("normalizeStammPoolTiers drops inactive tiers, missing LP ASA, and non-positive TVL", () => {
  const records = normalizeStammPoolTiers(
    stammDropTiersPool,
    stammAssetsFixture,
    STAMM_FIXTURE_FETCHED_AT
  );
  assert.deepEqual(records, []);
});

test("normalizeStammLpOpportunity drops non-positive TVL and out-of-range tiers", () => {
  const base = {
    poolId: STAMM_FIXTURE_POOL_APP_ID,
    assetA: 0,
    assetB: STAMM_FIXTURE_HOG_ASSET_ID,
    lpAssetId: STAMM_FIXTURE_TIER1_LP_ASSET_ID,
    tierIndex: 1,
    feeBps: 10,
    tvlUsd: 100,
    assetPair: "ALGO/HOG"
  };
  assert.equal(normalizeStammLpOpportunity({ ...base, tvlUsd: 0 }), null);
  assert.equal(normalizeStammLpOpportunity({ ...base, tierIndex: 6 }), null);
});

test("fetchStammOpportunities maps mocked HOGSWAP pools into per-tier rows", async () => {
  setStammAdapterDependenciesForTests({
    fetchPools: async () => [stammAlgoHogPool],
    fetchAssets: async () => stammAssetsFixture
  });
  const records = await fetchStammOpportunities();
  assert.equal(records.length, 6);
  assertValidMarketRecord(records[1] ?? null);
  assert.equal(records[1]?.opportunityId, `${STAMM_FIXTURE_POOL_APP_ID}:lp:1`);
});

test("fetchStammOpportunities continues when asset metadata fails", async () => {
  setStammAdapterDependenciesForTests({
    fetchPools: async () => [stammAlgoHogPool],
    fetchAssets: async () => {
      throw new Error("assets unavailable");
    }
  });
  const records = await fetchStammOpportunities();
  assert.equal(records.length, 6);
  assert.equal(records[0]?.assetPair, "ALGO/ASSET-3178895177");
});

test("fetchStammOpportunities wraps upstream failures", async () => {
  setStammAdapterDependenciesForTests({
    fetchPools: async () => {
      throw new Error("pools down");
    }
  });
  await assert.rejects(fetchStammOpportunities(), StammAdapterError);
});
