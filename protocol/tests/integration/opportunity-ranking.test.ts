import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../../src/app.js";
import { rankOpportunitiesByApy } from "../../src/services/opportunity-ranking.js";
import { OpportunityRecordV1 } from "../../src/types/opportunity.js";

test("rankOpportunitiesByApy sorts by APY descending then TVL descending", () => {
  const ranked = rankOpportunitiesByApy([
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
    await app.close();
  }
});

test("protocol opportunities default to top 25", async () => {
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
    await app.close();
  }
});

function opportunity(
  opportunityId: string,
  apy: number,
  tvlUsd: number
): OpportunityRecordV1 {
  return {
    protocol: "tinyman",
    opportunityType: "lp",
    opportunityId,
    assetPair: "ALGO/USDC",
    apy,
    tvlUsd,
    sourceTimestamp: "2026-06-18T00:00:00.000Z",
    fetchedAt: "2026-06-18T00:00:00.000Z"
  };
}
