import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeCompxLendingOpportunity,
  normalizeCompxStakingOpportunity
} from "../../src/adapters/index.js";
import { SOURCE_TIMESTAMP_FETCH_PROXY_NOTE } from "../../src/services/source-metadata.js";
import {
  COMPX_FETCHED_AT,
  COMPX_LENDING_MARKET_APP_ID,
  COMPX_LST_TOKEN_ID,
  COMPX_STAKING_POOL_APP_ID,
  COMPX_USDC_ASSET_ID,
  algoAssetInfo,
  compxStakingPool,
  compxUsdcLendingMarket,
  usdcAssetInfo
} from "../fixtures/adapters/compx-sdk.js";
import { assertValidMarketRecord } from "./helpers/assert-market-record.js";

test("normalizeCompxLendingOpportunity maps recorded SDK APY, borrow cost, and TVL", () => {
  const record = normalizeCompxLendingOpportunity({
    market: compxUsdcLendingMarket(),
    assetById: new Map([[COMPX_USDC_ASSET_ID, usdcAssetInfo()]]),
    fetchedAtIso: COMPX_FETCHED_AT
  });
  assertValidMarketRecord(record);
  assert.equal(record.protocol, "compx");
  assert.equal(record.opportunityType, "lending");
  assert.equal(record.opportunityId, `compx-lending-${COMPX_LENDING_MARKET_APP_ID}`);
  assert.equal(record.assetPair, "USDC");
  assert.deepEqual(record.assetIds, [COMPX_USDC_ASSET_ID, COMPX_LST_TOKEN_ID]);
  assert.equal(record.apy, 4.25);
  assert.equal(record.yieldBasis, "apr");
  assert.equal(record.apr, 4.25);
  assert.equal(record.borrowApr, 8.5);
  assert.equal(record.tvlUsd, 1_250_000);
  assert.equal(record.sourceTimestamp, "2023-11-14T22:13:20.000Z");
  assert.equal(record.fetchedAt, COMPX_FETCHED_AT);
  assert.match(record.notes ?? "", /CompX lending market 123456/);
  assert.match(record.notes ?? "", /ltv=75\.0%/);
  assert.match(record.notes ?? "", /liqThreshold=85\.0%/);
  assert.match(record.notes ?? "", /borrowApr is the borrow cost/);
  assert.doesNotMatch(record.notes ?? "", new RegExp(SOURCE_TIMESTAMP_FETCH_PROXY_NOTE));
});

test("normalizeCompxLendingOpportunity drops invalid APY or non-positive TVL", () => {
  assert.equal(
    normalizeCompxLendingOpportunity({
      market: compxUsdcLendingMarket({ supplyApy: Number.NaN }),
      assetById: new Map(),
      fetchedAtIso: COMPX_FETCHED_AT
    }),
    null
  );
  assert.equal(
    normalizeCompxLendingOpportunity({
      market: compxUsdcLendingMarket({ totalDepositsUSD: 0 }),
      assetById: new Map(),
      fetchedAtIso: COMPX_FETCHED_AT
    }),
    null
  );
});

test("normalizeCompxLendingOpportunity falls back to asset id when metadata is missing", () => {
  const record = normalizeCompxLendingOpportunity({
    market: compxUsdcLendingMarket(),
    assetById: new Map(),
    fetchedAtIso: COMPX_FETCHED_AT
  });
  assertValidMarketRecord(record);
  assert.equal(record.assetPair, `ASSET-${COMPX_USDC_ASSET_ID}`);
});

test("normalizeCompxStakingOpportunity maps APR and computed TVL from recorded pool state", () => {
  const record = normalizeCompxStakingOpportunity({
    pool: compxStakingPool(),
    apr: 12.5,
    stakedAsset: algoAssetInfo(),
    rewardAsset: usdcAssetInfo(),
    stakedAssetPriceUsd: 0.2,
    stakedDecimals: 6,
    fetchedAtIso: COMPX_FETCHED_AT
  });
  assertValidMarketRecord(record);
  assert.equal(record.protocol, "compx");
  assert.equal(record.opportunityType, "staking");
  assert.equal(record.opportunityId, `compx-staking-${COMPX_STAKING_POOL_APP_ID}`);
  assert.equal(record.assetPair, "ALGO/USDC");
  assert.deepEqual(record.assetIds, [0, COMPX_USDC_ASSET_ID]);
  assert.equal(record.apy, 12.5);
  assert.equal(record.yieldBasis, "apr");
  assert.equal(record.apr, 12.5);
  assert.equal(record.tvlUsd, 2000);
  assert.equal(record.sourceTimestamp, new Date(1_750_000_000 * 1000).toISOString());
  assert.match(record.notes ?? "", /rewardsRemaining=1000000/);
});

test("normalizeCompxStakingOpportunity uses a single symbol when stake and reward assets match", () => {
  const record = normalizeCompxStakingOpportunity({
    pool: compxStakingPool({ stakedAssetId: COMPX_USDC_ASSET_ID }),
    apr: 5,
    stakedAsset: usdcAssetInfo(),
    rewardAsset: usdcAssetInfo(),
    stakedAssetPriceUsd: 1,
    stakedDecimals: 6,
    fetchedAtIso: COMPX_FETCHED_AT
  });
  assertValidMarketRecord(record);
  assert.equal(record.assetPair, "USDC");
});

test("normalizeCompxStakingOpportunity uses on-chain decimals for TVL math", () => {
  const record = normalizeCompxStakingOpportunity({
    pool: compxStakingPool({
      appId: 556,
      stakedAssetId: 1_058_926_737,
      totalStaked: 1_000_000_000n
    }),
    apr: 10,
    stakedAsset: {
      id: 1_058_926_737,
      name: "CompX",
      unitName: "COMPX",
      decimals: 8,
      total: 0n,
      frozen: false,
      creator: "CREATOR"
    },
    rewardAsset: usdcAssetInfo(),
    stakedAssetPriceUsd: 0.5,
    stakedDecimals: 8,
    fetchedAtIso: COMPX_FETCHED_AT
  });
  assertValidMarketRecord(record);
  // 1e9 / 1e8 * 0.5 = 5
  assert.equal(record.tvlUsd, 5);
});

test("normalizeCompxStakingOpportunity drops rows when APR or TVL cannot be computed", () => {
  assert.equal(
    normalizeCompxStakingOpportunity({
      pool: compxStakingPool(),
      apr: null,
      stakedAsset: undefined,
      rewardAsset: undefined,
      stakedAssetPriceUsd: undefined,
      stakedDecimals: 6,
      fetchedAtIso: COMPX_FETCHED_AT
    }),
    null
  );
  assert.equal(
    normalizeCompxStakingOpportunity({
      pool: compxStakingPool(),
      apr: 12.5,
      stakedAsset: algoAssetInfo(),
      rewardAsset: usdcAssetInfo(),
      stakedAssetPriceUsd: undefined,
      stakedDecimals: 6,
      fetchedAtIso: COMPX_FETCHED_AT
    }),
    null
  );
  assert.equal(
    normalizeCompxStakingOpportunity({
      pool: compxStakingPool(),
      apr: 0,
      stakedAsset: algoAssetInfo(),
      rewardAsset: usdcAssetInfo(),
      stakedAssetPriceUsd: 0.2,
      stakedDecimals: 6,
      fetchedAtIso: COMPX_FETCHED_AT
    }),
    null
  );
});
