import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../../src/app.js";
import { runWatchPoll } from "../../src/services/watch-poll.js";
import { setWatchSnapshotLoaderForTests } from "../../src/services/watch-evaluate.js";
import {
  MemoryWatchStore,
  resetWatchStoreForTests,
  setWatchStoreForTests
} from "../../src/services/watch-store.js";
import {
  verifyWatchSignature,
  WATCH_IDEMPOTENCY_HEADER,
  WATCH_SIGNATURE_HEADER
} from "../../src/services/watch-webhook.js";
import type { WatchWebhookDelivery } from "../../src/services/watch-webhook.js";

const ADDRESS = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";

test.afterEach(() => {
  resetWatchStoreForTests();
  setWatchSnapshotLoaderForTests(undefined);
});

test("POST /watch registers a walletless retainer and returns the secret once", async () => {
  const store = new MemoryWatchStore();
  setWatchStoreForTests(store);
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "POST",
    url: "/watch",
    payload: {
      address: ADDRESS,
      thresholds: { healthFactor: 1.25, claimableUsd: 8 },
      webhookUrl: "https://hooks.example/canix"
    }
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: {
      watchId: string;
      webhookSecret?: string;
      address: string;
      thresholds: { healthFactor: number };
    };
    meta: { secretShown: boolean; receiptUri: string; paymentRequired: boolean };
  };
  assert.match(body.data.watchId, /^cwatch_/);
  assert.match(body.data.webhookSecret ?? "", /^wsec_/);
  assert.equal(body.meta.secretShown, true);
  assert.equal(body.meta.paymentRequired, true);
  assert.equal(body.data.address, ADDRESS);

  const receipt = await app.inject({
    method: "GET",
    url: `/watch/${body.data.watchId}`
  });
  assert.equal(receipt.statusCode, 200);
  const receiptBody = receipt.json() as { data: { webhookSecret?: string }; meta: { secretShown: boolean } };
  assert.equal(receiptBody.data.webhookSecret, undefined);
  assert.equal(receiptBody.meta.secretShown, false);

  await app.close();
});

test("POST /watch rejects invalid addresses and non-https webhooks", async () => {
  setWatchStoreForTests(new MemoryWatchStore());
  const app = buildApp();
  await app.ready();

  const badAddress = await app.inject({
    method: "POST",
    url: "/watch",
    payload: { address: "not-an-address", thresholds: { healthFactor: 1.2 } }
  });
  assert.equal(badAddress.statusCode, 400);

  const badWebhook = await app.inject({
    method: "POST",
    url: "/watch",
    payload: {
      address: ADDRESS,
      thresholds: { healthFactor: 1.2 },
      webhookUrl: "http://evil.example/hook"
    }
  });
  assert.equal(badWebhook.statusCode, 400);

  await app.close();
});

test("GET /watch/:id fail-closes unknown receipts without leaking a secret", async () => {
  setWatchStoreForTests(new MemoryWatchStore());
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "GET",
    url: "/watch/cwatch_missing"
  });
  assert.equal(response.statusCode, 402);
  assert.equal(response.json().error.code, "WATCH_INVALID");

  await app.close();
});

test("rotate-secret requires the current HMAC secret", async () => {
  const store = new MemoryWatchStore();
  setWatchStoreForTests(store);
  const app = buildApp();
  await app.ready();

  const created = await app.inject({
    method: "POST",
    url: "/watch",
    payload: { address: ADDRESS, thresholds: { apyDropBps: 25 } }
  });
  const watchId = (created.json() as { data: { watchId: string; webhookSecret: string } }).data
    .watchId;
  const secret = (created.json() as { data: { webhookSecret: string } }).data.webhookSecret;

  const denied = await app.inject({
    method: "POST",
    url: `/watch/${watchId}/rotate-secret`,
    headers: { "x-canix-watch-secret": "wsec_wrong" }
  });
  assert.equal(denied.statusCode, 402);
  assert.equal(denied.json().error.code, "WATCH_UNAUTHORIZED");

  const rotated = await app.inject({
    method: "POST",
    url: `/watch/${watchId}/rotate-secret`,
    headers: { "x-canix-watch-secret": secret }
  });
  assert.equal(rotated.statusCode, 200);
  const newSecret = (rotated.json() as { data: { webhookSecret: string } }).data.webhookSecret;
  assert.ok(newSecret);
  assert.notEqual(newSecret, secret);

  await app.close();
});

test("watch poll fires a signed idempotent webhook on a health-factor crossing", async () => {
  const store = new MemoryWatchStore();
  setWatchStoreForTests(store);
  const created = await store.create({
    address: ADDRESS,
    thresholds: { healthFactor: 1.4 },
    webhookUrl: "https://hooks.example/canix"
  });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  const secret = created.receipt.webhookSecret ?? "";
  const deliveries: WatchWebhookDelivery[] = [];

  setWatchSnapshotLoaderForTests(async () => ({
    healthFactor: 1.1,
    claimableUsd: 0,
    opportunities: []
  }));

  const first = await runWatchPoll({
    nowMs: Date.now(),
    postWebhook: async (delivery) => {
      deliveries.push(delivery);
      return { ok: true, status: 200 };
    }
  });
  assert.equal(first.fired, 1);
  assert.equal(first.delivered, 1);
  assert.equal(deliveries.length, 1);
  const delivery = deliveries[0]!;
  assert.equal(
    verifyWatchSignature(secret, delivery.body, delivery.headers[WATCH_SIGNATURE_HEADER]),
    true
  );
  assert.ok(delivery.headers[WATCH_IDEMPOTENCY_HEADER]);
  const payload = JSON.parse(delivery.body) as { kind: string; address: string };
  assert.equal(payload.kind, "healthFactor");
  assert.equal(payload.address, ADDRESS);

  const second = await runWatchPoll({
    nowMs: Date.now() + 1_000,
    postWebhook: async (delivery) => {
      deliveries.push(delivery);
      return { ok: true, status: 200 };
    }
  });
  assert.equal(second.fired, 0);
  assert.equal(deliveries.length, 1);
});

test("watch poll stores firings on the receipt when no webhook is configured", async () => {
  const store = new MemoryWatchStore();
  setWatchStoreForTests(store);
  const created = await store.create({
    address: ADDRESS,
    thresholds: { claimableUsd: 5 },
    webhookUrl: null
  });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }

  setWatchSnapshotLoaderForTests(async () => ({
    healthFactor: null,
    claimableUsd: 9,
    opportunities: []
  }));

  const summary = await runWatchPoll({ nowMs: Date.now() });
  assert.equal(summary.fired, 1);
  assert.equal(summary.stored, 1);

  const receipt = await store.get(created.receipt.watchId);
  assert.equal(receipt.ok, true);
  if (!receipt.ok) {
    return;
  }
  assert.equal(receipt.receipt.firings.length, 1);
  assert.equal(receipt.receipt.firings[0]?.deliveryStatus, "stored");
  assert.equal(receipt.receipt.firings[0]?.idempotencyKey.startsWith("wfire_"), true);
});
