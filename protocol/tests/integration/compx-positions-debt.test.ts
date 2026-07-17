import assert from "node:assert/strict";
import test from "node:test";
import type { MarketData, StakingPoolState, UserPosition } from "@compx/sdk";

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

test("CompX collector emits lending debt from getUserPosition.borrowed", async () => {
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
  setCompXPositionCollectorDependenciesForTests({
    getUserPosition: async () =>
      userPosition({
        borrowed: 2.5,
        healthFactor: 1.8,
        principal: 2_500_000n
      })
  });

  const result = await collectCompXPositions(
    ADDRESS,
    walletSnapshot([{ assetId: LST_ID, amount: 1_000_000n }])
  );

  const debt = result.positions.find(
    (position) => position.positionType === "debt"
  );
  assert.ok(debt);
  assert.equal(debt.positionId, `compx:debt:${MARKET_APP_ID}`);
  assert.equal(debt.amountRaw, "2500000");
  assert.equal(debt.amount, "2.5");
  assert.equal(debt.usdValue, 2.5);
  assert.equal(debt.healthFactor, 1.8);
  assert.equal(result.coverage?.borrowedUsdComplete, true);
  assert.equal(
    result.warnings.includes(
      "CompX per-user lending debt is not exposed by the installed SDK."
    ),
    false
  );
});

test("CompX collector marks borrowedUsdComplete false when getUserPosition fails", async () => {
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
  setCompXPositionCollectorDependenciesForTests({
    getUserPosition: async () => {
      throw new Error("box read failed");
    }
  });

  const result = await collectCompXPositions(
    ADDRESS,
    walletSnapshot([{ assetId: LST_ID, amount: 1_000_000n }])
  );

  assert.equal(result.coverage?.borrowedUsdComplete, false);
  assert.match(result.warnings.join("; "), /:debt: box read failed/);
});

test("CompX collector treats missing deposit/loan boxes as empty debt, not a failure", async () => {
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
  setCompXPositionCollectorDependenciesForTests({
    getUserPosition: async () => {
      const error = new Error(
        "Network request error. Received status 404 (Not Found): box not found"
      ) as Error & { status: number };
      error.status = 404;
      throw error;
    }
  });

  const result = await collectCompXPositions(
    ADDRESS,
    walletSnapshot([{ assetId: LST_ID, amount: 1_000_000n }])
  );

  assert.equal(result.coverage?.borrowedUsdComplete, true);
  assert.equal(
    result.positions.some((position) => position.positionType === "debt"),
    false
  );
  assert.equal(
    result.warnings.some((warning) => warning.includes(":debt:")),
    false
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
  setCompXPositionCollectorDependenciesForTests({
    getUserPosition: async () => userPosition()
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

function userPosition(overrides?: Partial<UserPosition>): UserPosition {
  return {
    address: ADDRESS,
    appId: MARKET_APP_ID,
    supplied: 0,
    lstBalance: 1,
    borrowed: 0,
    collateral: 0,
    collateralAssetId: LST_ID,
    userIndexWad: 0n,
    principal: 0n,
    lastDebtChange: 0,
    healthFactor: Infinity,
    maxBorrow: 0,
    isLiquidatable: false,
    ...overrides
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
