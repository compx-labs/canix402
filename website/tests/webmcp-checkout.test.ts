import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import { buyPrepaidSession, refreshSessionRemaining } from "../src/lib/webmcp/checkout.ts";
import { executeCanixWebMcpToolValue } from "../src/lib/webmcp/execute.ts";
import { createSessionStore, memorySessionStorage } from "../src/lib/webmcp/session-store.ts";
import {
  assemblePaymentSignature,
  buildUnsignedPaymentGroup,
  selectPaymentAccept
} from "../src/lib/webmcp/x402-wallet-payment.ts";
import type { PaymentRequest } from "../src/lib/webmcp/payment.ts";

const sender = algosdk.generateAccount();
const payTo = algosdk.generateAccount();
const feePayer = algosdk.generateAccount();

const suggestedParams = {
  fee: 1000,
  firstValid: 1_000,
  lastValid: 2_000,
  genesisHash: new Uint8Array(32),
  genesisID: "test-v1.0",
  minFee: 1000,
  flatFee: true
};

function paymentRequired(extra?: Record<string, unknown>): PaymentRequest {
  return {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: "test-network",
        asset: "1",
        payTo: payTo.addr.toString(),
        maxAmountRequired: "250000",
        ...(extra ? { extra } : {})
      }
    ],
    resource: { url: "https://gateway.example/sessions" }
  };
}

function receiptBody(remaining = { research: 50, quotes: 10 }) {
  return {
    data: {
      uri: "canix://session/csess_live",
      sessionId: "csess_live",
      createdAt: "2026-08-28T09:00:00.000Z",
      expiresAt: "2026-08-28T13:00:00.000Z",
      ttlSeconds: 14400,
      budget: { research: 50, quotes: 10 },
      remaining,
      consumed: {
        research: 50 - remaining.research,
        quotes: 10 - remaining.quotes
      },
      status: "active"
    },
    meta: {
      paymentRequired: true,
      access: "session",
      receiptUri: "canix://session/csess_live"
    }
  };
}

test("unsigned payment group is a single ASA transfer without feePayer", () => {
  const accepted = selectPaymentAccept(paymentRequired());
  assert.equal("error" in accepted, false);
  const group = buildUnsignedPaymentGroup({
    sender: sender.addr.toString(),
    accepted: accepted as Exclude<typeof accepted, { error: string }>,
    suggestedParams
  });
  assert.equal("error" in group, false);
  if ("error" in group) {
    return;
  }
  assert.equal(group.paymentIndex, 0);
  assert.equal(group.encodedTransactions.length, 1);
});

test("unsigned payment group keeps fee-payer tx unsigned (index 1)", () => {
  const accepted = selectPaymentAccept(paymentRequired({ feePayer: feePayer.addr.toString() }));
  assert.equal("error" in accepted, false);
  const group = buildUnsignedPaymentGroup({
    sender: sender.addr.toString(),
    accepted: accepted as Exclude<typeof accepted, { error: string }>,
    suggestedParams
  });
  assert.equal("error" in group, false);
  if ("error" in group) {
    return;
  }
  assert.equal(group.paymentIndex, 1);
  assert.equal(group.encodedTransactions.length, 2);
});

test("assemblePaymentSignature fails closed when the user txn is unsigned", () => {
  const required = paymentRequired();
  const accepted = selectPaymentAccept(required);
  assert.equal("error" in accepted, false);
  if ("error" in accepted) {
    return;
  }
  const group = buildUnsignedPaymentGroup({
    sender: sender.addr.toString(),
    accepted,
    suggestedParams
  });
  if ("error" in group) {
    assert.fail(group.message);
    return;
  }
  assert.throws(
    () =>
      assemblePaymentSignature({
        paymentRequired: required,
        accepted,
        encodedUnsigned: group.encodedTransactions,
        signedTransactions: [null],
        paymentIndex: 0
      }),
    /did not sign/
  );
});

test("mocked session checkout persists remaining N/M without live x402", async () => {
  const sessionStore = createSessionStore(memorySessionStorage());
  let calls = 0;
  const result = await buyPrepaidSession({
    gatewayBaseUrl: "https://gateway.example",
    sender: sender.addr.toString(),
    sessionStore,
    fetchSuggestedParams: async () => suggestedParams,
    signTransactions: async (group) => group.map(() => new Uint8Array([1, 2, 3, 4])),
    execute: async (name, rawArgs) => {
      calls += 1;
      assert.equal(name, "canix_create_session");
      const args = rawArgs as Record<string, unknown>;
      assert.equal("sessionReceipt" in args && args.sessionReceipt, false);
      if (!args.paymentSignature) {
        return {
          error: "PAYMENT_REQUIRED",
          message: "pay",
          mcpPayment: { required: true, paymentRequired: paymentRequired() }
        };
      }
      assert.equal(typeof args.paymentSignature, "string");
      assert.ok(String(args.paymentSignature).length > 0);
      return receiptBody();
    }
  });

  assert.equal(calls, 2);
  assert.equal((result as { error?: string }).error, undefined);
  const stored = sessionStore.get();
  assert.ok(stored);
  assert.equal(stored.sessionId, "csess_live");
  assert.equal(stored.remaining.research, 50);
  assert.equal(stored.remaining.quotes, 10);
  assert.equal((result as { sessionQuota: { remainingResearch: number } }).sessionQuota.remainingResearch, 50);
});

test("checkout fail-closed on wallet rejection", async () => {
  const sessionStore = createSessionStore(memorySessionStorage());
  const result = await buyPrepaidSession({
    gatewayBaseUrl: "https://gateway.example",
    sender: sender.addr.toString(),
    sessionStore,
    fetchSuggestedParams: async () => suggestedParams,
    signTransactions: async () => {
      throw new Error("User rejected");
    },
    execute: async () => ({
      error: "PAYMENT_REQUIRED",
      mcpPayment: { required: true, paymentRequired: paymentRequired() }
    })
  });
  assert.equal((result as { error: string }).error, "PAYMENT_REJECTED");
  assert.equal(sessionStore.get(), null);
});

test("checkout fail-closed when paid retry is still 402", async () => {
  const sessionStore = createSessionStore(memorySessionStorage());
  const result = await buyPrepaidSession({
    gatewayBaseUrl: "https://gateway.example",
    sender: sender.addr.toString(),
    sessionStore,
    fetchSuggestedParams: async () => suggestedParams,
    signTransactions: async (group) => group.map(() => new Uint8Array([9])),
    execute: async () => ({
      error: "PAYMENT_REQUIRED",
      message: "still required",
      mcpPayment: { required: true, paymentRequired: paymentRequired() }
    })
  });
  assert.equal((result as { error: string }).error, "PAYMENT_FAILED");
  assert.equal(sessionStore.get(), null);
});

test("session consume headers surface remaining N/M on execute", async () => {
  const result = await executeCanixWebMcpToolValue(
    "canix_list_opportunities",
    { sessionReceipt: "csess_live" },
    {
      gatewayBaseUrl: "https://gateway.example",
      fetchImpl: async (_input, init) => {
        const headers = init?.headers as Record<string, string>;
        assert.equal(headers["X-Canix-Session"], "csess_live");
        assert.equal(headers["PAYMENT-SIGNATURE"], undefined);
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
  assert.deepEqual((result as { sessionQuota: { remainingResearch: number; remainingQuotes: number } }).sessionQuota, {
    remainingResearch: 49,
    remainingQuotes: 10,
    expiresAt: "2026-08-28T13:00:00.000Z"
  });
});

test("read remaining uses canix_get_session and fail-closes when expired", async () => {
  const sessionStore = createSessionStore(memorySessionStorage());
  sessionStore.set({
    uri: "canix://session/csess_live",
    sessionId: "csess_live",
    createdAt: "2026-08-28T09:00:00.000Z",
    expiresAt: "2026-08-28T13:00:00.000Z",
    ttlSeconds: 14400,
    budget: { research: 50, quotes: 10 },
    remaining: { research: 50, quotes: 10 },
    consumed: { research: 0, quotes: 0 },
    status: "active"
  });
  const expired = await refreshSessionRemaining({
    gatewayBaseUrl: "https://gateway.example",
    sessionStore,
    execute: async (name, args) => {
      assert.equal(name, "canix_get_session");
      assert.equal((args as { sessionId: string }).sessionId, "csess_live");
      return {
        error: "SESSION_EXPIRED",
        message: "Session TTL elapsed."
      };
    }
  });
  assert.equal((expired as { error: string }).error, "SESSION_EXPIRED");
  assert.equal(sessionStore.get()?.status, "expired");
});
