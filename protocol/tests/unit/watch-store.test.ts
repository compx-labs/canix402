import assert from "node:assert/strict";
import test from "node:test";

import {
  MemoryWatchStore,
  mintWatchId,
  mintWatchSecret,
  newWatchRecord,
  resetWatchStoreForTests
} from "../../src/services/watch-store.js";

const ADDRESS = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";

test.afterEach(() => {
  resetWatchStoreForTests();
});

test("memory watch store creates a receipt with secret once", async () => {
  const store = new MemoryWatchStore();
  const created = await store.create(
    {
      address: ADDRESS,
      thresholds: { healthFactor: 1.2 },
      webhookUrl: "https://hooks.example/watch"
    },
    1_000
  );
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  assert.match(created.receipt.watchId, /^cwatch_/);
  assert.match(created.receipt.uri, /^canix:\/\/watch\//);
  assert.match(created.receipt.webhookSecret ?? "", /^wsec_/);
  assert.equal(created.receipt.status, "active");
  assert.equal(created.receipt.address, ADDRESS);

  const loaded = await store.get(created.receipt.watchId, 1_000);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }
  assert.equal(loaded.receipt.webhookSecret, undefined);
});

test("memory watch store fail-closes on unknown and expired receipts", async () => {
  const store = new MemoryWatchStore();
  const missing = await store.get("cwatch_missing", 1_000);
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.reason, "invalid");
  }

  const record = newWatchRecord(
    { address: ADDRESS, thresholds: { claimableUsd: 5 }, webhookUrl: null },
    1_000
  );
  record.expiresAtMs = 1_500;
  store.put(record);
  const expired = await store.get(record.watchId, 2_000);
  assert.equal(expired.ok, false);
  if (!expired.ok) {
    assert.equal(expired.reason, "expired");
  }
});

test("memory watch store refresh extends TTL and optional secret rotation", async () => {
  const store = new MemoryWatchStore();
  const created = await store.create(
    { address: ADDRESS, thresholds: { apyDropBps: 50 }, webhookUrl: null },
    1_000
  );
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  const originalSecret = created.receipt.webhookSecret;
  const refreshed = await store.refresh(created.receipt.watchId, {}, 2_000);
  assert.equal(refreshed.ok, true);
  if (!refreshed.ok) {
    return;
  }
  assert.equal(refreshed.receipt.webhookSecret, undefined);
  assert.ok(new Date(refreshed.receipt.expiresAt).getTime() > 2_000);

  const rotated = await store.refresh(created.receipt.watchId, { rotateSecret: true }, 3_000);
  assert.equal(rotated.ok, true);
  if (!rotated.ok) {
    return;
  }
  assert.ok(rotated.receipt.webhookSecret);
  assert.notEqual(rotated.receipt.webhookSecret, originalSecret);
});

test("memory watch store rotate requires the current secret", async () => {
  const store = new MemoryWatchStore();
  const created = await store.create(
    { address: ADDRESS, thresholds: { retiCapacity: true }, webhookUrl: null },
    1_000
  );
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  const denied = await store.rotateSecret(created.receipt.watchId, mintWatchSecret(), 1_000);
  assert.equal(denied.ok, false);
  if (!denied.ok) {
    assert.equal(denied.reason, "unauthorized");
  }
  const rotated = await store.rotateSecret(
    created.receipt.watchId,
    created.receipt.webhookSecret ?? "",
    1_000
  );
  assert.equal(rotated.ok, true);
  if (!rotated.ok) {
    return;
  }
  assert.ok(rotated.receipt.webhookSecret);
  assert.notEqual(rotated.receipt.webhookSecret, created.receipt.webhookSecret);
});

test("memory watch store listActive skips expired rows", async () => {
  const store = new MemoryWatchStore();
  const live = await store.create(
    { address: ADDRESS, thresholds: { healthFactor: 1.1 }, webhookUrl: null },
    1_000
  );
  assert.equal(live.ok, true);
  const expired = newWatchRecord(
    { address: ADDRESS, thresholds: { healthFactor: 1.1 }, webhookUrl: null },
    1
  );
  expired.watchId = mintWatchId();
  expired.expiresAtMs = 500;
  store.put(expired);
  const active = await store.listActive(1_000);
  assert.equal(active.length, 1);
  if (live.ok) {
    assert.equal(active[0]?.watchId, live.receipt.watchId);
  }
});
