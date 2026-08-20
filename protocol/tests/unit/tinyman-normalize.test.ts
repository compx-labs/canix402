import assert from "node:assert/strict";
import test from "node:test";

import {
  TINYMAN_DEFAULT_EXTRA_POOL_ADDRESSES,
  TINYMAN_LIQUID_STAKE_PROTOCOL_FEE,
  TINYMAN_STALGO_STAKING_OPPORTUNITY_ID,
  TINYMAN_TALGO_STAKING_OPPORTUNITY_ID,
  normalizeTinymanFarm,
  normalizeTinymanPool,
  normalizeTinymanStAlgoStakingOpportunity,
  normalizeTinymanTAlgoStakingOpportunity,
  parseTinymanPoolDetail,
  resolveExtraPoolAddresses
} from "../../src/adapters/index.js";
import { USDC_ASSET_ID } from "../../src/execution/shapes/haystack/constants.js";
import { SOURCE_TIMESTAMP_FETCH_PROXY_NOTE } from "../../src/services/source-metadata.js";
import {
  TINYMAN_FIXTURE_FETCHED_AT,
  tinymanAlgoUsdcWithFarm,
  tinymanCompxAlgoPool,
  tinymanFarmAprOnly,
  tinymanMissingApy,
  tinymanMissingIdentifiers,
  tinymanMissingTvl,
  tinymanNoFarmIncentives,
  tinymanTotalYieldFallback
} from "../fixtures/adapters/tinyman-pools.js";
import { assertValidMarketRecord } from "./helpers/assert-market-record.js";

test("normalizeTinymanPool maps recorded analytics pool APY/TVL into percentage points", () => {
  const record = normalizeTinymanPool(tinymanCompxAlgoPool, TINYMAN_FIXTURE_FETCHED_AT);
  assertValidMarketRecord(record);
  assert.equal(record.protocol, "tinyman");
  assert.equal(record.opportunityType, "lp");
  assert.equal(
    record.opportunityId,
    `${TINYMAN_DEFAULT_EXTRA_POOL_ADDRESSES[0]}:lp`
  );
  assert.equal(record.assetPair, "COMPX/ALGO");
  assert.deepEqual(record.assetIds, [1732165149, 0]);
  assert.ok(Math.abs(record.apy - 23.6666) < 0.0001);
  assert.equal(record.yieldBasis, "apy");
  assert.equal(record.tvlUsd, 518.317639900972);
  assert.ok(record.apr !== undefined);
  assert.ok(Math.abs((record.apr ?? 0) - 21.2481) < 0.0001);
  assert.equal(record.fetchedAt, TINYMAN_FIXTURE_FETCHED_AT);
  assert.equal(record.sourceTimestamp, TINYMAN_FIXTURE_FETCHED_AT);
  assert.match(record.notes ?? "", new RegExp(SOURCE_TIMESTAMP_FETCH_PROXY_NOTE));
});

test("normalizeTinymanPool falls back to total_annual_percentage_yield", () => {
  const record = normalizeTinymanPool(tinymanTotalYieldFallback, TINYMAN_FIXTURE_FETCHED_AT);
  assertValidMarketRecord(record);
  assert.equal(record.apy, 11);
  assert.equal(record.apr, 9);
});

test("normalizeTinymanPool drops rows missing APY or TVL", () => {
  assert.equal(normalizeTinymanPool(tinymanMissingApy), null);
  assert.equal(normalizeTinymanPool(tinymanMissingTvl), null);
});

test("normalizeTinymanPool uses fallback identifiers when address and pair are missing", () => {
  const record = normalizeTinymanPool(tinymanMissingIdentifiers, TINYMAN_FIXTURE_FETCHED_AT);
  assertValidMarketRecord(record);
  assert.equal(record.opportunityId, "tinyman-unknown:lp");
  assert.equal(record.assetPair, "unknown/unknown");
  assert.match(record.notes ?? "", /fallback identifiers/);
});

test("normalizeTinymanFarm emits a separate farm row from staking yield fields", () => {
  const record = normalizeTinymanFarm(tinymanAlgoUsdcWithFarm, TINYMAN_FIXTURE_FETCHED_AT);
  assertValidMarketRecord(record);
  assert.equal(record.protocol, "tinyman");
  assert.equal(record.opportunityType, "farm");
  assert.equal(record.opportunityId, `${tinymanAlgoUsdcWithFarm.address}:farm`);
  assert.equal(record.assetPair, "ALGO/USDC");
  assert.deepEqual(record.assetIds, [0, USDC_ASSET_ID]);
  assert.equal(record.apy, 8.1);
  assert.equal(record.yieldBasis, "apy");
  assert.equal(record.apr, 7.9);
  assert.equal(record.tvlUsd, 15000);
});

test("normalizeTinymanFarm uses staking APR when APY is absent", () => {
  const record = normalizeTinymanFarm(tinymanFarmAprOnly, TINYMAN_FIXTURE_FETCHED_AT);
  assertValidMarketRecord(record);
  assert.equal(record.apy, 0);
  assert.equal(record.apr, 4);
});

test("normalizeTinymanFarm drops pools without farm incentives", () => {
  assert.equal(normalizeTinymanFarm(tinymanNoFarmIncentives, TINYMAN_FIXTURE_FETCHED_AT), null);
  assert.equal(normalizeTinymanFarm(tinymanCompxAlgoPool, TINYMAN_FIXTURE_FETCHED_AT), null);
});

test("normalizeTinymanTAlgoStakingOpportunity applies the 8% protocol fee", () => {
  const record = normalizeTinymanTAlgoStakingOpportunity({
    consensusApr: 10,
    circulatingSupply: 1_000_000_000_000n,
    algoToTAlgoRatio: 1.05,
    algoUsdPrice: 0.2,
    sampleSize: 16,
    fetchedAtIso: TINYMAN_FIXTURE_FETCHED_AT
  });
  assertValidMarketRecord(record);
  assert.equal(record.opportunityType, "staking");
  assert.equal(record.opportunityId, TINYMAN_TALGO_STAKING_OPPORTUNITY_ID);
  assert.equal(record.assetPair, "ALGO/tALGO");
  assert.equal(record.apr, 10);
  assert.equal(record.apy, 10 * (1 - TINYMAN_LIQUID_STAKE_PROTOCOL_FEE));
  assert.equal(record.yieldBasis, "apy");
  assert.equal(record.tvlUsd, 210_000);
  assert.ok(record.notes?.includes("8%"));
});

test("normalizeTinymanTAlgoStakingOpportunity drops invalid inputs", () => {
  assert.equal(
    normalizeTinymanTAlgoStakingOpportunity({
      consensusApr: 10,
      circulatingSupply: 0n,
      algoToTAlgoRatio: 1,
      algoUsdPrice: 0.2,
      sampleSize: 1,
      fetchedAtIso: TINYMAN_FIXTURE_FETCHED_AT
    }),
    null
  );
  assert.equal(
    normalizeTinymanTAlgoStakingOpportunity({
      consensusApr: 10,
      circulatingSupply: 1n,
      algoToTAlgoRatio: 1,
      algoUsdPrice: null,
      sampleSize: 1,
      fetchedAtIso: TINYMAN_FIXTURE_FETCHED_AT
    }),
    null
  );
});

test("normalizeTinymanStAlgoStakingOpportunity derives TINY emission APR", () => {
  const record = normalizeTinymanStAlgoStakingOpportunity({
    totalStakedAmount: 1_000_000_000_000n,
    currentRewardRatePerTime: 1_000_000n,
    algoToTAlgoRatio: 1,
    algoUsdPrice: 0.2,
    tinyUsdPrice: 0.01,
    fetchedAtIso: TINYMAN_FIXTURE_FETCHED_AT
  });
  assertValidMarketRecord(record);
  assert.equal(record.opportunityId, TINYMAN_STALGO_STAKING_OPPORTUNITY_ID);
  assert.equal(record.assetPair, "tALGO/stALGO");
  assert.equal(record.yieldBasis, "apr");
  assert.equal(record.tvlUsd, 200_000);
  assert.ok(record.apr !== undefined);
  assert.ok(Math.abs((record.apr ?? 0) - 157.788) < 0.001);
  assert.equal(record.apy, record.apr);
});

test("parseTinymanPoolDetail accepts detail objects and rejects list payloads", () => {
  assert.equal(
    parseTinymanPoolDetail(tinymanCompxAlgoPool)?.address,
    TINYMAN_DEFAULT_EXTRA_POOL_ADDRESSES[0]
  );
  assert.equal(parseTinymanPoolDetail({ results: [tinymanCompxAlgoPool] }), null);
  assert.equal(parseTinymanPoolDetail({ is_verified: true }), null);
  assert.equal(parseTinymanPoolDetail(null), null);
});

test("resolveExtraPoolAddresses unions defaults with valid env addresses", () => {
  const addresses = resolveExtraPoolAddresses(
    ` ${TINYMAN_DEFAULT_EXTRA_POOL_ADDRESSES[0]}, not-an-address `
  );
  assert.deepEqual(addresses, [TINYMAN_DEFAULT_EXTRA_POOL_ADDRESSES[0]]);
  assert.ok(
    resolveExtraPoolAddresses(undefined).includes(TINYMAN_DEFAULT_EXTRA_POOL_ADDRESSES[0])
  );
});
