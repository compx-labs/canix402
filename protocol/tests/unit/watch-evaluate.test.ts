import assert from "node:assert/strict";
import test from "node:test";

import { evaluateWatchThresholds } from "../../src/services/watch-evaluate.js";
import {
  signWatchBody,
  validateWebhookUrl,
  verifyWatchSignature
} from "../../src/services/watch-webhook.js";
import type { WatchSnapshot } from "../../src/services/watch-evaluate.js";

const WATCH_ID = "cwatch_test";

function snapshot(partial: Partial<WatchSnapshot> = {}): WatchSnapshot {
  return {
    healthFactor: null,
    claimableUsd: null,
    opportunities: [],
    ...partial
  };
}

test("health factor fires on crossing below threshold and not while remaining below", () => {
  const first = evaluateWatchThresholds(
    WATCH_ID,
    { healthFactor: 1.5 },
    {},
    snapshot({ healthFactor: 1.1 }),
    1_000
  );
  assert.equal(first.firings.length, 1);
  assert.equal(first.firings[0]?.kind, "healthFactor");
  assert.equal(first.firings[0]?.current, 1.1);
  assert.match(first.firings[0]?.idempotencyKey ?? "", /^wfire_cwatch_test_healthFactor_/);

  const stillLow = evaluateWatchThresholds(
    WATCH_ID,
    { healthFactor: 1.5 },
    first.nextSnapshot,
    snapshot({ healthFactor: 1.0 }),
    2_000
  );
  assert.equal(stillLow.firings.length, 0);

  const recovered = evaluateWatchThresholds(
    WATCH_ID,
    { healthFactor: 1.5 },
    stillLow.nextSnapshot,
    snapshot({ healthFactor: 1.8 }),
    3_000
  );
  assert.equal(recovered.firings.length, 0);
  assert.equal(recovered.nextSnapshot.healthFactorEpisodeId, null);

  const recross = evaluateWatchThresholds(
    WATCH_ID,
    { healthFactor: 1.5 },
    recovered.nextSnapshot,
    snapshot({ healthFactor: 1.2 }),
    4_000
  );
  assert.equal(recross.firings.length, 1);
  assert.notEqual(recross.firings[0]?.idempotencyKey, first.firings[0]?.idempotencyKey);
});

test("claimable USD fires on crossing at or above threshold", () => {
  const first = evaluateWatchThresholds(
    WATCH_ID,
    { claimableUsd: 10 },
    {},
    snapshot({ claimableUsd: 12 }),
    1_000
  );
  assert.equal(first.firings.length, 1);
  assert.equal(first.firings[0]?.kind, "claimableUsd");

  const stillHigh = evaluateWatchThresholds(
    WATCH_ID,
    { claimableUsd: 10 },
    first.nextSnapshot,
    snapshot({ claimableUsd: 15 }),
    2_000
  );
  assert.equal(stillHigh.firings.length, 0);
});

test("APY drop fires only when the drop meets the bps threshold", () => {
  const previous = evaluateWatchThresholds(
    WATCH_ID,
    { apyDropBps: 100 },
    {},
    snapshot({
      opportunities: [{ opportunityId: "reti-1", protocol: "reti", apy: 12 }]
    }),
    1_000
  );
  assert.equal(previous.firings.length, 0);

  const dropped = evaluateWatchThresholds(
    WATCH_ID,
    { apyDropBps: 100 },
    previous.nextSnapshot,
    snapshot({
      opportunities: [{ opportunityId: "reti-1", protocol: "reti", apy: 10.9 }]
    }),
    2_000
  );
  assert.equal(dropped.firings.length, 1);
  assert.equal(dropped.firings[0]?.kind, "apyDrop");
  assert.equal(dropped.firings[0]?.opportunityId, "reti-1");

  const sameKey = evaluateWatchThresholds(
    WATCH_ID,
    { apyDropBps: 100 },
    previous.nextSnapshot,
    snapshot({
      opportunities: [{ opportunityId: "reti-1", protocol: "reti", apy: 10.9 }]
    }),
    3_000
  );
  assert.equal(sameKey.firings[0]?.idempotencyKey, dropped.firings[0]?.idempotencyKey);
});

test("Réti capacity fires when a venue stops accepting stake", () => {
  const open = evaluateWatchThresholds(
    WATCH_ID,
    { retiCapacity: true },
    {},
    snapshot({
      opportunities: [
        {
          opportunityId: "reti-12",
          protocol: "reti",
          apy: 8,
          capacity: {
            acceptingStake: true,
            stakerSlotsRemaining: 4,
            algoRoomMicroAlgos: "1000000"
          }
        }
      ]
    }),
    1_000
  );
  assert.equal(open.firings.length, 0);

  const full = evaluateWatchThresholds(
    WATCH_ID,
    { retiCapacity: true },
    open.nextSnapshot,
    snapshot({
      opportunities: [
        {
          opportunityId: "reti-12",
          protocol: "reti",
          apy: 8,
          capacity: {
            acceptingStake: false,
            stakerSlotsRemaining: 0,
            algoRoomMicroAlgos: "0"
          }
        }
      ]
    }),
    2_000
  );
  assert.equal(full.firings.length, 1);
  assert.equal(full.firings[0]?.kind, "retiCapacity");
  assert.equal(full.firings[0]?.opportunityId, "reti-12");
});

test("webhook signatures verify and reject tampering", () => {
  const secret = "wsec_test";
  const body = JSON.stringify({ watchId: WATCH_ID, kind: "healthFactor" });
  const signature = signWatchBody(secret, body);
  assert.equal(verifyWatchSignature(secret, body, signature), true);
  assert.equal(verifyWatchSignature(secret, `${body} `, signature), false);
  assert.equal(verifyWatchSignature("other", body, signature), false);
});

test("webhook URL validation allows localhost http only outside production", () => {
  assert.equal(validateWebhookUrl("https://hooks.example/watch"), null);
  assert.equal(
    validateWebhookUrl("http://127.0.0.1:9999/hook", { NODE_ENV: "test" }),
    null
  );
  assert.ok(validateWebhookUrl("http://evil.example/hook"));
  assert.ok(validateWebhookUrl("https://127.0.0.1/hook", { NODE_ENV: "production" }));
  assert.ok(validateWebhookUrl("javascript:alert(1)"));
});
