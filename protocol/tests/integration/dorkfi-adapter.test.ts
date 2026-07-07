import assert from "node:assert/strict";
import { createServer, Server } from "node:http";
import test from "node:test";

import {
  fetchDorkFiOpportunities,
  normalizeDorkFiOpportunity
} from "../../src/adapters/index.js";
import { buildApp } from "../../src/app.js";

test("normalizeDorkFiOpportunity maps Algorand lending rows", () => {
  const record = normalizeDorkFiOpportunity(
    {
      type: "lending",
      assetName: "USDC",
      apy: "6.06",
      tvl: "29846.609471",
      assetId: "31566704",
      network: "Algorand",
      appId: "3333688282"
    },
    "2026-07-01T21:00:00.000Z"
  );

  assert.ok(record);
  assert.equal(record?.protocol, "dorkfi");
  assert.equal(record?.opportunityType, "lending");
  assert.equal(record?.assetPair, "USDC");
  assert.equal(record?.apy, 6.06);
  assert.equal(record?.yieldBasis, "apy");
  assert.equal(record?.tvlUsd, 29846.609471);
  assert.deepEqual(record?.assetIds, [31566704]);
  assert.equal(
    record?.opportunityId,
    "dorkfi:algorand:3333688282:31566704:lending"
  );
});

test("normalizeDorkFiOpportunity filters non-Algorand network rows", () => {
  const record = normalizeDorkFiOpportunity({
    type: "lending",
    assetName: "VOI",
    apy: 1.2,
    tvl: 1000,
    assetId: 2320775407,
    network: "Voi Network",
    appId: "47139778"
  });
  assert.equal(record, null);
});

test("fetchDorkFiOpportunities keeps only valid Algorand rows", async () => {
  process.env.DORKFI_API_BASE_URL = "http://mock.dorkfi.local/feed.json";

  try {
    const opportunities = await fetchDorkFiOpportunities(async () => {
      return {
        ok: true,
        json: async () => ([
          {
            type: "lending",
            assetName: "USDC",
            apy: 5.5,
            tvl: 20000,
            assetId: "31566704",
            network: "Algorand",
            appId: "3333688282"
          },
          {
            type: "lending",
            assetName: "WAD",
            apy: 2.2,
            tvl: 5000,
            assetId: 47138068,
            network: "Voi Network",
            appId: "47139781"
          },
          {
            type: "lending",
            assetName: "BAD",
            apy: null,
            tvl: 1000,
            assetId: 1,
            network: "Algorand",
            appId: "123"
          }
        ])
      } as Response;
    });

    assert.equal(opportunities.length, 1);
    assert.equal(opportunities[0]?.protocol, "dorkfi");
    assert.equal(opportunities[0]?.opportunityType, "lending");
    assert.equal(opportunities[0]?.assetPair, "USDC");
  } finally {
    delete process.env.DORKFI_API_BASE_URL;
  }
});

test("GET /protocols/dorkfi/opportunities returns Dork.fi normalized data", async () => {
  const mockServer = await startDorkFiMockServer([
    {
      type: "lending",
      assetName: "USDC",
      apy: 6.1,
      tvl: 29846.609471,
      assetId: "31566704",
      network: "Algorand",
      appId: "3333688282"
    },
    {
      type: "lending",
      assetName: "VOI",
      apy: 0.8,
      tvl: 930.924321,
      assetId: "2320775407",
      network: "Algorand",
      appId: "3333688282"
    },
    {
      type: "lending",
      assetName: "aUSDC",
      apy: 8.5,
      tvl: 18793.178111,
      assetId: 395614,
      network: "Voi Network",
      appId: "47139778"
    }
  ]);

  process.env.DORKFI_API_BASE_URL = mockServer.feedUrl;

  const app = buildApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: "GET",
      url: "/protocols/dorkfi/opportunities?limit=10&offset=0"
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      data: Array<{
        protocol: string;
        opportunityType: string;
        assetPair: string;
      }>;
    };

    assert.equal(body.data.length, 2);
    assert.equal(body.data[0]?.protocol, "dorkfi");
    assert.equal(body.data[0]?.opportunityType, "lending");
    assert.equal(
      body.data.some((row) => row.assetPair === "USDC"),
      true
    );
  } finally {
    await app.close();
    await mockServer.close();
    delete process.env.DORKFI_API_BASE_URL;
  }
});

test("Dork.fi data is available in aggregate and search endpoints", async () => {
  const mockServer = await startDorkFiMockServer([
    {
      type: "lending",
      assetName: "USDC",
      apy: 6.1,
      tvl: 29846.609471,
      assetId: "31566704",
      network: "Algorand",
      appId: "3333688282"
    },
    {
      type: "staking",
      assetName: "TINY",
      apy: 2.4,
      tvl: 94.163392,
      assetId: "2200000000",
      network: "Algorand",
      appId: "3345940978"
    }
  ]);
  process.env.DORKFI_API_BASE_URL = mockServer.feedUrl;

  const app = buildApp();
  await app.ready();

  try {
    const aggregateResponse = await app.inject({
      method: "GET",
      url: "/opportunities?protocol=dorkfi&limit=10&offset=0"
    });
    assert.equal(aggregateResponse.statusCode, 200);
    const aggregateBody = aggregateResponse.json() as {
      data: Array<{ protocol: string }>;
      meta: { paymentRequired: boolean };
    };
    assert.equal(aggregateBody.data.length, 2);
    assert.equal(aggregateBody.data[0]?.protocol, "dorkfi");
    assert.equal(aggregateBody.meta.paymentRequired, true);

    const searchResponse = await app.inject({
      method: "GET",
      url: "/opportunities/search?platform=dorkfi&type=lending&limit=10&offset=0"
    });
    assert.equal(searchResponse.statusCode, 200);
    const searchBody = searchResponse.json() as {
      data: Array<{ protocol: string; opportunityType: string }>;
    };
    assert.equal(searchBody.data.length, 1);
    assert.equal(searchBody.data[0]?.protocol, "dorkfi");
    assert.equal(searchBody.data[0]?.opportunityType, "lending");
  } finally {
    await app.close();
    await mockServer.close();
    delete process.env.DORKFI_API_BASE_URL;
  }
});

interface DorkFiMockServer {
  feedUrl: string;
  close: () => Promise<void>;
}

async function startDorkFiMockServer(payload: unknown[]): Promise<DorkFiMockServer> {
  const server = createServer((req, res) => {
    if (req.url === "/dorkfi-opportunities-latest.json") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(payload));
      return;
    }

    res.writeHead(404).end();
  });

  await listenOnRandomPort(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind Dork.fi mock server.");
  }

  return {
    feedUrl: `http://127.0.0.1:${address.port}/dorkfi-opportunities-latest.json`,
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
