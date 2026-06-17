import assert from "node:assert/strict";
import test from "node:test";

import { fetchPactOpportunities, normalizePactPool } from "../../src/adapters/index.js";
import { buildApp } from "../../src/app.js";

test("normalizePactPool maps APY and TVL USD fields", () => {
  const record = normalizePactPool(
    {
      id: "pact-pool-1",
      pairName: "ALGO/USDC",
      apy: "8.75",
      tvlUsd: "950000",
      apr: "6.2",
      updatedAt: "2026-06-17T21:00:00.000Z",
      type: "lp"
    },
    "2026-06-17T21:05:00.000Z"
  );

  assert.ok(record);
  assert.equal(record?.protocol, "pact");
  assert.equal(record?.apy, 8.75);
  assert.equal(record?.tvlUsd, 950000);
  assert.equal(record?.apr, 6.2);
});

test("normalizePactPool drops invalid APY/TVL rows", () => {
  assert.equal(
    normalizePactPool({
      id: "bad-1",
      pairName: "ALGO/USDC",
      apy: null,
      tvlUsd: 100
    }),
    null
  );

  assert.equal(
    normalizePactPool({
      id: "bad-2",
      pairName: "ALGO/USDC",
      apy: 10,
      tvlUsd: null
    }),
    null
  );
});

test("fetchPactOpportunities maps API payload and skips invalid records", async () => {
  process.env.PACT_API_BASE_URL = "http://mock.pact.local";

  try {
    const opportunities = await fetchPactOpportunities(async () => {
      return {
        ok: true,
        json: async () => ({
          pools: [
            {
              id: "pact-good",
              pairName: "ALGO/USDC",
              apy: 7.2,
              tvlUsd: 320000
            },
            {
              id: "pact-bad",
              pairName: "BAD/USDC",
              apy: null,
              tvlUsd: 10
            }
          ]
        })
      } as Response;
    });

    assert.equal(opportunities.length, 1);
    assert.equal(opportunities[0]?.opportunityId, "pact-good");
    assert.equal(opportunities[0]?.protocol, "pact");
  } finally {
    delete process.env.PACT_API_BASE_URL;
  }
});

test("protocol route currently focuses on Tinyman and returns empty for Pact", async () => {
  const app = buildApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: "GET",
      url: "/protocols/pact/opportunities?limit=10&offset=0"
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as { data: unknown[] };
    assert.equal(body.data.length, 0);
  } finally {
    await app.close();
  }
});

