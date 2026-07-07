import assert from "node:assert/strict";
import { createServer, Server } from "node:http";
import test from "node:test";

import { fetchTinymanOpportunities, normalizeTinymanPool } from "../../src/adapters/index.js";
import { buildApp } from "../../src/app.js";

test("normalizeTinymanPool maps APY and TVL USD fields", () => {
  const record = normalizeTinymanPool(
    {
      address: "pool-1",
      annual_percentage_rate: "10.1",
      annual_percentage_yield: "12.5",
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
  assert.equal(record?.apr, 10.1);
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

test("fetchTinymanOpportunities maps API payload and ignores invalid rows", async () => {
  const opportunities = await fetchTinymanOpportunities(async () => {
    return {
      ok: true,
      json: async () => ({
        results: [
          {
            address: "pool-1",
            is_verified: true,
            annual_percentage_yield: 9.2,
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
            annual_percentage_yield: 5.1,
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
});

test("fetchTinymanOpportunities emits separate LP and farm opportunities", async () => {
  const opportunities = await fetchTinymanOpportunities(async () => {
    return {
      ok: true,
      json: async () => ({
        results: [
          {
            address: "pool-with-farm",
            is_verified: true,
            annual_percentage_rate: "4.1",
            annual_percentage_yield: "5.2",
            staking_total_annual_percentage_rate: "7.9",
            staking_total_annual_percentage_yield: "8.1",
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
});

test("GET /protocols/tinyman/opportunities returns Tinyman normalized data", async () => {
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
