import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchFolksFinanceOpportunities,
  normalizeFolksLendingOpportunity,
  normalizeFolksXAlgoStakingOpportunity,
  setFolksFinanceSdkDependenciesForTests,
  FOLKS_XALGO_STAKING_OPPORTUNITY_ID
} from "../../src/adapters/index.js";
import { buildApp } from "../../src/app.js";
import { setAssetDecimalsDependenciesForTests } from "../../src/services/asset-decimals.js";

function mockOnChainAssetDecimals(): void {
  setAssetDecimalsDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    getAssetById: async () => ({ params: { decimals: 6 } })
  });
}

test("normalizeFolksLendingOpportunity maps APY and TVL fields from SDK values", () => {
  const record = normalizeFolksLendingOpportunity({
    symbol: "ALGO",
    pool: {
      appId: 42,
      assetId: 0,
      fAssetId: 1,
      frAssetId: 2,
      assetDecimals: 6,
      poolManagerIndex: 0,
      loans: {}
    },
    poolInfo: {
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
        totalDeposits: 1_250_000_000n,
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
    },
    poolManagerInfo: {
      adminAddress: "ADMIN",
      pools: {
        42: {
          variableBorrowInterestRate: 0n,
          variableBorrowInterestYield: 0n,
          variableBorrowInterestIndex: 0n,
          depositInterestRate: 450000000000000n,
          depositInterestYield: 550000000000000n,
          metadata: {
            oldVariableBorrowInterestIndex: 0n,
            oldDepositInterestIndex: 0n,
            oldTimestamp: 0n
          }
        }
      }
    },
    // Folks oracle scale for 6dp assets: USD * 10^(14-6). $0.22 → 22_000_000.
    oraclePrice: 22_000_000n,
    assetDecimals: 6,
    fetchedAtIso: "2026-06-17T21:05:00.000Z"
  });

  assert.ok(record);
  assert.equal(record?.protocol, "folks-finance");
  assert.equal(record?.opportunityType, "lending");
  assert.equal(record?.apy, 5.5);
  assert.equal(record?.yieldBasis, "apy");
  assert.equal(record?.tvlUsd, 275);
  assert.equal(record?.apr, 4.5);
  assert.equal(record?.sourceTimestamp, record?.fetchedAt);
  assert.match(record?.notes ?? "", /sourceTimestamp equals fetchedAt/);
  assert.match(record?.notes ?? "", /Folks mainnet lending pool 42/);
});

test("normalizeFolksXAlgoStakingOpportunity applies Folks protocol fee", () => {
  const record = normalizeFolksXAlgoStakingOpportunity({
    consensusState: {
      algoBalance: 1_250_000_000n,
      fee: 500_000_000_000_000n // 0.05 in 16dp
    },
    consensusApr: 10,
    oraclePrice: 22_000_000n,
    xAlgoId: 1134696561,
    sampleSize: 16,
    fetchedAtIso: "2026-07-17T12:00:00.000Z"
  });

  assert.ok(record);
  assert.equal(record?.opportunityType, "staking");
  assert.equal(record?.opportunityId, FOLKS_XALGO_STAKING_OPPORTUNITY_ID);
  assert.equal(record?.assetPair, "ALGO/xALGO");
  assert.deepEqual(record?.assetIds, [0, 1134696561]);
  assert.equal(record?.apr, 10);
  assert.equal(record?.apy, 9.5);
  assert.equal(record?.tvlUsd, 275);
  assert.ok(record?.notes?.includes("5.00%"));
});

test("normalizeFolksXAlgoStakingOpportunity drops incomplete inputs", () => {
  assert.equal(
    normalizeFolksXAlgoStakingOpportunity({
      consensusState: { algoBalance: 0n, fee: 0n },
      consensusApr: 10,
      oraclePrice: 22_000_000n,
      xAlgoId: 1134696561,
      sampleSize: 1,
      fetchedAtIso: "2026-07-17T12:00:00.000Z"
    }),
    null
  );
});

test("normalizeFolksLendingOpportunity drops rows when state is incomplete", () => {
  assert.equal(
    normalizeFolksLendingOpportunity({
      symbol: "ALGO",
      pool: {
        appId: 42,
        assetId: 0,
        fAssetId: 1,
        frAssetId: 2,
        assetDecimals: 6,
        poolManagerIndex: 0,
        loans: {}
      },
      poolInfo: {
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
          totalDeposits: 0n,
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
      },
      poolManagerInfo: {
        adminAddress: "ADMIN",
        pools: {}
      },
      oraclePrice: undefined,
      assetDecimals: 6,
      fetchedAtIso: "2026-06-17T21:05:00.000Z"
    }),
    null
  );
});

test("normalizeFolksLendingOpportunity drops rows when on-chain decimals are unavailable", () => {
  assert.equal(
    normalizeFolksLendingOpportunity({
      symbol: "ALGO",
      pool: {
        appId: 42,
        assetId: 0,
        fAssetId: 1,
        frAssetId: 2,
        assetDecimals: 6,
        poolManagerIndex: 0,
        loans: {}
      },
      poolInfo: {
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
          totalDeposits: 1_250_000_000n,
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
      },
      poolManagerInfo: {
        adminAddress: "ADMIN",
        pools: {
          42: {
            variableBorrowInterestRate: 0n,
            variableBorrowInterestYield: 0n,
            variableBorrowInterestIndex: 0n,
            depositInterestRate: 450000000000000n,
            depositInterestYield: 550000000000000n,
            metadata: {
              oldVariableBorrowInterestIndex: 0n,
              oldDepositInterestIndex: 0n,
              oldTimestamp: 0n
            }
          }
        }
      },
      oraclePrice: 22_000_000n,
      assetDecimals: undefined,
      fetchedAtIso: "2026-06-17T21:05:00.000Z"
    }),
    null
  );
});

test("fetchFolksFinanceOpportunities maps SDK responses and filters invalid rows", async () => {
  mockOnChainAssetDecimals();
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
          depositInterestRate: 450000000000000n,
          depositInterestYield: 550000000000000n,
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
        // $0.22 for a 6-decimal asset → 0.22 * 10^8
        0: { price: 22_000_000n, timestamp: 0n }
      }
    }),
    mainnetPools: {
      ALGO: {
        appId: 42,
        assetId: 0,
        fAssetId: 1,
        frAssetId: 2,
        assetDecimals: 6,
        poolManagerIndex: 0,
        loans: {}
      },
      BROKEN: {
        appId: 43,
        assetId: 99,
        fAssetId: 101,
        frAssetId: 102,
        assetDecimals: 6,
        poolManagerIndex: 1,
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
        totalDeposits: pool.appId === 42 ? 1_250_000_000n : 0n,
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

  try {
    const opportunities = await fetchFolksFinanceOpportunities();

    assert.equal(opportunities.length, 1);
    assert.equal(opportunities[0]?.opportunityId, "folks-lending-42");
    assert.equal(opportunities[0]?.protocol, "folks-finance");
    assert.equal(opportunities[0]?.opportunityType, "lending");
  } finally {
    setFolksFinanceSdkDependenciesForTests(undefined);
    setAssetDecimalsDependenciesForTests(undefined);
  }
});

test("GET /protocols/folks-finance/opportunities returns Folks normalized data", async () => {
  mockOnChainAssetDecimals();
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
          depositInterestRate: 490000000000000n,
          depositInterestYield: 510000000000000n,
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
        // $1.00 for a 6-decimal asset → 1 * 10^8
        0: { price: 100_000_000n, timestamp: 0n }
      }
    }),
    mainnetPools: {
      ALGO: {
        appId: 42,
        assetId: 0,
        fAssetId: 1,
        frAssetId: 2,
        assetDecimals: 6,
        poolManagerIndex: 0,
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
        totalDeposits: 5000000000n,
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
      url: "/protocols/folks-finance/opportunities?limit=10&offset=0"
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      data: Array<{ protocol: string; opportunityId: string; apy: number }>;
    };
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0]?.protocol, "folks-finance");
    assert.equal(body.data[0]?.opportunityId, "folks-lending-42");
    assert.equal(body.data[0]?.apy, 5.1);
  } finally {
    await app.close();
    setFolksFinanceSdkDependenciesForTests(undefined);
    setAssetDecimalsDependenciesForTests(undefined);
  }
});

test("fetchFolksFinanceOpportunities appends xALGO staking when consensus deps succeed", async () => {
  mockOnChainAssetDecimals();
  setFolksFinanceSdkDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    retrievePoolManagerInfoFn: async () => ({
      adminAddress: "ADMIN",
      pools: {
        42: {
          variableBorrowInterestRate: 0n,
          variableBorrowInterestYield: 0n,
          variableBorrowInterestIndex: 0n,
          depositInterestRate: 450000000000000n,
          depositInterestYield: 550000000000000n,
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
        0: { price: 22_000_000n, timestamp: 0n }
      }
    }),
    mainnetPools: {
      ALGO: {
        appId: 42,
        assetId: 0,
        fAssetId: 1,
        frAssetId: 2,
        assetDecimals: 6,
        poolManagerIndex: 0,
        loans: {}
      }
    },
    mainnetConsensusConfig: {
      consensusAppId: 1,
      xAlgoId: 1134696561,
      stakeAndDepositAppId: 2
    },
    getConsensusStateFn: async () =>
      ({
        algoBalance: 1_250_000_000n,
        fee: 0n,
        xAlgoCirculatingSupply: 1_000_000_000n
      }) as never,
    estimateConsensusApr: async () => ({
      apr: 4,
      bonusMicroAlgos: 10_000_000n,
      avgFeesCollected: 0n,
      blockRewardMicroAlgos: 10_000_000,
      onlineStake: 1_000_000_000_000_000n,
      currentRound: 1,
      blocksPerYear: 10_000_000,
      sampleSize: 8,
      sourceTimestamp: "2026-07-17T12:00:00.000Z"
    }),
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
        totalDeposits: 1_250_000_000n,
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

  try {
    const opportunities = await fetchFolksFinanceOpportunities();
    assert.equal(opportunities.length, 2);
    const staking = opportunities.find(
      (opportunity) => opportunity.opportunityType === "staking"
    );
    assert.ok(staking);
    assert.equal(staking?.opportunityId, FOLKS_XALGO_STAKING_OPPORTUNITY_ID);
    assert.equal(staking?.apy, 4);
    assert.equal(staking?.tvlUsd, 275);
  } finally {
    setFolksFinanceSdkDependenciesForTests(undefined);
    setAssetDecimalsDependenciesForTests(undefined);
  }
});

