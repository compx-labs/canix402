import assert from "node:assert/strict";
import { createServer, Server } from "node:http";
import test from "node:test";

import { buildApp } from "../../src/app.js";

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
  const mockServer = await startFolksFinanceMockServer();
  process.env.FOLKS_FINANCE_API_BASE_URL = mockServer.baseUrl;

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
      ["folks-lending-match"]
    );
    assert.equal(body.data[0]?.protocol, "folks-finance");
    assert.equal(body.data[0]?.opportunityType, "lending");
    assert.equal(body.data[0]?.apy, 8.5);
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
              id: "folks-lending-match",
              marketName: "ALGO Lending",
              type: "lending",
              apy: 8.5,
              tvlUsd: 250000
            },
            {
              id: "folks-lending-too-high",
              marketName: "ALGO Lending 2",
              type: "lending",
              apy: 12.2,
              tvlUsd: 400000
            },
            {
              id: "folks-lp-wrong-type",
              marketName: "USDC/ALGO LP",
              type: "lp",
              apy: 6.1,
              tvlUsd: 500000
            },
            {
              id: "folks-lending-low-tvl",
              marketName: "ALGO Lending 3",
              type: "lending",
              apy: 7.1,
              tvlUsd: 50000
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
