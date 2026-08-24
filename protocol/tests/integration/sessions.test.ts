import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../../src/app.js";
import {
  MemorySessionStore,
  newSessionRecord,
  resetSessionStoreForTests,
  setSessionStoreForTests
} from "../../src/services/session-store.js";

test.afterEach(() => {
  resetSessionStoreForTests();
});

test("POST /sessions mints a receipt with remaining N/M", async () => {
  const store = new MemorySessionStore();
  setSessionStoreForTests(store);
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "POST",
    url: "/sessions"
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: { sessionId: string; uri: string; remaining: { research: number; quotes: number } };
    meta: { receiptUri: string; access: string; paymentRequired: boolean };
  };
  assert.match(body.data.sessionId, /^csess_/);
  assert.equal(body.data.uri, `canix://session/${body.data.sessionId}`);
  assert.equal(body.meta.receiptUri, body.data.uri);
  assert.equal(body.meta.access, "session");
  assert.equal(body.meta.paymentRequired, true);
  assert.ok(body.data.remaining.research > 0);
  assert.ok(body.data.remaining.quotes > 0);

  await app.close();
});

test("GET /sessions/:sessionId returns remaining quota without the public indexer", async () => {
  const store = new MemorySessionStore();
  setSessionStoreForTests(store);
  const app = buildApp();
  await app.ready();

  const created = await app.inject({ method: "POST", url: "/sessions" });
  const sessionId = (created.json() as { data: { sessionId: string } }).data.sessionId;

  const response = await app.inject({
    method: "GET",
    url: `/sessions/${sessionId}`
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: { remaining: { research: number; quotes: number }; status: string };
    meta: { access: string; paymentRequired: boolean };
  };
  assert.equal(body.meta.access, "receipt");
  assert.equal(body.meta.paymentRequired, false);
  assert.equal(body.data.status, "active");
  assert.ok(body.data.remaining.research > 0);

  await app.close();
});

test("valid session header consumes research without a SESSION_* 402", async () => {
  const store = new MemorySessionStore();
  setSessionStoreForTests(store);
  const app = buildApp();
  await app.ready();

  const created = await store.create();
  assert.equal(created.ok, true);
  if (!created.ok) {
    await app.close();
    return;
  }

  const response = await app.inject({
    method: "GET",
    url: "/opportunities",
    headers: { "x-canix-session": created.receipt.sessionId }
  });

  assert.notEqual(response.statusCode, 402);
  assert.equal(response.headers["x-canix-session-remaining-research"], String(created.receipt.budget.research - 1));
  const receipt = await store.get(created.receipt.sessionId);
  assert.equal(receipt?.remaining.research, created.receipt.budget.research - 1);

  await app.close();
});

test("unknown session header fail-closes 402 SESSION_INVALID", async () => {
  setSessionStoreForTests(new MemorySessionStore());
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "GET",
    url: "/opportunities",
    headers: { "x-canix-session": "csess_unknown" }
  });
  assert.equal(response.statusCode, 402);
  assert.equal(response.json().error.code, "SESSION_INVALID");

  await app.close();
});

test("expired session header fail-closes 402 SESSION_EXPIRED", async () => {
  const store = new MemorySessionStore();
  const record = newSessionRecord(1_000);
  record.expiresAtMs = 1_500;
  store.put(record);
  setSessionStoreForTests(store);
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "GET",
    url: "/opportunities",
    headers: { "x-canix-session": record.sessionId }
  });
  assert.equal(response.statusCode, 402);
  assert.equal(response.json().error.code, "SESSION_EXPIRED");

  await app.close();
});

test("exhausted research quota fail-closes 402 SESSION_EXHAUSTED", async () => {
  const store = new MemorySessionStore();
  const record = newSessionRecord(Date.now());
  record.remainingResearch = 0;
  store.put(record);
  setSessionStoreForTests(store);
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "GET",
    url: "/opportunities",
    headers: { "x-canix-session": record.sessionId }
  });
  assert.equal(response.statusCode, 402);
  assert.equal(response.json().error.code, "SESSION_EXHAUSTED");

  await app.close();
});

test("one-shot paid routes still work without a session header", async () => {
  setSessionStoreForTests(new MemorySessionStore());
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "GET",
    url: "/opportunities"
  });
  assert.notEqual(response.json()?.error?.code?.startsWith?.("SESSION_"), true);
  if (response.statusCode === 402) {
    assert.notEqual(response.json().error?.code, "SESSION_INVALID");
    assert.notEqual(response.json().error?.code, "SESSION_EXPIRED");
    assert.notEqual(response.json().error?.code, "SESSION_EXHAUSTED");
  }

  await app.close();
});

test("POST /sessions/refresh resets quota in place", async () => {
  const store = new MemorySessionStore();
  setSessionStoreForTests(store);
  const app = buildApp();
  await app.ready();

  const created = await store.create();
  assert.equal(created.ok, true);
  if (!created.ok) {
    await app.close();
    return;
  }
  await store.consume(created.receipt.sessionId, "research");

  const response = await app.inject({
    method: "POST",
    url: "/sessions/refresh",
    headers: { "content-type": "application/json" },
    payload: { sessionId: created.receipt.sessionId }
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: { sessionId: string; remaining: { research: number }; consumed: { research: number } };
  };
  assert.equal(body.data.sessionId, created.receipt.sessionId);
  assert.equal(body.data.remaining.research, created.receipt.budget.research);
  assert.equal(body.data.consumed.research, 0);

  await app.close();
});

test("GET unknown session receipt fail-closes 402 SESSION_INVALID", async () => {
  setSessionStoreForTests(new MemorySessionStore());
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "GET",
    url: "/sessions/csess_missing"
  });
  assert.equal(response.statusCode, 402);
  assert.equal(response.json().error.code, "SESSION_INVALID");

  await app.close();
});

test("GET expired session receipt fail-closes 402 SESSION_EXPIRED", async () => {
  const store = new MemorySessionStore();
  const record = newSessionRecord(1_000);
  record.expiresAtMs = 1_500;
  store.put(record);
  setSessionStoreForTests(store);
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "GET",
    url: `/sessions/${record.sessionId}`
  });
  assert.equal(response.statusCode, 402);
  assert.equal(response.json().error.code, "SESSION_EXPIRED");

  await app.close();
});

test("GET exhausted-but-unexpired receipt returns 200 status exhausted", async () => {
  const store = new MemorySessionStore();
  const record = newSessionRecord(Date.now());
  record.remainingResearch = 0;
  record.remainingQuotes = 0;
  store.put(record);
  setSessionStoreForTests(store);
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "GET",
    url: `/sessions/${record.sessionId}`
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.status, "exhausted");

  await app.close();
});

test("valid session header consumes quotes on POST /plans without a SESSION_* 402", async () => {
  const store = new MemorySessionStore();
  setSessionStoreForTests(store);
  const app = buildApp();
  await app.ready();

  const created = await store.create();
  assert.equal(created.ok, true);
  if (!created.ok) {
    await app.close();
    return;
  }

  const response = await app.inject({
    method: "POST",
    url: "/plans",
    headers: {
      "content-type": "application/json",
      "x-canix-session": created.receipt.sessionId
    },
    payload: {}
  });
  assert.notEqual(response.statusCode, 402);
  assert.equal(
    response.headers["x-canix-session-remaining-quotes"],
    String(created.receipt.budget.quotes - 1)
  );
  const receipt = await store.get(created.receipt.sessionId);
  assert.equal(receipt?.remaining.quotes, created.receipt.budget.quotes - 1);
  assert.equal(receipt?.remaining.research, created.receipt.budget.research);

  await app.close();
});

test("unavailable session store fail-closes consume with 402 SESSION_UNAVAILABLE", async () => {
  setSessionStoreForTests({
    create: async () => ({ ok: false, reason: "unavailable" }),
    refresh: async () => ({ ok: false, reason: "unavailable" }),
    get: async () => null,
    consume: async () => ({ ok: false, reason: "unavailable" })
  });
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "GET",
    url: "/opportunities",
    headers: { "x-canix-session": "csess_any" }
  });
  assert.equal(response.statusCode, 402);
  assert.equal(response.json().error.code, "SESSION_UNAVAILABLE");

  await app.close();
});
