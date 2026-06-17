import assert from "node:assert/strict";
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

test("protocol route currently focuses on Tinyman and returns empty for Folks", async () => {
  const app = buildApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: "GET",
      url: "/protocols/folks-finance/opportunities?limit=10&offset=0"
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as { data: unknown[] };
    assert.equal(body.data.length, 0);
  } finally {
    await app.close();
  }
});

