import assert from "node:assert/strict";
import { createServer, Server } from "node:http";
import test from "node:test";

import { setFolksFinanceSdkDependenciesForTests } from "../../src/adapters/index.js";
import { buildApp } from "../../src/app.js";
import {
  emptyWalletHealthFactorIndex,
  selectPersonalizedOpportunities,
  setAccountAssetsDependenciesForTests,
  setAssetDecimalsDependenciesForTests,
  setWalletHealthFactorLoaderForTests
} from "../../src/services/index.js";
import { OpportunityMarketRecord } from "../../src/types/opportunity.js";

const VALID_ADDRESS =
  "RS7TLLQRXKBAQDAVTSZC2ZLMVMLNSCL3FOUOESJJZ5XSKFFL56UI6X33CI";

test.before(() => {
  setWalletHealthFactorLoaderForTests(async () => emptyWalletHealthFactorIndex());
});

test.after(() => {
  setWalletHealthFactorLoaderForTests(undefined);
});

function stubFolksWithAssetIds(): void {
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
      ASSET_TEN: {
        appId: 42,
        assetId: 10,
        fAssetId: 1,
        frAssetId: 2,
        assetDecimals: 6,
        poolManagerIndex: 0,
        loans: {}
      },
      ASSET_ELEVEN: {
        appId: 43,
        assetId: 11,
        fAssetId: 3,
        frAssetId: 4,
        assetDecimals: 6,
        poolManagerIndex: 1,
        loans: {}
      },
      ASSET_TWELVE: {
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
        totalDeposits: pool.appId === 44 ? 50_000_000n : 250_000_000_000n,
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
}

test("selectPersonalizedOpportunities keeps only opportunities holding a matching asset", () => {
  const opportunities: OpportunityMarketRecord[] = [
    opportunity("match-high", 9, 1000, [10, 999]),
    opportunity("match-low", 3, 2000, [11]),
    opportunity("no-match", 50, 9999, [777]),
    opportunity("no-asset-ids", 80, 9999, undefined)
  ];

  const selected = selectPersonalizedOpportunities(
    opportunities,
    new Set<number>([10, 11]),
    10
  );

  assert.deepEqual(
    selected.map((row) => row.opportunityId),
    ["match-high", "match-low"]
  );
});

test("GET /opportunities/personalized returns wallet-matched opportunities ranked by risk then APY", async () => {
  stubFolksWithAssetIds();
  setAccountAssetsDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    fetchAccountInformation: async () => ({
      amount: 1_000_000n,
      assets: [
        { assetId: 10n, amount: 5n },
        { assetId: 11n, amount: 3n },
        { assetId: 12n, amount: 0n }
      ]
    })
  });

  const tinymanMock = await startEmptyTinymanMock();
  process.env.TINYMAN_API_BASE_URL = tinymanMock.baseUrl;

  const app = buildApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: "GET",
      url: `/opportunities/personalized?address=${VALID_ADDRESS}`
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      data: Array<{
        opportunityId: string;
        assetIds?: number[];
        canEnter?: boolean;
        eligibilityFullyCheckable?: boolean;
        risk?: { confidence?: string; healthFactor?: number };
      }>;
      meta: {
        limit: number;
        paymentRequired: boolean;
        address: string;
        heldAssetCount: number;
        eligibilityApplied?: boolean;
        eligibilityEndpoint?: string;
      };
    };

    assert.deepEqual(
      body.data.map((row) => row.opportunityId),
      ["folks-lending-43", "folks-lending-42"]
    );
    assert.equal(body.meta.limit, 10);
    assert.equal(body.meta.paymentRequired, true);
    assert.equal(body.meta.address, VALID_ADDRESS);
    assert.equal(body.meta.heldAssetCount, 3);
    assert.equal(body.meta.eligibilityApplied, true);
    assert.equal(body.meta.eligibilityEndpoint, "/eligibility");
    assert.equal(body.data.every((row) => row.canEnter === true), true);
    assert.equal(
      body.data.every((row) => row.eligibilityFullyCheckable === true),
      true
    );
    assert.equal(
      body.data.every((row) => row.risk?.confidence !== undefined),
      true
    );
  } finally {
    await app.close();
    await tinymanMock.close();
    delete process.env.TINYMAN_API_BASE_URL;
    setFolksFinanceSdkDependenciesForTests(undefined);
    setAccountAssetsDependenciesForTests(undefined);
    setAssetDecimalsDependenciesForTests(undefined);
  }
});

test("GET /opportunities/personalized attaches wallet health factor from position snapshots", async () => {
  stubFolksWithAssetIds();
  setWalletHealthFactorLoaderForTests(async () => ({
    byOpportunityId: new Map([["folks-lending-43", 1.25]]),
    byProtocol: new Map()
  }));
  setAccountAssetsDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    fetchAccountInformation: async () => ({
      amount: 1_000_000n,
      assets: [
        { assetId: 10n, amount: 5n },
        { assetId: 11n, amount: 3n },
        { assetId: 12n, amount: 0n }
      ]
    })
  });

  const tinymanMock = await startEmptyTinymanMock();
  process.env.TINYMAN_API_BASE_URL = tinymanMock.baseUrl;

  const app = buildApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: "GET",
      url: `/opportunities/personalized?address=${VALID_ADDRESS}`
    });
    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      data: Array<{ opportunityId: string; risk?: { healthFactor?: number } }>;
    };
    const withHf = body.data.find((row) => row.opportunityId === "folks-lending-43");
    const withoutHf = body.data.find((row) => row.opportunityId === "folks-lending-42");
    assert.equal(withHf?.risk?.healthFactor, 1.25);
    assert.equal(withoutHf?.risk?.healthFactor, undefined);
  } finally {
    await app.close();
    await tinymanMock.close();
    delete process.env.TINYMAN_API_BASE_URL;
    setFolksFinanceSdkDependenciesForTests(undefined);
    setAccountAssetsDependenciesForTests(undefined);
    setAssetDecimalsDependenciesForTests(undefined);
    setWalletHealthFactorLoaderForTests(async () => emptyWalletHealthFactorIndex());
  }
});

test("GET /opportunities/personalized rejects an invalid address with 400", async () => {
  const app = buildApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: "GET",
      url: "/opportunities/personalized?address=not-a-real-address"
    });

    assert.equal(response.statusCode, 400);
    const body = response.json() as { error: { code: string } };
    assert.equal(body.error.code, "VALIDATION_ERROR");
  } finally {
    await app.close();
  }
});

test("GET /opportunities/personalized returns empty data when no assets match", async () => {
  stubFolksWithAssetIds();
  setAccountAssetsDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    fetchAccountInformation: async () => ({
      amount: 0n,
      assets: [{ assetId: 99999n, amount: 7n }]
    })
  });

  const tinymanMock = await startEmptyTinymanMock();
  process.env.TINYMAN_API_BASE_URL = tinymanMock.baseUrl;

  const app = buildApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: "GET",
      url: `/opportunities/personalized?address=${VALID_ADDRESS}`
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      data: unknown[];
      meta: { heldAssetCount: number };
    };
    assert.equal(body.data.length, 0);
    assert.equal(body.meta.heldAssetCount, 1);
  } finally {
    await app.close();
    await tinymanMock.close();
    delete process.env.TINYMAN_API_BASE_URL;
    setFolksFinanceSdkDependenciesForTests(undefined);
    setAccountAssetsDependenciesForTests(undefined);
    setAssetDecimalsDependenciesForTests(undefined);
  }
});

function opportunity(
  opportunityId: string,
  apy: number,
  tvlUsd: number,
  assetIds: number[] | undefined
): OpportunityMarketRecord {
  return {
    protocol: "folks-finance",
    opportunityType: "lending",
    opportunityId,
    assetPair: "TEST",
    ...(assetIds ? { assetIds } : {}),
    apy,
    yieldBasis: "apy",
    tvlUsd,
    sourceTimestamp: "2026-06-18T00:00:00.000Z",
    fetchedAt: "2026-06-18T00:00:00.000Z"
  };
}

interface MockServer {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startEmptyTinymanMock(): Promise<MockServer> {
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/pools/")) {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ results: [] }));
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind Tinyman mock server.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}
