import assert from "node:assert/strict";
import test from "node:test";

import {
  MemorySessionStore,
  RedisSessionStore,
  newSessionRecord
} from "../../src/services/session-store.js";

test("memory session store creates a full research and quotes budget", async () => {
  const store = new MemorySessionStore();
  const created = await store.create(1_000);
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  assert.equal(created.receipt.status, "active");
  assert.equal(created.receipt.remaining.research, created.receipt.budget.research);
  assert.equal(created.receipt.remaining.quotes, created.receipt.budget.quotes);
  assert.match(created.receipt.uri, /^canix:\/\/session\//);
  assert.match(created.receipt.sessionId, /^csess_/);
});

test("memory session store consumes research and quotes independently", async () => {
  const store = new MemorySessionStore();
  const created = await store.create(1_000);
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  const research = await store.consume(created.receipt.sessionId, "research", 1_000);
  assert.equal(research.ok, true);
  if (!research.ok) {
    return;
  }
  assert.equal(research.receipt.remaining.research, created.receipt.budget.research - 1);
  assert.equal(research.receipt.remaining.quotes, created.receipt.budget.quotes);

  const quotes = await store.consume(created.receipt.sessionId, "quotes", 1_000);
  assert.equal(quotes.ok, true);
  if (!quotes.ok) {
    return;
  }
  assert.equal(quotes.receipt.remaining.quotes, created.receipt.budget.quotes - 1);
});

test("memory session store fail-closes on expiry", async () => {
  const store = new MemorySessionStore();
  const record = newSessionRecord(1_000);
  record.expiresAtMs = 1_500;
  store.put(record);
  const result = await store.consume(record.sessionId, "research", 2_000);
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.reason, "expired");
});

test("memory session store fail-closes when a bucket is exhausted", async () => {
  const store = new MemorySessionStore();
  const record = newSessionRecord(1_000);
  record.remainingResearch = 0;
  store.put(record);
  const result = await store.consume(record.sessionId, "research", 1_000);
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.reason, "exhausted");
  const quotes = await store.consume(record.sessionId, "quotes", 1_000);
  assert.equal(quotes.ok, true);
});

test("memory session store fail-closes on unknown receipts", async () => {
  const store = new MemorySessionStore();
  const result = await store.consume("csess_missing", "research", 1_000);
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.reason, "invalid");
});

test("memory session store refresh resets quota in place", async () => {
  const store = new MemorySessionStore();
  const created = await store.create(1_000);
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  await store.consume(created.receipt.sessionId, "research", 1_000);
  const refreshed = await store.refresh(created.receipt.sessionId, 2_000);
  assert.equal(refreshed.ok, true);
  if (!refreshed.ok) {
    return;
  }
  assert.equal(refreshed.receipt.sessionId, created.receipt.sessionId);
  assert.equal(refreshed.receipt.remaining.research, refreshed.receipt.budget.research);
  assert.equal(refreshed.receipt.consumed.research, 0);
});

test("memory session store refresh of an expired id mints a new receipt", async () => {
  const store = new MemorySessionStore();
  const record = newSessionRecord(1_000);
  record.expiresAtMs = 1_500;
  store.put(record);
  const refreshed = await store.refresh(record.sessionId, 2_000);
  assert.equal(refreshed.ok, true);
  if (!refreshed.ok) {
    return;
  }
  assert.notEqual(refreshed.receipt.sessionId, record.sessionId);
  assert.equal(refreshed.receipt.status, "active");
});

test("memory session store get fail-closes expired and unknown receipts", async () => {
  const store = new MemorySessionStore();
  const missing = await store.get("csess_missing", 1_000);
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.reason, "invalid");
  }

  const record = newSessionRecord(1_000);
  record.expiresAtMs = 1_500;
  store.put(record);
  const expired = await store.get(record.sessionId, 2_000);
  assert.equal(expired.ok, false);
  if (!expired.ok) {
    assert.equal(expired.reason, "expired");
  }
});

test("redis session store get maps missing client and errors to unavailable", async () => {
  const unavailable = new RedisSessionStore(undefined, () => null);
  const noClient = await unavailable.get("csess_any", 1_000);
  assert.equal(noClient.ok, false);
  if (!noClient.ok) {
    assert.equal(noClient.reason, "unavailable");
  }

  const throwing = new RedisSessionStore(undefined, () => ({
    get: async () => {
      throw new Error("redis down");
    },
    set: async () => {
      throw new Error("redis down");
    },
    eval: async () => {
      throw new Error("redis down");
    }
  }));
  const failed = await throwing.get("csess_any", 1_000);
  assert.equal(failed.ok, false);
  if (!failed.ok) {
    assert.equal(failed.reason, "unavailable");
  }
});

test("redis session store get distinguishes missing and expired records", async () => {
  const missing = new RedisSessionStore(undefined, () => ({
    get: async () => null,
    set: async () => "OK",
    eval: async () => ["missing"]
  }));
  const invalid = await missing.get("csess_missing", 1_000);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.reason, "invalid");
  }

  const record = newSessionRecord(1_000);
  record.expiresAtMs = 1_500;
  const expiredStore = new RedisSessionStore(undefined, () => ({
    get: async () => JSON.stringify(record),
    set: async () => "OK",
    eval: async () => ["expired"]
  }));
  const expired = await expiredStore.get(record.sessionId, 2_000);
  assert.equal(expired.ok, false);
  if (!expired.ok) {
    assert.equal(expired.reason, "expired");
  }
});

test("redis session store refresh uses eval and mints when missing", async () => {
  let evalCalled = false;
  const store = new RedisSessionStore(undefined, () => ({
    get: async () => null,
    set: async () => "OK",
    eval: async () => {
      evalCalled = true;
      return ["missing"];
    }
  }));
  const refreshed = await store.refresh("csess_old", 1_000);
  assert.equal(evalCalled, true);
  assert.equal(refreshed.ok, true);
  if (!refreshed.ok) {
    return;
  }
  assert.notEqual(refreshed.receipt.sessionId, "csess_old");
});

test("redis session store refresh resets in place via eval", async () => {
  const record = newSessionRecord(1_000);
  record.remainingResearch = 1;
  const store = new RedisSessionStore(undefined, () => ({
    get: async () => JSON.stringify(record),
    set: async () => "OK",
    eval: async () => [
      "ok",
      JSON.stringify({
        ...record,
        remainingResearch: record.budgetResearch,
        remainingQuotes: record.budgetQuotes
      })
    ]
  }));
  const refreshed = await store.refresh(record.sessionId, 2_000);
  assert.equal(refreshed.ok, true);
  if (!refreshed.ok) {
    return;
  }
  assert.equal(refreshed.receipt.sessionId, record.sessionId);
  assert.equal(refreshed.receipt.remaining.research, record.budgetResearch);
});

test("redis session store consume maps eval status", async () => {
  const store = new RedisSessionStore(undefined, () => ({
    get: async () => null,
    set: async () => "OK",
    eval: async () => ["exhausted"]
  }));
  const result = await store.consume("csess_any", "research", 1_000);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "exhausted");
  }
});
