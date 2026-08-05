import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchCompXOpportunities,
  normalizeCompxLendingOpportunity,
  normalizeCompxStakingOpportunity,
  setCompXSdkDependenciesForTests
} from "../../src/adapters/index.js";
import { buildApp } from "../../src/app.js";
import { setAssetDecimalsDependenciesForTests } from "../../src/services/asset-decimals.js";

function mockOnChainAssetDecimals(): void {
  setAssetDecimalsDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    getAssetById: async () => ({ params: { decimals: 6 } })
  });
}

test("normalizeCompxLendingOpportunity maps APY and TVL fields from SDK values", () => {
  const record = normalizeCompxLendingOpportunity({
    market: {
      appId: 123456,
      baseTokenId: 31566704,
      lstTokenId: 987654,
      oracleAppId: 3307588794,
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
      rateModel: {
        baseBps: 200,
        utilCapBps: 8000,
        kinkNormBps: 5000,
        slope1Bps: 1000,
        slope2Bps: 2000,
        maxAprBps: 8000,
        rateModelType: 0
      },
      contractState: 1,
      protocolShareBps: 1000,
      borrowIndexWad: 1_000_000_000_000_000_000n,
      lastUpdateTimestamp: 1_700_000_000
    },
    assetById: new Map([
      [
        31566704,
        {
          id: 31566704,
          name: "USD Coin",
          unitName: "USDC",
          decimals: 6,
          total: 0n,
          frozen: false,
          creator: "CREATOR"
        }
      ]
    ]),
    fetchedAtIso: "2026-07-01T12:00:00.000Z"
  });

  assert.ok(record);
  assert.equal(record?.protocol, "compx");
  assert.equal(record?.opportunityType, "lending");
  assert.equal(record?.opportunityId, "compx-lending-123456");
  assert.equal(record?.assetPair, "USDC");
  assert.deepEqual(record?.assetIds, [31566704, 987654]);
  assert.equal(record?.apy, 4.25);
  assert.equal(record?.yieldBasis, "apr");
  assert.equal(record?.apr, 4.25);
  assert.equal(record?.borrowApr, 8.5);
  assert.equal(record?.tvlUsd, 1_250_000);
  assert.equal(record?.sourceTimestamp, "2023-11-14T22:13:20.000Z");
  assert.equal(record?.fetchedAt, "2026-07-01T12:00:00.000Z");
  assert.match(record?.notes ?? "", /CompX lending market 123456/);
  assert.match(record?.notes ?? "", /ltv=75\.0%/);
  assert.match(record?.notes ?? "", /borrowApr is the borrow cost/);
  assert.doesNotMatch(record?.notes ?? "", /sourceTimestamp equals fetchedAt/);
});

test("normalizeCompxLendingOpportunity drops rows when APY or TVL is invalid", () => {
  assert.equal(
    normalizeCompxLendingOpportunity({
      market: {
        appId: 1,
        baseTokenId: 0,
        lstTokenId: 2,
        oracleAppId: 0,
        buyoutTokenId: 0,
        supplyApy: Number.NaN,
        borrowApy: 0,
        utilizationRate: 0,
        totalDeposits: 0,
        totalBorrows: 0,
        availableToBorrow: 0,
        circulatingLST: 0,
        baseTokenPrice: 0,
        totalDepositsUSD: 100,
        totalBorrowsUSD: 0,
        availableToBorrowUSD: 0,
        ltv: 0,
        liquidationThreshold: 0,
        liqBonusBps: 0,
        originationFeeBps: 0,
        baseTokenDecimals: 6,
        lstTokenDecimals: 6,
        rateModel: {
          baseBps: 0,
          utilCapBps: 0,
          kinkNormBps: 0,
          slope1Bps: 0,
          slope2Bps: 0,
          maxAprBps: 0,
          rateModelType: 0
        },
        contractState: 1,
        protocolShareBps: 0,
        borrowIndexWad: 0n,
        lastUpdateTimestamp: 0
      },
      assetById: new Map(),
      fetchedAtIso: "2026-07-01T12:00:00.000Z"
    }),
    null
  );
});

test("normalizeCompxStakingOpportunity maps APR and computed TVL", () => {
  const record = normalizeCompxStakingOpportunity({
    pool: {
      appId: 555,
      stakedAssetId: 0,
      rewardAssetId: 31566704,
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
      masterRepoAppId: 3475071555,
      platformFeeBps: 100
    },
    apr: 12.5,
    stakedAsset: {
      id: 0,
      name: "Algorand",
      unitName: "ALGO",
      decimals: 6,
      total: 0n,
      frozen: false,
      creator: ""
    },
    rewardAsset: {
      id: 31566704,
      name: "USD Coin",
      unitName: "USDC",
      decimals: 6,
      total: 0n,
      frozen: false,
      creator: "CREATOR"
    },
    stakedAssetPriceUsd: 0.2,
    stakedDecimals: 6,
    fetchedAtIso: "2026-07-01T12:00:00.000Z"
  });

  assert.ok(record);
  assert.equal(record?.protocol, "compx");
  assert.equal(record?.opportunityType, "staking");
  assert.equal(record?.opportunityId, "compx-staking-555");
  assert.equal(record?.assetPair, "ALGO/USDC");
  assert.equal(record?.apy, 12.5);
  assert.equal(record?.yieldBasis, "apr");
  assert.equal(record?.apr, 12.5);
  assert.equal(record?.tvlUsd, 2000);
});

test("normalizeCompxStakingOpportunity drops rows when APR or TVL cannot be computed", () => {
  assert.equal(
    normalizeCompxStakingOpportunity({
      pool: {
        appId: 555,
        stakedAssetId: 0,
        rewardAssetId: 31566704,
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
        masterRepoAppId: 3475071555,
        platformFeeBps: 100
      },
      apr: null,
      stakedAsset: undefined,
      rewardAsset: undefined,
      stakedAssetPriceUsd: undefined,
      stakedDecimals: 6,
      fetchedAtIso: "2026-07-01T12:00:00.000Z"
    }),
    null
  );
});

test("normalizeCompxStakingOpportunity uses on-chain decimals for TVL math", () => {
  const record = normalizeCompxStakingOpportunity({
    pool: {
      appId: 556,
      stakedAssetId: 1058926737,
      rewardAssetId: 31566704,
      totalStaked: 1_000_000_000n,
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
      masterRepoAppId: 3475071555,
      platformFeeBps: 100
    },
    apr: 8,
    stakedAsset: undefined,
    rewardAsset: undefined,
    stakedAssetPriceUsd: 0.2,
    stakedDecimals: 8,
    fetchedAtIso: "2026-07-01T12:00:00.000Z"
  });

  assert.ok(record);
  assert.equal(record?.tvlUsd, 2);
});

test("fetchCompXOpportunities maps SDK responses and filters invalid rows", async () => {
  mockOnChainAssetDecimals();
  const pricingRequestedAssetIds: number[] = [];
  setCompXSdkDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    createSdk: () => ({ lending: {}, staking: {} }) as never,
    getAllMarketsFn: async () => [
      {
        appId: 100,
        baseTokenId: 31566704,
        lstTokenId: 200,
        oracleAppId: 3307588794,
        buyoutTokenId: 0,
        supplyApy: 3.5,
        borrowApy: 7.1,
        utilizationRate: 40,
        totalDeposits: 100,
        totalBorrows: 40,
        availableToBorrow: 50,
        circulatingLST: 90,
        baseTokenPrice: 1,
        totalDepositsUSD: 500_000,
        totalBorrowsUSD: 200_000,
        availableToBorrowUSD: 250_000,
        ltv: 7500,
        liquidationThreshold: 8500,
        liqBonusBps: 750,
        originationFeeBps: 0,
        baseTokenDecimals: 6,
        lstTokenDecimals: 6,
        rateModel: {
          baseBps: 200,
          utilCapBps: 8000,
          kinkNormBps: 5000,
          slope1Bps: 1000,
          slope2Bps: 2000,
          maxAprBps: 8000,
          rateModelType: 0
        },
        contractState: 1,
        protocolShareBps: 1000,
        borrowIndexWad: 1_000_000_000_000_000_000n,
        lastUpdateTimestamp: 1_700_000_000
      },
      {
        appId: 101,
        baseTokenId: 0,
        lstTokenId: 201,
        oracleAppId: 3307588794,
        buyoutTokenId: 0,
        supplyApy: 0,
        borrowApy: 0,
        utilizationRate: 0,
        totalDeposits: 0,
        totalBorrows: 0,
        availableToBorrow: 0,
        circulatingLST: 0,
        baseTokenPrice: 0,
        totalDepositsUSD: 0,
        totalBorrowsUSD: 0,
        availableToBorrowUSD: 0,
        ltv: 0,
        liquidationThreshold: 0,
        liqBonusBps: 0,
        originationFeeBps: 0,
        baseTokenDecimals: 6,
        lstTokenDecimals: 6,
        rateModel: {
          baseBps: 0,
          utilCapBps: 0,
          kinkNormBps: 0,
          slope1Bps: 0,
          slope2Bps: 0,
          maxAprBps: 0,
          rateModelType: 0
        },
        contractState: 1,
        protocolShareBps: 0,
        borrowIndexWad: 0n,
        lastUpdateTimestamp: 0
      }
    ],
    getAllPoolsFn: async () => [
      {
        appId: 300,
        stakedAssetId: 0,
        rewardAssetId: 0,
        totalStaked: 5_000_000_000n,
        rewardPerToken: 0n,
        startTime: 1_700_000_000,
        endTime: 1_900_000_000,
        lastUpdateTime: 1_750_000_000,
        totalRewards: 1_000_000n,
        accruedRewards: 0n,
        rewardsPaid: 0n,
        rewardsRemaining: 1_000_000n,
        initialized: true,
        rewardsFunded: true,
        adminAddress: "ADMIN",
        numStakers: 5,
        contractState: 1,
        masterRepoAppId: 3475071555,
        platformFeeBps: 100
      }
    ],
    getAssetsInfoFn: async () => [
      {
        id: 31566704,
        name: "USD Coin",
        unitName: "USDC",
        decimals: 6,
        total: 0n,
        frozen: false,
        creator: "CREATOR"
      },
      {
        id: 0,
        name: "Algorand",
        unitName: "ALGO",
        decimals: 6,
        total: 0n,
        frozen: false,
        creator: ""
      }
    ],
    getPoolAprFn: async (_appId) => 9.5,
    getTokenPricesFn: async (assetIds) => {
      pricingRequestedAssetIds.push(...assetIds);
      const prices: Record<string, number> = {};
      for (const assetId of assetIds) {
        prices[String(assetId)] = assetId === 0 ? 0.2 : 1;
      }
      return prices;
    }
  });

  try {
    const opportunities = await fetchCompXOpportunities();

    assert.equal(opportunities.length, 2);
    assert.equal(opportunities[0]?.protocol, "compx");
    assert.equal(opportunities.some((row) => row.opportunityType === "lending"), true);
    assert.equal(opportunities.some((row) => row.opportunityType === "staking"), true);
    assert.equal(
      opportunities.some((row) => row.opportunityId === "compx-lending-100"),
      true
    );
    assert.equal(
      opportunities.some((row) => row.opportunityId === "compx-staking-300"),
      true
    );
    assert.deepEqual(
      pricingRequestedAssetIds,
      [0],
      "only the staking pool's underlying ALGO assets are priced"
    );
  } finally {
    setCompXSdkDependenciesForTests(undefined);
    setAssetDecimalsDependenciesForTests(undefined);
  }
});

test("fetchCompXOpportunities shares an in-flight catalog request", async () => {
  let marketCalls = 0;
  let releaseMarkets: (() => void) | undefined;
  const marketsReady = new Promise<void>((resolve) => {
    releaseMarkets = resolve;
  });
  setCompXSdkDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    createSdk: () => ({ lending: {}, staking: {} }) as never,
    getAllMarketsFn: async () => {
      marketCalls += 1;
      await marketsReady;
      return [];
    },
    getAllPoolsFn: async () => [],
    getAssetsInfoFn: async () => [],
    getPoolAprFn: async () => null,
    getTokenPricesFn: async () => ({})
  });

  try {
    const first = fetchCompXOpportunities();
    const second = fetchCompXOpportunities();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(marketCalls, 1);
    releaseMarkets?.();
    const results = await Promise.allSettled([first, second]);
    assert.ok(results.every((result) => result.status === "rejected"));
  } finally {
    setCompXSdkDependenciesForTests(undefined);
  }
});

test("GET /protocols/compx/opportunities returns CompX normalized data", async () => {
  mockOnChainAssetDecimals();
  setCompXSdkDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    createSdk: () => ({ lending: {}, staking: {} }) as never,
    getAllMarketsFn: async () => [
      {
        appId: 777,
        baseTokenId: 31566704,
        lstTokenId: 888,
        oracleAppId: 3307588794,
        buyoutTokenId: 0,
        supplyApy: 5.1,
        borrowApy: 9.2,
        utilizationRate: 45,
        totalDeposits: 100,
        totalBorrows: 45,
        availableToBorrow: 50,
        circulatingLST: 90,
        baseTokenPrice: 1,
        totalDepositsUSD: 900_000,
        totalBorrowsUSD: 405_000,
        availableToBorrowUSD: 450_000,
        ltv: 7500,
        liquidationThreshold: 8500,
        liqBonusBps: 750,
        originationFeeBps: 0,
        baseTokenDecimals: 6,
        lstTokenDecimals: 6,
        rateModel: {
          baseBps: 200,
          utilCapBps: 8000,
          kinkNormBps: 5000,
          slope1Bps: 1000,
          slope2Bps: 2000,
          maxAprBps: 8000,
          rateModelType: 0
        },
        contractState: 1,
        protocolShareBps: 1000,
        borrowIndexWad: 1_000_000_000_000_000_000n,
        lastUpdateTimestamp: 1_700_000_000
      }
    ],
    getAllPoolsFn: async () => [],
    getAssetsInfoFn: async () => [
      {
        id: 31566704,
        name: "USD Coin",
        unitName: "USDC",
        decimals: 6,
        total: 0n,
        frozen: false,
        creator: "CREATOR"
      }
    ],
    getPoolAprFn: async () => null,
    getTokenPricesFn: async () => ({})
  });

  const app = buildApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: "GET",
      url: "/protocols/compx/opportunities?limit=10&offset=0"
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      data: Array<{ protocol: string; opportunityId: string; apy: number }>;
    };
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0]?.protocol, "compx");
    assert.equal(body.data[0]?.opportunityId, "compx-lending-777");
    assert.equal(body.data[0]?.apy, 5.1);
  } finally {
    await app.close();
    setCompXSdkDependenciesForTests(undefined);
    setAssetDecimalsDependenciesForTests(undefined);
  }
});
