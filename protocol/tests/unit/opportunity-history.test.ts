import assert from "node:assert/strict";
import test from "node:test";

import {
  attachHistoryStability,
  computeHistoryStability,
  historySnapshotsFromOpportunities,
  loadOpportunityHistory,
  parseHistoryWindow,
  recordOpportunitySnapshots,
  resetOpportunityHistoryForTests,
  setOpportunityHistoryPointsForTests,
  stabilityConstraintPenalty,
  STABILITY_HIGH_MAX_CV,
  useMemoryOpportunityHistoryForTests,
  windowSeconds
} from "../../src/services/opportunity-history.js";
import {
  isOpportunityHistoryCronEnabled,
  OPPORTUNITY_HISTORY_CRON_EXPRESSION
} from "../../src/jobs/opportunity-history-cron.js";
import {
  compareOpportunitiesByRiskThenYield,
  riskConstraintPenalty
} from "../../src/services/opportunity-risk.js";
import type { OpportunityHistoryPoint } from "../../src/types/opportunity-history-schema.js";
import type { OpportunityMarketRecord } from "../../src/types/opportunity.js";

test.beforeEach(() => {
  useMemoryOpportunityHistoryForTests();
});

test.afterEach(() => {
  resetOpportunityHistoryForTests();
});

function points(values: number[]): OpportunityHistoryPoint[] {
  return values.map((apy, index) => ({
    ts: new Date(Date.UTC(2026, 7, 1 + index, 12)).toISOString(),
    apy,
    tvlUsd: 1_000_000
  }));
}

function recentPoints(
  values: number[],
  nowMs = Date.now()
): OpportunityHistoryPoint[] {
  return values.map((apy, index) => ({
    ts: new Date(nowMs - (values.length - 1 - index) * 3_600_000).toISOString(),
    apy,
    tvlUsd: 1_000_000
  }));
}

function market(
  opportunityId: string,
  apy: number
): OpportunityMarketRecord {
  const now = new Date("2026-09-03T12:00:00.000Z");
  return {
    protocol: "tinyman",
    opportunityType: "lp",
    opportunityId,
    assetPair: "ALGO/USDC",
    apy,
    yieldBasis: "apy",
    tvlUsd: 1_000_000,
    sourceTimestamp: now.toISOString(),
    fetchedAt: now.toISOString()
  };
}

test("parseHistoryWindow accepts 1d/7d/30d and defaults empty to 30d", () => {
  assert.equal(parseHistoryWindow(undefined), "30d");
  assert.equal(parseHistoryWindow(""), "30d");
  assert.equal(parseHistoryWindow("1d"), "1d");
  assert.equal(parseHistoryWindow("7d"), "7d");
  assert.equal(parseHistoryWindow("30d"), "30d");
  assert.equal(parseHistoryWindow("90d"), undefined);
  assert.equal(windowSeconds("1d"), 86_400);
  assert.equal(windowSeconds("30d"), 86_400 * 30);
});

test("computeHistoryStability is unknown below 3 samples", () => {
  assert.deepEqual(computeHistoryStability([]), { bucket: "unknown", sampleCount: 0 });
  const one = computeHistoryStability(points([10]));
  assert.equal(one.bucket, "unknown");
  assert.equal(one.sampleCount, 1);
  assert.equal(one.apyMean, 10);
  const two = computeHistoryStability(points([10, 12]));
  assert.equal(two.bucket, "unknown");
  assert.equal(two.sampleCount, 2);
  assert.ok(two.apyStdev !== undefined);
});

test("computeHistoryStability maps APY coefficient of variation onto buckets", () => {
  const high = computeHistoryStability(points([10, 10.1, 9.9, 10.05]));
  assert.equal(high.bucket, "high");
  assert.ok((high.apyStdev ?? 0) / 10 <= STABILITY_HIGH_MAX_CV + 0.001);

  const medium = computeHistoryStability(points([10, 11, 9, 10.5]));
  assert.equal(medium.bucket, "medium");

  const low = computeHistoryStability(points([5, 20, 8, 25]));
  assert.equal(low.bucket, "low");
});

test("computeHistoryStability treats a zero-APY series as unknown, not high-stability", () => {
  const zero = computeHistoryStability(points([0, 0, 0, 0]));
  assert.equal(zero.bucket, "unknown");
  assert.equal(zero.apyMean, 0);
});

test("historySnapshotsFromOpportunities drops STAMM placeholder APY", () => {
  assert.deepEqual(
    historySnapshotsFromOpportunities([
      { protocol: "stamm", opportunityId: "3544790053:lp:1", apy: 0, tvlUsd: 9_684 },
      { protocol: "tinyman", opportunityId: "pool:lp", apy: 10, tvlUsd: 1_000 }
    ]),
    [{ opportunityId: "pool:lp", apy: 10, tvlUsd: 1_000 }]
  );
});

test("stabilityConstraintPenalty ranks volatile APY worse than a thin series", () => {
  assert.equal(stabilityConstraintPenalty("high"), 0);
  assert.equal(stabilityConstraintPenalty("medium"), 1);
  assert.equal(stabilityConstraintPenalty("unknown"), 1);
  assert.equal(stabilityConstraintPenalty("low"), 2);
  assert.equal(stabilityConstraintPenalty(undefined), 1);
});

test("risk ranking prefers stable APY over a higher volatile snapshot", () => {
  const now = new Date("2026-09-03T12:00:00.000Z");
  const stable: OpportunityMarketRecord = {
    protocol: "tinyman",
    opportunityType: "lp",
    opportunityId: "stable",
    assetPair: "ALGO/USDC",
    apy: 8,
    yieldBasis: "apy",
    tvlUsd: 1_000,
    sourceTimestamp: now.toISOString(),
    fetchedAt: now.toISOString(),
    risk: { confidence: "high", stability: "high", historySampleCount: 30, apyStdev: 0.1 }
  };
  const volatile: OpportunityMarketRecord = {
    ...stable,
    opportunityId: "volatile",
    apy: 40,
    risk: { confidence: "high", stability: "low", historySampleCount: 30, apyStdev: 12 }
  };
  assert.ok(riskConstraintPenalty(volatile.risk) > riskConstraintPenalty(stable.risk));
  assert.ok(compareOpportunitiesByRiskThenYield(stable, volatile, now) < 0);
});

test("setOpportunityHistoryPointsForTests stores a series for later loads", () => {
  setOpportunityHistoryPointsForTests("demo", points([10, 11, 12]));
  // Isolation: reset clears injected points.
  resetOpportunityHistoryForTests();
  setOpportunityHistoryPointsForTests("demo", []);
});

test("loadOpportunityHistory filters points to the requested window", async () => {
  const now = new Date("2026-09-03T12:00:00.000Z");
  setOpportunityHistoryPointsForTests("demo", [
    { ts: "2026-09-03T10:00:00.000Z", apy: 10, tvlUsd: 1 },
    { ts: "2026-08-20T10:00:00.000Z", apy: 9, tvlUsd: 1 },
    { ts: "2026-07-01T10:00:00.000Z", apy: 8, tvlUsd: 1 }
  ]);

  const day = await loadOpportunityHistory("demo", "1d", { now });
  assert.equal(day.points.length, 1);
  assert.equal(day.points[0]?.apy, 10);

  const month = await loadOpportunityHistory("demo", "30d", { now });
  assert.equal(month.points.length, 2);
});

test("recordOpportunitySnapshots keeps the first hourly bucket", async () => {
  const now = new Date("2026-09-03T12:30:00.000Z");
  const first = await recordOpportunitySnapshots(
    [{ opportunityId: "a", apy: 10, tvlUsd: 1 }],
    { now }
  );
  const second = await recordOpportunitySnapshots(
    [{ opportunityId: "a", apy: 99, tvlUsd: 2 }],
    { now }
  );
  assert.equal(first, 1);
  assert.equal(second, 0);
  const { points: series } = await loadOpportunityHistory("a", "1d", { now });
  assert.equal(series.length, 1);
  assert.equal(series[0]?.apy, 10);
});

test("attachHistoryStability omits empty series and stamps a low-stability signal", async () => {
  const row = market("volatile", 40);
  const [untouched] = await attachHistoryStability([row]);
  assert.equal(untouched.risk?.stability, undefined);

  setOpportunityHistoryPointsForTests("volatile", recentPoints([5, 20, 8, 25]));
  const [attached] = await attachHistoryStability([row]);
  assert.equal(attached.risk?.stability, "low");
  assert.equal(attached.risk?.historySampleCount, 4);
  assert.ok(typeof attached.risk?.apyStdev === "number");
});

test("opportunity history cron requires Redis and can be disabled", () => {
  assert.equal(OPPORTUNITY_HISTORY_CRON_EXPRESSION, "17 * * * *");
  assert.equal(isOpportunityHistoryCronEnabled({}), false);
  assert.equal(isOpportunityHistoryCronEnabled({ REDIS_URL: "redis://localhost:6379" }), true);
  assert.equal(
    isOpportunityHistoryCronEnabled({
      REDIS_URL: "redis://localhost:6379",
      OPPORTUNITY_HISTORY_DISABLED: "1"
    }),
    false
  );
});
