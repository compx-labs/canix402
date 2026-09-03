import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../../src/app.js";
import {
  resetOpportunityHistoryForTests,
  setOpportunityHistoryPointsForTests,
  useMemoryOpportunityHistoryForTests
} from "../../src/services/opportunity-history.js";

test.beforeEach(() => {
  useMemoryOpportunityHistoryForTests();
});

test.afterEach(() => {
  resetOpportunityHistoryForTests();
});

test("GET /opportunities/:id/history returns an empty series when no snapshots exist", async () => {
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "GET",
    url: "/opportunities/tinyman:pool:1002541853/history?window=30d"
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: {
      opportunityId: string;
      window: string;
      points: unknown[];
      stability: { bucket: string; sampleCount: number };
    };
    meta: { paymentRequired: boolean; snapshotCount: number; snapshotRetentionDays: number };
  };
  assert.equal(body.data.opportunityId, "tinyman:pool:1002541853");
  assert.equal(body.data.window, "30d");
  assert.deepEqual(body.data.points, []);
  assert.equal(body.data.stability.bucket, "unknown");
  assert.equal(body.data.stability.sampleCount, 0);
  assert.equal(body.meta.paymentRequired, true);
  assert.equal(body.meta.snapshotCount, 0);
  assert.equal(body.meta.snapshotRetentionDays, 30);

  await app.close();
});

test("GET /opportunities/:id/history returns injected snapshots and a stability signal", async () => {
  const nowMs = Date.now();
  setOpportunityHistoryPointsForTests("tinyman:pool:1002541853", [
    { ts: new Date(nowMs - 3 * 3_600_000).toISOString(), apy: 10, tvlUsd: 1_000_000 },
    { ts: new Date(nowMs - 2 * 3_600_000).toISOString(), apy: 10.2, tvlUsd: 1_010_000 },
    { ts: new Date(nowMs - 1 * 3_600_000).toISOString(), apy: 9.9, tvlUsd: 990_000 },
    { ts: new Date(nowMs).toISOString(), apy: 10.1, tvlUsd: 1_005_000 }
  ]);

  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "GET",
    url: "/opportunities/tinyman:pool:1002541853/history?window=30d"
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: {
      points: Array<{ ts: string; apy: number; tvlUsd: number }>;
      stability: { bucket: string; sampleCount: number; apyStdev?: number };
    };
    meta: { snapshotCount: number };
  };
  assert.equal(body.data.points.length, 4);
  assert.equal(body.data.stability.sampleCount, 4);
  assert.equal(body.data.stability.bucket, "high");
  assert.ok(typeof body.data.stability.apyStdev === "number");
  assert.equal(body.meta.snapshotCount, 4);

  await app.close();
});

test("GET /opportunities/:id/history rejects an invalid window", async () => {
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "GET",
    url: "/opportunities/tinyman:pool:1002541853/history?window=90d"
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "VALIDATION_ERROR");

  await app.close();
});
