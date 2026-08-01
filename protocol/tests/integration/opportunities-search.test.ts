import assert from "node:assert/strict";
import test from "node:test";

import { setFolksFinanceSdkDependenciesForTests } from "../../src/adapters/index.js";
import { buildApp } from "../../src/app.js";
import { setAssetDecimalsDependenciesForTests } from "../../src/services/asset-decimals.js";

test("filtered opportunities default to limit 25", async () => {
  const app = buildApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: "GET",
      url: "/opportunities/search?platform=compx"
    });
    const body = response.json() as { meta: { limit: number } };

    assert.equal(response.statusCode, 200);
    assert.equal(body.meta.limit, 25);
  } finally {
    await app.close();
  }
});

test("opportunities search applies platform, type, APY, and TVL filters", async () => {
  setAssetDecimalsDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    getAssetById: async () => ({ params: { decimals: 6 } })
  });
  setFolksFinanceSdkDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    getConsensusStateFn: async () => {
      throw new Error("consensus disabled in this test");
    },
    estimateConsensusApr: async () => {
      throw new Error("consensus APR disabled in this test");
    },
    retrievePoolManagerInfoFn: async () => ({
      adminAddress: "ADMIN",
      pools: {
        42: {
          variableBorrowInterestRate: 0n,
          variableBorrowInterestYield: 0n,
          variableBorrowInterestIndex: 0n,
          depositInterestRate: 400000000000000n,
          depositInterestYield: 850000000000000n,
          metadata: {
            oldVariableBorrowInterestIndex: 0n,
            oldDepositInterestIndex: 0n,
            oldTimestamp: 0n
          }
        },
        43: {
          variableBorrowInterestRate: 0n,
          variableBorrowInterestYield: 0n,
          variableBorrowInterestIndex: 0n,
          depositInterestRate: 400000000000000n,
          depositInterestYield: 1220000000000000n,
          metadata: {
            oldVariableBorrowInterestIndex: 0n,
            oldDepositInterestIndex: 0n,
            oldTimestamp: 0n
          }
        },
        44: {
          variableBorrowInterestRate: 0n,
          variableBorrowInterestYield: 0n,
          variableBorrowInterestIndex: 0n,
          depositInterestRate: 400000000000000n,
          depositInterestYield: 710000000000000n,
          metadata: {
            oldVariableBorrowInterestIndex: 0n,
            oldDepositInterestIndex: 0n,
            oldTimestamp: 0n
          }
        }
      }
    }),
    getOraclePricesFn: async () => ({
      prices: {
        // $1.00 for 6-decimal assets → 1 * 10^(14-6)
        10: { price: 100_000_000n, timestamp: 0n },
        11: { price: 100_000_000n, timestamp: 0n },
        12: { price: 100_000_000n, timestamp: 0n }
      }
    }),
    mainnetPools: {
      MATCH: {
        appId: 42,
        assetId: 10,
        fAssetId: 1,
        frAssetId: 2,
        assetDecimals: 6,
        poolManagerIndex: 0,
        loans: {}
      },
      TOO_HIGH: {
        appId: 43,
        assetId: 11,
        fAssetId: 3,
        frAssetId: 4,
        assetDecimals: 6,
        poolManagerIndex: 1,
        loans: {}
      },
      LOW_TVL: {
        appId: 44,
        assetId: 12,
        fAssetId: 5,
        frAssetId: 6,
        assetDecimals: 6,
        poolManagerIndex: 2,
        loans: {}
      }
    },
    retrievePoolInfoFn: async (_client, pool) => ({
      poolManagerAppId: 1,
      poolAdminAddress: "A",
      paramsAdminAddress: "B",
      configAdminAddress: "C",
      loansAdminAddress: "D",
      variableBorrow: {
        vr0: 0n,
        vr1: 0n,
        vr2: 0n,
        totalVariableBorrowAmount: 0n,
        variableBorrowInterestRate: 0n,
        variableBorrowInterestYield: 0n,
        variableBorrowInterestIndex: 0n
      },
      stableBorrow: {
        sr0: 0n,
        sr1: 0n,
        sr2: 0n,
        sr3: 0n,
        optimalStableToTotalDebtRatio: 0n,
        rebalanceUpUtilisationRatio: 0n,
        rebalanceUpDepositInterestRate: 0n,
        rebalanceDownDelta: 0n,
        totalStableBorrowAmount: 0n,
        stableBorrowInterestRate: 0n,
        stableBorrowInterestYield: 0n,
        overallStableBorrowInterestAmount: 0n
      },
      interest: {
        retentionRate: 0n,
        flashLoanFee: 0n,
        optimalUtilisationRatio: 0n,
        totalDeposits:
          pool.appId === 44 ? 50_000_000n : 250_000_000_000n,
        depositInterestRate: 0n,
        depositInterestYield: 0n,
        depositInterestIndex: 0n,
        latestUpdate: 0n
      },
      caps: {
        borrowCap: 0n,
        stableBorrowPercentageCap: 0n
      },
      config: {
        depreciated: false,
        rewardsPaused: false,
        stableBorrowSupported: false,
        flashLoanSupported: false
      }
    })
  });

  const app = buildApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: "GET",
      url: "/opportunities/search?platform=folks-finance&type=lending&minApy=5&maxApy=10&minTvlUsd=100000&limit=10&offset=0"
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      data: Array<{ opportunityId: string; protocol: string; opportunityType: string; apy: number }>;
      meta: { limit: number; offset: number; paymentRequired: boolean };
    };

    assert.equal(body.meta.limit, 10);
    assert.equal(body.meta.offset, 0);
    assert.equal(body.meta.paymentRequired, true);
    assert.deepEqual(
      body.data.map((row) => row.opportunityId),
      ["folks-lending-42"]
    );
    assert.equal(body.data[0]?.protocol, "folks-finance");
    assert.equal(body.data[0]?.opportunityType, "lending");
    assert.equal(body.data[0]?.apy, 8.5);
  } finally {
    await app.close();
    setFolksFinanceSdkDependenciesForTests(undefined);
    setAssetDecimalsDependenciesForTests(undefined);
  }
});

test("opportunities search filters by assetIds intersection", async () => {
  setAssetDecimalsDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    getAssetById: async () => ({ params: { decimals: 6 } })
  });
  setFolksFinanceSdkDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    getConsensusStateFn: async () => {
      throw new Error("consensus disabled in this test");
    },
    estimateConsensusApr: async () => {
      throw new Error("consensus APR disabled in this test");
    },
    retrievePoolManagerInfoFn: async () => ({
      adminAddress: "ADMIN",
      pools: {
        42: {
          variableBorrowInterestRate: 0n,
          variableBorrowInterestYield: 0n,
          variableBorrowInterestIndex: 0n,
          depositInterestRate: 400000000000000n,
          depositInterestYield: 850000000000000n,
          metadata: {
            oldVariableBorrowInterestIndex: 0n,
            oldDepositInterestIndex: 0n,
            oldTimestamp: 0n
          }
        },
        43: {
          variableBorrowInterestRate: 0n,
          variableBorrowInterestYield: 0n,
          variableBorrowInterestIndex: 0n,
          depositInterestRate: 400000000000000n,
          depositInterestYield: 1220000000000000n,
          metadata: {
            oldVariableBorrowInterestIndex: 0n,
            oldDepositInterestIndex: 0n,
            oldTimestamp: 0n
          }
        }
      }
    }),
    getOraclePricesFn: async () => ({
      prices: {
        10: { price: 100_000_000n, timestamp: 0n },
        11: { price: 100_000_000n, timestamp: 0n }
      }
    }),
    mainnetPools: {
      MATCH: {
        appId: 42,
        assetId: 10,
        fAssetId: 1,
        frAssetId: 2,
        assetDecimals: 6,
        poolManagerIndex: 0,
        loans: {}
      },
      OTHER: {
        appId: 43,
        assetId: 11,
        fAssetId: 3,
        frAssetId: 4,
        assetDecimals: 6,
        poolManagerIndex: 1,
        loans: {}
      }
    },
    retrievePoolInfoFn: async () => ({
      poolManagerAppId: 1,
      poolAdminAddress: "A",
      paramsAdminAddress: "B",
      configAdminAddress: "C",
      loansAdminAddress: "D",
      variableBorrow: {
        vr0: 0n,
        vr1: 0n,
        vr2: 0n,
        totalVariableBorrowAmount: 0n,
        variableBorrowInterestRate: 0n,
        variableBorrowInterestYield: 0n,
        variableBorrowInterestIndex: 0n
      },
      stableBorrow: {
        sr0: 0n,
        sr1: 0n,
        sr2: 0n,
        sr3: 0n,
        optimalStableToTotalDebtRatio: 0n,
        rebalanceUpUtilisationRatio: 0n,
        rebalanceUpDepositInterestRate: 0n,
        rebalanceDownDelta: 0n,
        totalStableBorrowAmount: 0n,
        stableBorrowInterestRate: 0n,
        stableBorrowInterestYield: 0n,
        overallStableBorrowInterestAmount: 0n
      },
      interest: {
        retentionRate: 0n,
        flashLoanFee: 0n,
        optimalUtilisationRatio: 0n,
        totalDeposits: 250_000_000_000n,
        depositInterestRate: 0n,
        depositInterestYield: 0n,
        depositInterestIndex: 0n,
        latestUpdate: 0n
      },
      caps: {
        borrowCap: 0n,
        stableBorrowPercentageCap: 0n
      },
      config: {
        depreciated: false,
        rewardsPaused: false,
        stableBorrowSupported: false,
        flashLoanSupported: false
      }
    })
  });

  const app = buildApp();
  await app.ready();

  try {
    const matchResponse = await app.inject({
      method: "GET",
      url: "/opportunities/search?platform=folks-finance&type=lending&assetIds=10"
    });
    assert.equal(matchResponse.statusCode, 200);
    const matchBody = matchResponse.json() as {
      data: Array<{ opportunityId: string; assetIds?: number[] }>;
    };
    assert.deepEqual(
      matchBody.data.map((row) => row.opportunityId),
      ["folks-lending-42"]
    );
    assert.deepEqual(matchBody.data[0]?.assetIds, [10]);

    const emptyResponse = await app.inject({
      method: "GET",
      url: "/opportunities/search?platform=folks-finance&type=lending&assetIds=999999999"
    });
    assert.equal(emptyResponse.statusCode, 200);
    const emptyBody = emptyResponse.json() as { data: unknown[] };
    assert.deepEqual(emptyBody.data, []);

    const badResponse = await app.inject({
      method: "GET",
      url: "/opportunities/search?platform=folks-finance&assetIds=abc"
    });
    assert.equal(badResponse.statusCode, 400);
    const badBody = badResponse.json() as {
      error: { code: string; message: string };
    };
    assert.equal(badBody.error.code, "VALIDATION_ERROR");
    assert.match(badBody.error.message, /assetIds/i);
  } finally {
    await app.close();
    setFolksFinanceSdkDependenciesForTests(undefined);
    setAssetDecimalsDependenciesForTests(undefined);
  }
});
