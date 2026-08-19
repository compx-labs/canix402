import type { AssetInfo, MarketData, StakingPoolState } from "@compx/sdk";

import { USDC_ASSET_ID } from "../../../src/execution/shapes/haystack/constants.js";

export const COMPX_FETCHED_AT = "2026-07-01T12:00:00.000Z";
export const COMPX_USDC_ASSET_ID = USDC_ASSET_ID;
export const COMPX_LENDING_MARKET_APP_ID = 123_456;
export const COMPX_LST_TOKEN_ID = 987_654;
export const COMPX_STAKING_POOL_APP_ID = 555;

export function usdcAssetInfo(): AssetInfo {
  return {
    id: COMPX_USDC_ASSET_ID,
    name: "USD Coin",
    unitName: "USDC",
    decimals: 6,
    total: 0n,
    frozen: false,
    creator: "CREATOR"
  };
}

export function algoAssetInfo(): AssetInfo {
  return {
    id: 0,
    name: "ALGO",
    unitName: "ALGO",
    decimals: 6,
    total: 0n,
    frozen: false,
    creator: ""
  };
}

function rateModel(): MarketData["rateModel"] {
  return {
    baseBps: 200,
    utilCapBps: 8000,
    kinkNormBps: 5000,
    slope1Bps: 1000,
    slope2Bps: 2000,
    maxAprBps: 8000,
    rateModelType: 0
  };
}

/** Recorded CompX lending market snapshot (SDK MarketData shape). */
export function compxUsdcLendingMarket(
  overrides: Partial<MarketData> = {}
): MarketData {
  return {
    appId: COMPX_LENDING_MARKET_APP_ID,
    baseTokenId: COMPX_USDC_ASSET_ID,
    lstTokenId: COMPX_LST_TOKEN_ID,
    oracleAppId: 3_307_588_794,
    buyoutTokenId: 0,
    supplyApy: 4.25,
    borrowApy: 8.5,
    utilizationRate: 55.2,
    totalDeposits: 1000,
    totalBorrows: 550,
    availableToBorrow: 250,
    circulatingLST: 900,
    baseTokenPrice: 1,
    totalDepositsUSD: 1_250_000,
    totalBorrowsUSD: 550_000,
    availableToBorrowUSD: 250_000,
    ltv: 7500,
    liquidationThreshold: 8500,
    liqBonusBps: 750,
    originationFeeBps: 0,
    baseTokenDecimals: 6,
    lstTokenDecimals: 6,
    rateModel: rateModel(),
    contractState: 1,
    protocolShareBps: 1000,
    borrowIndexWad: 1_000_000_000_000_000_000n,
    lastUpdateTimestamp: 1_700_000_000,
    ...overrides
  };
}

export function compxStakingPool(
  overrides: Partial<StakingPoolState> = {}
): StakingPoolState {
  return {
    appId: COMPX_STAKING_POOL_APP_ID,
    stakedAssetId: 0,
    rewardAssetId: COMPX_USDC_ASSET_ID,
    totalStaked: 10_000_000_000n,
    rewardPerToken: 0n,
    startTime: 1_700_000_000,
    endTime: 1_800_000_000,
    lastUpdateTime: 1_750_000_000,
    totalRewards: 1_000_000n,
    accruedRewards: 0n,
    rewardsPaid: 0n,
    rewardsRemaining: 1_000_000n,
    initialized: true,
    rewardsFunded: true,
    adminAddress: "ADMIN",
    numStakers: 10,
    contractState: 1,
    masterRepoAppId: 3_475_071_555,
    platformFeeBps: 100,
    ...overrides
  };
}
