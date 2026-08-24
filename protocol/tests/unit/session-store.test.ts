import assert from "node:assert/strict";
import test from "node:test";

import {
  MemorySessionStore,
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
