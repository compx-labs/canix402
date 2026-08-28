import assert from "node:assert/strict";
import test from "node:test";

import {
  createSessionStore,
  isMockedSessionReceipt,
  memorySessionStorage,
  MOCKED_SESSION_ID,
  WEBMCP_SESSION_STORAGE_KEY
} from "../src/lib/webmcp/session-store.ts";
import type { SessionReceipt } from "../src/lib/webmcp/types.ts";

function receipt(overrides: Partial<SessionReceipt> = {}): SessionReceipt {
  return {
    uri: "canix://session/csess_live",
    sessionId: "csess_live",
    createdAt: "2026-08-28T09:00:00.000Z",
    expiresAt: "2026-08-28T13:00:00.000Z",
    ttlSeconds: 14_400,
    budget: { research: 50, quotes: 10 },
    remaining: { research: 50, quotes: 10 },
    consumed: { research: 0, quotes: 0 },
    status: "active",
    ...overrides
  };
}

function mockedReceipt(): SessionReceipt {
  return receipt({
    uri: `canix://session/${MOCKED_SESSION_ID}`,
    sessionId: MOCKED_SESSION_ID
  });
}

test("mocked csess_demo leftover in storage is not restored as a paid session", () => {
  const storage = memorySessionStorage({
    [WEBMCP_SESSION_STORAGE_KEY]: JSON.stringify(mockedReceipt())
  });
  const store = createSessionStore(storage);
  assert.equal(store.get(), null);
  assert.equal(storage.getItem(WEBMCP_SESSION_STORAGE_KEY), null);
});

test("applying a mocked session stays in memory and does not persist", () => {
  const storage = memorySessionStorage();
  const store = createSessionStore(storage);
  const stored = store.set(mockedReceipt());
  assert.equal(stored.sessionId, MOCKED_SESSION_ID);
  assert.equal(store.get()?.sessionId, MOCKED_SESSION_ID);
  assert.equal(storage.getItem(WEBMCP_SESSION_STORAGE_KEY), null);
  assert.equal(isMockedSessionReceipt(store.get()), true);

  const reloaded = createSessionStore(storage);
  assert.equal(reloaded.get(), null);
});

test("paid receipts still persist across store instances", () => {
  const storage = memorySessionStorage();
  const store = createSessionStore(storage);
  store.set(receipt());
  assert.equal(createSessionStore(storage).get()?.sessionId, "csess_live");
});

test("clearing a mocked session blanks get() without leaving storage residue", () => {
  const storage = memorySessionStorage();
  const store = createSessionStore(storage);
  store.set(mockedReceipt());
  store.clear();
  assert.equal(store.get(), null);
  assert.equal(storage.getItem(WEBMCP_SESSION_STORAGE_KEY), null);
});
