import assert from "node:assert/strict";
import { createServer, Server } from "node:http";
import test from "node:test";

import {
  fetchFolksFinanceOpportunities,
  normalizeFolksFinanceRecord
} from "../../src/adapters/index.js";
import { buildApp } from "../../src/app.js";

test("normalizeFolksFinanceRecord maps APY and TVL USD fields", () => {
  const record = normalizeFolksFinanceRecord(
    {
      id: "folks-market-1",
      marketName: "ALGO Lending",
      apy: "5.5",
      tvlUsd: "2500000",
      apr: "4.2",
      updatedAt: "2026-06-17T21:00:00.000Z",
      type: "lending"
    },
    "2026-06-17T21:05:00.000Z"
  );

  assert.ok(record);
  assert.equal(record?.protocol, "folks-finance");
  assert.equal(record?.opportunityType, "lending");
  assert.equal(record?.apy, 5.5);
  assert.equal(record?.tvlUsd, 2500000);
  assert.equal(record?.apr, 4.2);
});

test("normalizeFolksFinanceRecord drops rows without APY or TVL", () => {
  assert.equal(
    normalizeFolksFinanceRecord({
      id: "missing-apy",
      marketName: "ALGO Lending",
      apy: null,
      tvlUsd: 1000
    }),
    null
  );
  assert.equal(
    normalizeFolksFinanceRecord({
      id: "missing-tvl",
      marketName: "ALGO Lending",
      apy: 3.2,
      tvlUsd: null
    }),
    null
  );
});

test("fetchFolksFinanceOpportunities maps API payload and skips invalid records", async () => {
  process.env.FOLKS_FINANCE_API_BASE_URL = "http://mock.folks.local";

  try {
    const opportunities = await fetchFolksFinanceOpportunities(async () => {
      return {
        ok: true,
        json: async () => ({
          opportunities: [
            {
              id: "folks-good",
              marketName: "ALGO Lending",
              apy: 4.9,
              tvlUsd: 500000
            },
            {
              id: "folks-bad",
              marketName: "BAD",
              apy: null,
              tvlUsd: 20
            }
          ]
        })
      } as Response;
    });

    assert.equal(opportunities.length, 1);
    assert.equal(opportunities[0]?.opportunityId, "folks-good");
    assert.equal(opportunities[0]?.protocol, "folks-finance");
  } finally {
    delete process.env.FOLKS_FINANCE_API_BASE_URL;
  }
});

test("GET /protocols/folks-finance/opportunities returns Folks normalized data", async () => {
  const mockServer = await startFolksFinanceMockServer();
  process.env.FOLKS_FINANCE_API_BASE_URL = mockServer.baseUrl;

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
    assert.equal(body.data[0]?.opportunityId, "folks-good");
    assert.equal(body.data[0]?.apy, 4.9);
  } finally {
    await app.close();
    await mockServer.close();
    delete process.env.FOLKS_FINANCE_API_BASE_URL;
  }
});

interface FolksFinanceMockServer {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startFolksFinanceMockServer(): Promise<FolksFinanceMockServer> {
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/opportunities") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          opportunities: [
            {
              id: "folks-good",
              marketName: "ALGO Lending",
              apy: 4.9,
              tvlUsd: 500000
            }
          ]
        })
      );
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
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
    await closeServer(server);
    throw new Error("Failed to bind Folks Finance mock server.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => closeServer(server)
  };
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

