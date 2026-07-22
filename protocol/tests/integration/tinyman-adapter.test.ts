import assert from "node:assert/strict";
import { createServer, Server } from "node:http";
import test from "node:test";

import {
  fetchTinymanOpportunities,
  normalizeTinymanPool,
  normalizeTinymanTAlgoStakingOpportunity,
  normalizeTinymanStAlgoStakingOpportunity,
  setTinymanAdapterDependenciesForTests,
  TINYMAN_LIQUID_STAKE_PROTOCOL_FEE,
  TINYMAN_STALGO_STAKING_OPPORTUNITY_ID,
  TINYMAN_TALGO_STAKING_OPPORTUNITY_ID
} from "../../src/adapters/index.js";
import { buildApp } from "../../src/app.js";

function disableTinymanStakingForTests(): void {
  setTinymanAdapterDependenciesForTests({
    estimateConsensusApr: async () => {
      throw new Error("staking disabled in this test");
    },
    getRestakeGlobalState: async () => {
      throw new Error("restake disabled in this test");
    }
  });
}

test("normalizeTinymanPool maps APY and TVL USD fields", () => {
  const record = normalizeTinymanPool(
    {
      address: "pool-1",
      annual_percentage_rate: "0.101",
      annual_percentage_yield: "0.125",
      liquidity_in_usd: "2000000",
      is_verified: true,
      asset_1: { unit_name: "ALGO" },
      asset_2: { unit_name: "USDC" }
    },
    "2026-06-17T21:05:00.000Z"
  );

  assert.ok(record);
  assert.equal(record?.protocol, "tinyman");
  assert.equal(record?.opportunityType, "lp");
  assert.equal(record?.opportunityId, "pool-1:lp");
  assert.equal(record?.apy, 12.5);
  assert.equal(record?.yieldBasis, "apy");
  assert.equal(record?.tvlUsd, 2000000);
  assert.ok(Math.abs((record?.apr ?? 0) - 10.1) < Number.EPSILON * 10);
  assert.equal(record?.assetPair, "ALGO/USDC");
});

test("normalizeTinymanPool drops records without APY or TVL", () => {
  const missingApy = normalizeTinymanPool({
    address: "missing-apy",
    liquidity_in_usd: 200
  });
  const missingTvl = normalizeTinymanPool({
    address: "missing-tvl",
    annual_percentage_yield: 5
  });

  assert.equal(missingApy, null);
  assert.equal(missingTvl, null);
});

test("normalizeTinymanTAlgoStakingOpportunity applies 8% protocol fee", () => {
  const record = normalizeTinymanTAlgoStakingOpportunity({
    consensusApr: 10,
    circulatingSupply: 1_000_000_000_000n,
    algoToTAlgoRatio: 1.05,
    algoUsdPrice: 0.2,
    sampleSize: 16,
    fetchedAtIso: "2026-07-17T12:00:00.000Z"
  });

  assert.ok(record);
  assert.equal(record?.opportunityType, "staking");
  assert.equal(record?.opportunityId, TINYMAN_TALGO_STAKING_OPPORTUNITY_ID);
  assert.equal(record?.assetPair, "ALGO/tALGO");
  assert.equal(record?.apr, 10);
  assert.equal(record?.apy, 10 * (1 - TINYMAN_LIQUID_STAKE_PROTOCOL_FEE));
  // staked ALGO = 1e12 * 1.05 / 1e6 = 1.05e6; USD = 1.05e6 * 0.2 = 210_000
  assert.equal(record?.tvlUsd, 210_000);
  assert.ok(record?.notes?.includes("8%"));
});

test("normalizeTinymanStAlgoStakingOpportunity derives TINY emission APR", () => {
  const record = normalizeTinymanStAlgoStakingOpportunity({
    totalStakedAmount: 1_000_000_000_000n,
    // 1 TINY / sec in micro-units
    currentRewardRatePerTime: 1_000_000n,
    algoToTAlgoRatio: 1,
    algoUsdPrice: 0.2,
    tinyUsdPrice: 0.01,
    fetchedAtIso: "2026-07-17T12:00:00.000Z"
  });

  assert.ok(record);
  assert.equal(record?.opportunityId, TINYMAN_STALGO_STAKING_OPPORTUNITY_ID);
  assert.equal(record?.assetPair, "tALGO/stALGO");
  assert.equal(record?.yieldBasis, "apr");
  assert.deepEqual(record?.assetIds, [2537013734, 2537023208]);
  // TVL = 1e12 / 1e6 * 0.2 = 200_000
  assert.equal(record?.tvlUsd, 200_000);
  // reward USD/year = 1 TINY/s * 31557600 * 0.01 = 315576
  // APR% = 315576 / 200000 * 100 = 157.788
  assert.ok(record?.apr !== undefined);
  assert.ok(Math.abs((record?.apr ?? 0) - 157.788) < 0.001);
  assert.equal(record?.apy, record?.apr);
});

test("normalizeTinymanTAlgoStakingOpportunity drops invalid inputs", () => {
  assert.equal(
    normalizeTinymanTAlgoStakingOpportunity({
      consensusApr: 10,
      circulatingSupply: 0n,
      algoToTAlgoRatio: 1,
      algoUsdPrice: 0.2,
      sampleSize: 1,
      fetchedAtIso: "2026-07-17T12:00:00.000Z"
    }),
    null
  );
});

test("fetchTinymanOpportunities maps API payload and ignores invalid rows", async () => {
  disableTinymanStakingForTests();
  try {
    const opportunities = await fetchTinymanOpportunities(async () => {
      return {
        ok: true,
        json: async () => ({
          results: [
            {
              address: "pool-1",
              is_verified: true,
              annual_percentage_yield: 0.092,
              liquidity_in_usd: 1000,
              asset_1: { unit_name: "ALGO" },
              asset_2: { unit_name: "USDC" }
            },
            {
              address: "bad-pool",
              is_verified: true,
              annual_percentage_yield: null,
              liquidity_in_usd: 50
            },
            {
              address: "unverified-pool",
              is_verified: false,
              annual_percentage_yield: 0.051,
              liquidity_in_usd: 2000
            }
          ]
        })
      } as Response;
    });

    assert.equal(opportunities.length, 1);
    assert.equal(opportunities[0]?.opportunityId, "pool-1:lp");
    assert.equal(opportunities[0]?.apy, 9.2);
    assert.equal(opportunities[0]?.tvlUsd, 1000);
  } finally {
    setTinymanAdapterDependenciesForTests(undefined);
  }
});

test("fetchTinymanOpportunities emits separate LP and farm opportunities", async () => {
  disableTinymanStakingForTests();
  try {
    const opportunities = await fetchTinymanOpportunities(async () => {
      return {
        ok: true,
        json: async () => ({
          results: [
            {
              address: "pool-with-farm",
              is_verified: true,
              annual_percentage_rate: "0.041",
              annual_percentage_yield: "0.052",
              staking_total_annual_percentage_rate: "0.079",
              staking_total_annual_percentage_yield: "0.081",
              liquidity_in_usd: "15000",
              asset_1: { unit_name: "ALGO" },
              asset_2: { unit_name: "xALGO" }
            }
          ]
        })
      } as Response;
    });

    assert.equal(opportunities.length, 2);
    const lp = opportunities.find((opportunity) => opportunity.opportunityType === "lp");
    const farm = opportunities.find((opportunity) => opportunity.opportunityType === "farm");
    assert.ok(lp);
    assert.ok(farm);
    assert.equal(lp?.opportunityId, "pool-with-farm:lp");
    assert.equal(farm?.opportunityId, "pool-with-farm:farm");
    assert.equal(lp?.apy, 5.2);
    assert.equal(lp?.yieldBasis, "apy");
    assert.equal(farm?.apy, 8.1);
    assert.equal(farm?.yieldBasis, "apy");
  } finally {
    setTinymanAdapterDependenciesForTests(undefined);
  }
});

test("fetchTinymanOpportunities appends tALGO staking when dependencies succeed", async () => {
  setTinymanAdapterDependenciesForTests({
    estimateConsensusApr: async () => ({
      apr: 5,
      bonusMicroAlgos: 10_000_000n,
      avgFeesCollected: 0n,
      blockRewardMicroAlgos: 10_000_000,
      onlineStake: 1_000_000_000_000_000n,
      currentRound: 1,
      blocksPerYear: 10_000_000,
      sampleSize: 8,
      sourceTimestamp: "2026-07-17T12:00:00.000Z"
    }),
    createAlgodClient: () => ({}) as never,
    getTAlgoCirculatingSupply: async () => 1_000_000_000_000n,
    getAlgoToTAlgoRatio: async () => 1,
    fetchAlgoUsdPrice: async () => 0.1
  });

  try {
    const opportunities = await fetchTinymanOpportunities(async () => {
      return {
        ok: true,
        json: async () => ({
          results: [
            {
              address: "pool-1",
              is_verified: true,
              annual_percentage_yield: 0.01,
              liquidity_in_usd: 100,
              asset_1: { unit_name: "ALGO" },
              asset_2: { unit_name: "USDC" }
            }
          ]
        })
      } as Response;
    });

    assert.equal(opportunities.length, 2);
    const staking = opportunities.find(
      (opportunity) => opportunity.opportunityType === "staking"
    );
    assert.ok(staking);
    assert.equal(staking?.opportunityId, TINYMAN_TALGO_STAKING_OPPORTUNITY_ID);
    assert.equal(staking?.apy, 5 * (1 - TINYMAN_LIQUID_STAKE_PROTOCOL_FEE));
  } finally {
    setTinymanAdapterDependenciesForTests(undefined);
  }
});

test("GET /protocols/tinyman/opportunities returns Tinyman normalized data", async () => {
  disableTinymanStakingForTests();
  const mockServer = await startTinymanMockServer();
  process.env.TINYMAN_API_BASE_URL = mockServer.baseUrl;

  const app = buildApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: "GET",
      url: "/protocols/tinyman/opportunities?limit=10&offset=0"
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      data: Array<{ protocol: string; apy: number; tvlUsd: number }>;
    };

    assert.equal(body.data.length, 1);
    assert.equal(body.data[0]?.protocol, "tinyman");
    assert.equal(typeof body.data[0]?.apy, "number");
    assert.equal(typeof body.data[0]?.tvlUsd, "number");
  } finally {
    await app.close();
    await mockServer.close();
    delete process.env.TINYMAN_API_BASE_URL;
    setTinymanAdapterDependenciesForTests(undefined);
  }
});

interface TinymanMockServer {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startTinymanMockServer(): Promise<TinymanMockServer> {
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/pools/")) {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          results: [
            {
              address: "tinyman-pool-1",
              annual_percentage_rate: 9.1,
              annual_percentage_yield: 11.4,
              liquidity_in_usd: 1500000,
              is_verified: true,
              asset_1: { unit_name: "ALGO" },
              asset_2: { unit_name: "USDC" }
            }
          ]
        })
      );
      return;
    }

    res.writeHead(404).end();
  });

  await listenOnRandomPort(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind Tinyman mock server.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => closeServer(server)
  };
}

async function listenOnRandomPort(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
