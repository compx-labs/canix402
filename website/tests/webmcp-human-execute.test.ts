import assert from "node:assert/strict";
import test from "node:test";

import { executeCanixWebMcpToolValue } from "../src/lib/webmcp/execute.ts";
import { executeAsHuman } from "../src/lib/webmcp/human-execute.ts";
import { createSessionStore, memorySessionStorage } from "../src/lib/webmcp/session-store.ts";
import type { SessionReceipt } from "../src/lib/webmcp/types.ts";

function liveReceipt(overrides: Partial<SessionReceipt> = {}): SessionReceipt {
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 14_400 * 1000).toISOString();
  return {
    uri: "canix://session/csess_live",
    sessionId: "csess_live",
    createdAt,
    expiresAt,
    ttlSeconds: 14400,
    budget: { research: 50, quotes: 10 },
    remaining: { research: 50, quotes: 10 },
    consumed: { research: 0, quotes: 0 },
    status: "active",
    ...overrides
  };
}

test("human paid tool without a page session fails closed and does not fetch", async () => {
  const sessionStore = createSessionStore(memorySessionStorage());
  let fetched = false;
  const result = await executeAsHuman(
    "canix_list_opportunities",
    { limit: 3, paymentSignature: "should-never-send" },
    {
      gatewayBaseUrl: "https://gateway.example",
      sessionStore,
      fetchImpl: async () => {
        fetched = true;
        throw new Error("fetch should not run");
      }
    }
  );
  assert.equal(fetched, false);
  assert.equal((result as { error: string }).error, "SESSION_REQUIRED");
});

test("human execute uses the page session and never sends paymentSignature", async () => {
  const sessionStore = createSessionStore(memorySessionStorage());
  sessionStore.set(liveReceipt());
  let seenSignature = "";
  let seenSession = "";
  const result = await executeAsHuman(
    "canix_list_opportunities",
    { limit: 2, paymentSignature: "agent-oneshot" },
    {
      gatewayBaseUrl: "https://gateway.example",
      sessionStore,
      fetchImpl: async (_input, init) => {
        const headers = init?.headers as Record<string, string>;
        seenSignature = headers["PAYMENT-SIGNATURE"] ?? "";
        seenSession = headers["X-Canix-Session"] ?? "";
        return new Response(JSON.stringify({ data: [{ id: "opp-1" }] }), {
          status: 200,
          headers: {
            "x-canix-session-remaining-research": "49",
            "x-canix-session-remaining-quotes": "10",
            "x-canix-session-expires-at": "2026-08-28T13:00:00.000Z"
          }
        });
      }
    }
  );
  assert.equal(seenSignature, "");
  assert.equal(seenSession, "csess_live");
  assert.equal((result as { sessionQuota: { remainingResearch: number } }).sessionQuota.remainingResearch, 49);
  assert.equal(sessionStore.get()?.remaining.research, 49);
  assert.equal(sessionStore.get()?.remaining.quotes, 10);
});

test("human get_plan consumes quotes quota via the same execute path", async () => {
  const sessionStore = createSessionStore(memorySessionStorage());
  sessionStore.set(liveReceipt({ remaining: { research: 49, quotes: 10 } }));
  const result = await executeAsHuman(
    "canix_get_plan",
    {
      address: "A".repeat(58),
      budget: { assetId: 0, amount: "1000000" }
    },
    {
      gatewayBaseUrl: "https://gateway.example",
      sessionStore,
      fetchImpl: async (input, init) => {
        assert.equal(new URL(String(input)).pathname, "/plans");
        assert.equal(init?.method, "POST");
        const headers = init?.headers as Record<string, string>;
        assert.equal(headers["X-Canix-Session"], "csess_live");
        assert.equal(headers["PAYMENT-SIGNATURE"], undefined);
        return new Response(JSON.stringify({ data: { allocations: [] } }), {
          status: 200,
          headers: {
            "x-canix-session-remaining-research": "49",
            "x-canix-session-remaining-quotes": "9"
          }
        });
      }
    }
  );
  assert.equal((result as { sessionQuota: { remainingQuotes: number } }).sessionQuota.remainingQuotes, 9);
  assert.equal(sessionStore.get()?.remaining.quotes, 9);
});

test("human execute fail-closes when research quota is exhausted", async () => {
  const sessionStore = createSessionStore(memorySessionStorage());
  sessionStore.set(liveReceipt({ remaining: { research: 0, quotes: 10 }, status: "active" }));
  let fetched = false;
  const result = await executeAsHuman("canix_list_opportunities", {}, {
    gatewayBaseUrl: "https://gateway.example",
    sessionStore,
    fetchImpl: async () => {
      fetched = true;
      throw new Error("fetch should not run");
    }
  });
  assert.equal(fetched, false);
  assert.equal((result as { error: string }).error, "SESSION_EXHAUSTED");
});

test("human execute fail-closes when the gateway reports SESSION_EXPIRED", async () => {
  const sessionStore = createSessionStore(memorySessionStorage());
  sessionStore.set(liveReceipt());
  const result = await executeAsHuman("canix_list_opportunities", {}, {
    gatewayBaseUrl: "https://gateway.example",
    sessionStore,
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: { code: "SESSION_EXPIRED", message: "Session TTL elapsed." } }), {
        status: 402
      })
  });
  assert.equal((result as { error: string }).error, "SESSION_EXPIRED");
  assert.equal(sessionStore.get()?.status, "expired");
});

test("agent one-shot execute still sends PAYMENT-SIGNATURE without a session", async () => {
  let seenSignature = "";
  let seenSession = "";
  const result = await executeCanixWebMcpToolValue(
    "canix_list_opportunities",
    { paymentSignature: "sig-oneshot" },
    {
      gatewayBaseUrl: "https://gateway.example",
      fetchImpl: async (_input, init) => {
        const headers = init?.headers as Record<string, string>;
        seenSignature = headers["PAYMENT-SIGNATURE"] ?? "";
        seenSession = headers["X-Canix-Session"] ?? "";
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
    }
  );
  assert.equal(seenSignature, "sig-oneshot");
  assert.equal(seenSession, "");
  assert.equal((result as { mcpPayment: { required: boolean } }).mcpPayment.required, false);
});

test("humans cannot buy a session through per-request execute", async () => {
  const sessionStore = createSessionStore(memorySessionStorage());
  const result = await executeAsHuman("canix_create_session", { paymentSignature: "sig" }, {
    gatewayBaseUrl: "https://gateway.example",
    sessionStore,
    fetchImpl: async () => {
      throw new Error("fetch should not run");
    }
  });
  assert.equal((result as { error: string }).error, "HUMAN_CHECKOUT_REQUIRED");
});
