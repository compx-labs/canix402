import assert from "node:assert/strict";
import test from "node:test";
import type { MarketData, StakingPoolState } from "@compx/sdk";

import { setCompXSdkDependenciesForTests } from "../../src/adapters/index.js";
import {
  setCompXLendingMarketStateDependenciesForTests,
  setCompXStakingPoolStateDependenciesForTests
} from "../../src/execution/shapes/compx/index.js";
import { setAssetDecimalsDependenciesForTests } from "../../src/services/asset-decimals.js";
import {
  collectCompXPositions,
  setCompXPositionCollectorDependenciesForTests
} from "../../src/services/protocol-positions.js";
import {
  emptyWalletSnapshot,
  type WalletSnapshot
} from "../../src/services/wallet-snapshot.js";

const ADDRESS =
  "RS7TLLQRXKBAQDAVTSZC2ZLMVMLNSCL3FOUOESJJZ5XSKFFL56UI6X33CI";
const MARKET_APP_ID = 3491050310;
const POOL_APP_ID = 3500000001;
const USDC_ID = 31566704;
const LST_ID = 3491050311;
const STAKED_ID = 31566704;
const REWARD_ID = 31566704;

test.afterEach(() => {
  setCompXSdkDependenciesForTests(undefined);
  setCompXLendingMarketStateDependenciesForTests(undefined);
  setCompXStakingPoolStateDependenciesForTests(undefined);
  setCompXPositionCollectorDependenciesForTests(undefined);
  setAssetDecimalsDependenciesForTests(undefined);
});

test("CompX collector never emits lending debt positions", async () => {
  setAssetDecimalsDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    getAssetById: async () => ({ params: { decimals: 6 } })
  });
  setCompXSdkDependenciesForTests({
    getAllMarketsFn: async () => [marketData()],
    getAllPoolsFn: async () => [],
    getAssetsInfoFn: async () => [
      {
        id: USDC_ID,
        name: "USDC",
        unitName: "USDC",
        decimals: 6,
        total: 0n,
        frozen: false
      }
    ],
    getPoolAprFn: async () => null,
    getTokenPricesFn: async () => ({})
  });
  setCompXLendingMarketStateDependenciesForTests({
    getMarket: async () => marketData()
  });

  const result = await collectCompXPositions(
    ADDRESS,
    walletSnapshot([{ assetId: LST_ID, amount: 1_000_000n }])
  );

  assert.equal(
    result.positions.some((position) => position.positionType === "debt"),
    false
  );
  assert.equal(
    result.warnings.some((warning) => warning.includes(":debt:")),
    false
  );
  assert.equal(result.coverage?.borrowedUsdComplete, true);
  assert.ok(
    result.positions.some((position) => position.positionType === "supplied")
  );
});

test("CompX collector emits pending staking rewards from rewardPerToken and rewardDebt", async () => {
  setAssetDecimalsDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    getAssetById: async () => ({ params: { decimals: 6 } })
  });
  setCompXSdkDependenciesForTests({
    getAllMarketsFn: async () => [],
    getAllPoolsFn: async () => [stakingPool()],
    getAssetsInfoFn: async () => [
      {
        id: STAKED_ID,
        name: "USDC",
        unitName: "USDC",
        decimals: 6,
        total: 0n,
        frozen: false
      }
    ],
    getPoolAprFn: async () => 10,
    getTokenPricesFn: async () => ({
      [String(REWARD_ID)]: 1
    })
  });
  // stake=2e6, rewardPerToken=2e15, rewardDebt=1e6
  // accrued = 2e6 * 2e15 / 1e15 = 4e6; pending = 4e6 - 1e6 = 3e6
  setCompXStakingPoolStateDependenciesForTests({
    getPool: async () => stakingPool({ rewardPerToken: 2_000_000_000_000_000n }),
    getStakerInfo: async () => ({
      stake: 2_000_000n,
      rewardDebt: 1_000_000n
    }),
    nowSeconds: () => 1_700_000_000
  });

  const result = await collectCompXPositions(
    ADDRESS,
    walletSnapshot([{ assetId: STAKED_ID, amount: 5_000_000n }])
  );

  const reward = result.positions.find(
    (position) => position.positionType === "reward"
  );
  const staked = result.positions.find(
    (position) => position.positionType === "staked"
  );
  assert.ok(staked);
  assert.equal(staked.caveats, undefined);
  assert.ok(reward);
  assert.equal(reward.positionId, `compx:reward:${POOL_APP_ID}:${REWARD_ID}`);
  assert.equal(reward.amountRaw, "3000000");
  assert.equal(reward.amount, "3");
  assert.equal(reward.usdValue, 3);
  assert.equal(result.coverage?.rewardsUsdComplete, true);
  assert.equal(
    result.warnings.includes(
      "CompX pending staking rewards cannot be derived from the available staker state."
    ),
    false
  );
});

function marketData(): MarketData {
  return {
    appId: MARKET_APP_ID,
    baseTokenId: USDC_ID,
    lstTokenId: LST_ID,
    oracleAppId: 3307588794,
    buyoutTokenId: USDC_ID,
    supplyApy: 4.5,
    borrowApy: 6.2,
    utilizationRate: 35,
    totalDeposits: 1_000_000,
    totalBorrows: 350_000,
    availableToBorrow: 650_000,
    circulatingLST: 900_000,
    baseTokenPrice: 1,
    totalDepositsUSD: 1_000_000,
    totalBorrowsUSD: 350_000,
    availableToBorrowUSD: 650_000,
    ltv: 5000,
    liquidationThreshold: 5500,
    liqBonusBps: 500,
    originationFeeBps: 150,
    baseTokenDecimals: 6,
    lstTokenDecimals: 6,
    rateModel: {
      baseBps: 100,
      utilCapBps: 8000,
      kinkNormBps: 8000,
      slope1Bps: 600,
      slope2Bps: 1200,
      maxAprBps: 10000,
      rateModelType: 0
    },
    contractState: 1,
    protocolShareBps: 1000,
    borrowIndexWad: 1003201766370n,
    lastUpdateTimestamp: 1_783_450_230
  };
}

function stakingPool(overrides?: Partial<StakingPoolState>): StakingPoolState {
  return {
    appId: POOL_APP_ID,
    stakedAssetId: STAKED_ID,
    rewardAssetId: REWARD_ID,
    totalStaked: 10_000_000n,
    rewardPerToken: 0n,
    startTime: 1_600_000_000,
    endTime: 1_900_000_000,
    lastUpdateTime: 1_700_000_000,
    totalRewards: 1_000_000n,
    accruedRewards: 0n,
    rewardsPaid: 0n,
    rewardsRemaining: 1_000_000n,
    initialized: true,
    rewardsFunded: true,
    adminAddress: "ADMIN",
    numStakers: 10,
    contractState: 1,
    masterRepoAppId: 3475071555,
    platformFeeBps: 100,
    ...overrides
  };
}

function walletSnapshot(
  assets: WalletSnapshot["assets"]
): WalletSnapshot {
  return {
    ...emptyWalletSnapshot(ADDRESS),
    assets,
    accountInfo: {
      address: ADDRESS,
      amount: 0n,
      assets: assets.map((holding) => ({
        "asset-id": holding.assetId,
        amount: holding.amount
      })),
      "apps-local-state": []
    }
  };
}
