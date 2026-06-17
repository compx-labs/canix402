import assert from "node:assert/strict";
import { createServer, Server } from "node:http";
import test from "node:test";

import { fetchPactOpportunities, normalizePactPool } from "../../src/adapters/index.js";
import { buildApp } from "../../src/app.js";

test("normalizePactPool maps APY and TVL USD fields", () => {
  const record = normalizePactPool(
    {
      on_chain_id: "pact-pool-1",
      apr_7d_all: "8.75",
      apr_7d: "6.2",
      tvl_usd: "950000",
      primary_asset: { unit_name: "ALGO" },
      secondary_asset: { unit_name: "USDC" }
    },
    "2026-06-17T21:05:00.000Z"
  );

  assert.ok(record);
  assert.equal(record?.protocol, "pact");
  assert.equal(record?.opportunityType, "lp");
  assert.equal(record?.opportunityId, "pact-pool-1:lp");
  assert.equal(record?.apy, 8.75);
  assert.equal(record?.tvlUsd, 950000);
  assert.equal(record?.apr, 6.2);
  assert.equal(record?.assetPair, "ALGO/USDC");
});

test("normalizePactPool drops invalid APY/TVL rows", () => {
  assert.equal(
    normalizePactPool({
      on_chain_id: "bad-1",
      apr_7d_all: null,
      tvl_usd: 100
    }),
    null
  );

  assert.equal(
    normalizePactPool({
      on_chain_id: "bad-2",
      apr_7d_all: 10,
      tvl_usd: null
    }),
    null
  );
});

test("fetchPactOpportunities maps API payload and emits LP + farm records", async () => {
  process.env.PACT_API_BASE_URL = "http://mock.pact.local";

  try {
    const opportunities = await fetchPactOpportunities(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/pools/all")) {
        return {
          ok: true,
          json: async () => ([
            {
              on_chain_id: "pool-good",
              is_verified: true,
              apr_7d_all: 7.2,
              apr_7d: 6.8,
              tvl_usd: 320000,
              primary_asset: { unit_name: "ALGO" },
              secondary_asset: { unit_name: "USDC" }
            },
            {
              on_chain_id: "pool-unverified",
              is_verified: false,
              apr_7d_all: 11.1,
              apr_7d: 10.7,
              tvl_usd: 111,
              primary_asset: { unit_name: "BAD" },
              secondary_asset: { unit_name: "USDC" }
            }
          ])
        } as Response;
      }

      return {
        ok: true,
        json: async () => ([
          {
            on_chain_id: "farm-good",
            pool: "pool-good",
            apr: 0.12,
            average_apr: 0.14,
            tvl_usd: 300000
          }
        ])
      } as Response;
    });

    assert.equal(opportunities.length, 2);
    const lp = opportunities.find((opportunity) => opportunity.opportunityType === "lp");
    const farm = opportunities.find((opportunity) => opportunity.opportunityType === "farm");
    assert.ok(lp);
    assert.ok(farm);
    assert.equal(lp?.opportunityId, "pool-good:lp");
    assert.equal(farm?.opportunityId, "farm-good:farm");
    assert.equal(lp?.protocol, "pact");
    assert.equal(farm?.protocol, "pact");
    assert.equal(farm?.apy, 0.14);
    assert.equal(farm?.apr, 0.12);
  } finally {
    delete process.env.PACT_API_BASE_URL;
  }
});

test("GET /protocols/pact/opportunities returns Pact normalized LP and farm data", async () => {
  const mockServer = await startPactMockServer();
  process.env.PACT_API_BASE_URL = mockServer.baseUrl;
  process.env.PACT_ONLY_VERIFIED = "true";

  const app = buildApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: "GET",
      url: "/protocols/pact/opportunities?limit=10&offset=0"
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      data: Array<{ protocol: string; opportunityType: string; opportunityId: string }>;
    };
    assert.equal(body.data.length, 2);
    assert.equal(body.data[0]?.protocol, "pact");
    assert.equal(
      body.data.some((row) => row.opportunityType === "lp"),
      true
    );
    assert.equal(
      body.data.some((row) => row.opportunityType === "farm"),
      true
    );
    assert.equal(
      body.data.some((row) => row.opportunityId.endsWith(":lp")),
      true
    );
    assert.equal(
      body.data.some((row) => row.opportunityId.endsWith(":farm")),
      true
    );
  } finally {
    await app.close();
    await mockServer.close();
    delete process.env.PACT_API_BASE_URL;
    delete process.env.PACT_ONLY_VERIFIED;
  }
});

interface PactMockServer {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startPactMockServer(): Promise<PactMockServer> {
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/pools/all")) {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify([
          {
            on_chain_id: "123",
            is_verified: true,
            apr_7d_all: "0.15",
            apr_7d: "0.12",
            tvl_usd: "900000",
            primary_asset: { unit_name: "ALGO" },
            secondary_asset: { unit_name: "USDC" }
          }
        ])
      );
      return;
    }

    if (req.url?.startsWith("/farms/all")) {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify([
          {
            on_chain_id: "999",
            pool: "123",
            apr: "0.2",
            average_apr: "0.22",
            tvl_usd: "880000"
          }
        ])
      );
      return;
    }

    res.writeHead(404).end();
  });

  await listenOnRandomPort(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind Pact mock server.");
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

