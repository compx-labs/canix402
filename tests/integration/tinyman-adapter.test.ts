import assert from "node:assert/strict";
import { createServer, Server } from "node:http";
import test from "node:test";

import { fetchTinymanOpportunities, normalizeTinymanPool } from "../../src/adapters/index.js";
import { buildApp } from "../../src/app.js";

test("normalizeTinymanPool maps APY and TVL USD fields", () => {
  const record = normalizeTinymanPool(
    {
      id: "pool-1",
      pairName: "ALGO/USDC",
      apy: "12.5",
      tvlUsd: "2000000",
      apr: "10.1",
      updatedAt: "2026-06-17T21:00:00.000Z",
      type: "farm"
    },
    "2026-06-17T21:05:00.000Z"
  );

  assert.ok(record);
  assert.equal(record?.protocol, "tinyman");
  assert.equal(record?.opportunityType, "farm");
  assert.equal(record?.apy, 12.5);
  assert.equal(record?.tvlUsd, 2000000);
  assert.equal(record?.apr, 10.1);
  assert.equal(record?.assetPair, "ALGO/USDC");
});

test("normalizeTinymanPool drops records without APY or TVL", () => {
  const missingApy = normalizeTinymanPool({
    id: "missing-apy",
    pairName: "ALGO/USDC",
    tvlUsd: 200
  });
  const missingTvl = normalizeTinymanPool({
    id: "missing-tvl",
    pairName: "ALGO/USDC",
    apy: 5
  });

  assert.equal(missingApy, null);
  assert.equal(missingTvl, null);
});

test("fetchTinymanOpportunities maps API payload and ignores invalid rows", async () => {
  const opportunities = await fetchTinymanOpportunities(async () => {
    return {
      ok: true,
      json: async () => ({
        pools: [
          {
            id: "pool-1",
            pairName: "ALGO/USDC",
            apy: 9.2,
            tvlUsd: 1000,
            updatedAt: "2026-06-17T20:00:00.000Z"
          },
          {
            id: "bad-pool",
            pairName: "BAD/USDC",
            apy: null,
            tvlUsd: 50
          }
        ]
      })
    } as Response;
  });

  assert.equal(opportunities.length, 1);
  assert.equal(opportunities[0]?.opportunityId, "pool-1");
  assert.equal(opportunities[0]?.apy, 9.2);
  assert.equal(opportunities[0]?.tvlUsd, 1000);
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
    if (req.url === "/pools") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          pools: [
            {
              id: "tinyman-pool-1",
              pairName: "ALGO/USDC",
              apy: 11.4,
              tvlUsd: 1500000,
              apr: 9.1,
              updatedAt: "2026-06-17T20:00:00.000Z",
              type: "lp"
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
