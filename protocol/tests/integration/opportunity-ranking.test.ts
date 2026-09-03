import assert from "node:assert/strict";
import test from "node:test";

import { setCompXSdkDependenciesForTests } from "../../src/adapters/index.js";
import { buildApp } from "../../src/app.js";
import { setAssetDecimalsDependenciesForTests } from "../../src/services/asset-decimals.js";
import { rankOpportunities } from "../../src/services/opportunity-ranking.js";
import { OpportunityMarketRecord } from "../../src/types/opportunity.js";

function mockCompXCatalog(): void {
  setAssetDecimalsDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    getAssetById: async () => ({ params: { decimals: 6 } })
  });
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
}

function clearCompXCatalogMock(): void {
  setCompXSdkDependenciesForTests(undefined);
  setAssetDecimalsDependenciesForTests(undefined);
}

test("rankOpportunities sorts equal-risk rows by APY descending then TVL descending", () => {
  const ranked = rankOpportunities([
    opportunity("low", 2, 10_000),
    opportunity("high-low-tvl", 9, 1_000),
    opportunity("high-high-tvl", 9, 5_000),
    opportunity("middle", 5, 20_000)
  ]);

  assert.deepEqual(
    ranked.map((row) => row.opportunityId),
    ["high-high-tvl", "high-low-tvl", "middle", "low"]
  );
});

test("aggregate opportunities default to top 10", async () => {
  mockCompXCatalog();
  const app = buildApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: "GET",
      url: "/opportunities?protocol=compx"
    });
    const body = response.json() as { meta: { limit: number } };

    assert.equal(response.statusCode, 200);
    assert.equal(body.meta.limit, 10);
  } finally {
    clearCompXCatalogMock();
    await app.close();
  }
});

test("protocol opportunities default to top 25", async () => {
  mockCompXCatalog();
  const app = buildApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: "GET",
      url: "/protocols/compx/opportunities"
    });
    const body = response.json() as { meta: { limit: number } };

    assert.equal(response.statusCode, 200);
    assert.equal(body.meta.limit, 25);
  } finally {
    clearCompXCatalogMock();
    await app.close();
  }
});

function opportunity(
  opportunityId: string,
  apy: number,
  tvlUsd: number
): OpportunityMarketRecord {
  return {
    protocol: "tinyman",
    opportunityType: "lp",
    opportunityId,
    assetPair: "ALGO/USDC",
    apy,
    yieldBasis: "apy",
    tvlUsd,
    sourceTimestamp: "2026-06-18T00:00:00.000Z",
    fetchedAt: "2026-06-18T00:00:00.000Z"
  };
}
