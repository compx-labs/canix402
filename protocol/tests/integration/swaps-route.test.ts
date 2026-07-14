import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";

import {
  HaystackRouterError,
  createHaystackService,
  type HaystackService
} from "../../src/services/haystack-router.js";
import { registerSwapRoutes } from "../../src/routes/swaps.js";
import type { HaystackQuote } from "../../src/types/swap-schema.js";

const ADDRESS = "3Y2V6ODUVUGM4TXOEXY65YLMKMVLG4PB3GSOXDCJDE4X5YQA5JA3P2FHAQ";
const OTHER_ADDRESS = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";

function quote(overrides: Partial<HaystackQuote> = {}): HaystackQuote {
  return {
    address: ADDRESS,
    fromAssetId: "0",
    toAssetId: "31566704",
    amount: "1000000",
    type: "fixed-input",
    quotedAmount: "250000",
    createdAt: new Date(Date.now() - 1_000).toISOString(),
    expiresAt: new Date(Date.now() + 29_000).toISOString(),
    requiredAppOptIns: ["123"],
    txnPayload: { iv: "iv", data: "payload" },
    usdIn: 0.25,
    usdOut: 0.249,
    route: [],
    quotes: [],
    protocolFees: {},
    ...overrides
  };
}

function mockService(): HaystackService {
  return {
    async getQuote(input) {
      return quote({
        address: input.address,
        fromAssetId: String(input.fromAssetId),
        toAssetId: String(input.toAssetId),
        amount: String(input.amount),
        type: input.type ?? "fixed-input"
      });
    },
    async buildOptIns() {
      return {
        required: true,
        transactions: [
          {
            index: 0,
            kind: "asset-opt-in",
            encodedTransaction: "dHhu",
            signer: "user",
            assetId: "31566704"
          }
        ],
        userSignIndexes: [0],
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      };
    },
    async buildSwapTransactions() {
      return {
        transactions: [
          {
            index: 0,
            encodedTransaction: "dXNlcg==",
            signer: "user"
          },
          {
            index: 1,
            encodedTransaction: "cm91dGVy",
            signer: "haystack",
            signedTransaction: "c2lnbmVk"
          }
        ],
        userSignIndexes: [0],
        createdAt: new Date().toISOString(),
        quoteExpiresAt: new Date(Date.now() + 20_000).toISOString()
      };
    }
  };
}

async function createApp(service: HaystackService) {
  const app = Fastify();
  registerSwapRoutes(app, service);
  await app.ready();
  return app;
}

test("POST /swaps/quote returns a free serializable Haystack quote", async () => {
  const app = await createApp(mockService());
  const response = await app.inject({
    method: "POST",
    url: "/swaps/quote",
    payload: {
      address: ADDRESS,
      fromAssetId: 0,
      toAssetId: "31566704",
      amount: "1000000",
      type: "fixed-input"
    }
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json();
  assert.equal(payload.data.quotedAmount, "250000");
  assert.equal(payload.data.amount, "1000000");
  assert.equal(payload.meta.paymentRequired, false);
  assert.equal(payload.meta.executionSubmitted, false);
  await app.close();
});

test("POST /swaps/optin returns caller-signable prerequisite transactions", async () => {
  const app = await createApp(mockService());
  const response = await app.inject({
    method: "POST",
    url: "/swaps/optin",
    payload: { address: ADDRESS, quote: quote() }
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json();
  assert.equal(payload.data.required, true);
  assert.deepEqual(payload.data.userSignIndexes, [0]);
  assert.equal(payload.data.transactions[0].kind, "asset-opt-in");
  assert.equal(payload.meta.paymentRequired, false);
  await app.close();
});

test("POST /swaps/transactions preserves ordered signer metadata", async () => {
  const app = await createApp(mockService());
  const response = await app.inject({
    method: "POST",
    url: "/swaps/transactions",
    payload: { address: ADDRESS, quote: quote(), slippage: 1 }
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json();
  assert.deepEqual(payload.data.userSignIndexes, [0]);
  assert.equal(payload.data.transactions[0].signer, "user");
  assert.equal(payload.data.transactions[1].signer, "haystack");
  assert.equal(payload.data.transactions[1].signedTransaction, "c2lnbmVk");
  assert.equal(payload.meta.paymentRequired, true);
  assert.equal(payload.meta.executionSubmitted, false);
  await app.close();
});

test("Haystack route maps upstream rate limits without leaking upstream details", async () => {
  const service = mockService();
  service.getQuote = async () => {
    throw new HaystackRouterError("Haystack rate limit exceeded; retry later.", "rate-limit");
  };
  const app = await createApp(service);
  const response = await app.inject({
    method: "POST",
    url: "/swaps/quote",
    payload: {
      address: ADDRESS,
      fromAssetId: 0,
      toAssetId: 31566704,
      amount: 1
    }
  });

  assert.equal(response.statusCode, 429);
  assert.equal(response.json().error.message, "Haystack rate limit exceeded; retry later.");
  await app.close();
});

test("service rejects stale and address-mismatched quotes before upstream calls", async () => {
  const service = createHaystackService({ apiKey: "test-key" });

  await assert.rejects(
    service.buildSwapTransactions(
      ADDRESS,
      quote({ expiresAt: new Date(Date.now() - 1).toISOString() }),
      1
    ),
    /quote has expired/
  );
  await assert.rejects(
    service.buildOptIns(OTHER_ADDRESS, quote()),
    /different Algorand address/
  );
});

test("quote request validates amount, route depth, and slippage bounds", async () => {
  const app = await createApp(mockService());
  const badQuote = await app.inject({
    method: "POST",
    url: "/swaps/quote",
    payload: {
      address: ADDRESS,
      fromAssetId: 0,
      toAssetId: 31566704,
      amount: "0",
      maxDepth: 5
    }
  });
  const badSwap = await app.inject({
    method: "POST",
    url: "/swaps/transactions",
    payload: { address: ADDRESS, quote: quote(), slippage: 101 }
  });

  assert.equal(badQuote.statusCode, 400);
  assert.equal(badSwap.statusCode, 400);
  await app.close();
});
