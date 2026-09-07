import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";

import { FolksRouterError, type FolksRouterService } from "../../src/services/folks-router.js";
import { registerFolksSwapRoutes } from "../../src/routes/folks-swaps.js";
import type { FolksSwapQuote } from "../../src/types/swap-schema.js";
import {
  FOLKS_ROUTER_ALGO_USDC_UNSIGNED_GROUP,
  FOLKS_ROUTER_FIXTURE_ADDRESS,
  FOLKS_ROUTER_MULTI_HOP_UNSIGNED_GROUP,
  FOLKS_ROUTER_USDC_ASSET_ID,
  folksRouterMultiHopQuoteFixture,
  folksRouterQuoteFixture
} from "../fixtures/folks-router.js";

function mockService(): FolksRouterService {
  return {
    async getQuote(input) {
      return folksRouterQuoteFixture({
        ...(input.address ? { address: input.address } : {}),
        fromAssetId: String(input.fromAssetId),
        toAssetId: String(input.toAssetId),
        amount: String(input.amount),
        type: input.type ?? "fixed-input",
        swapMode: (input.type ?? "fixed-input") === "fixed-output" ? "FIXED_OUTPUT" : "FIXED_INPUT",
        discount: input.address
          ? folksRouterQuoteFixture().discount
          : {
              ...folksRouterQuoteFixture().discount,
              sender: null,
              userFeeDiscount: 0,
              applied: false
            }
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
            assetId: String(FOLKS_ROUTER_USDC_ASSET_ID)
          }
        ],
        userSignIndexes: [0],
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      };
    },
    async buildSwapTransactions(_address, quote) {
      const unsigned =
        quote.txnPayload === folksRouterMultiHopQuoteFixture().txnPayload
          ? FOLKS_ROUTER_MULTI_HOP_UNSIGNED_GROUP
          : FOLKS_ROUTER_ALGO_USDC_UNSIGNED_GROUP;
      return {
        source: "folks-router",
        apiVersion: "v2",
        routerAppId: quote.routerAppId,
        routeKind: unsigned.length > 3 ? "multi-hop" : "direct",
        hopCount: Math.max(1, unsigned.length - 2),
        transactions: unsigned.map((encodedTransaction, index) => ({
          index,
          encodedTransaction,
          signer: "user" as const
        })),
        userSignIndexes: unsigned.map((_, index) => index),
        createdAt: new Date().toISOString(),
        quoteExpiresAt: quote.expiresAt
      };
    }
  };
}

async function createApp(service: FolksRouterService) {
  const app = Fastify();
  registerFolksSwapRoutes(app, service);
  await app.ready();
  return app;
}

test("POST /swaps/folks/quote returns a free Folks Router V2 ALGO→USDC DTO", async () => {
  const app = await createApp(mockService());
  const response = await app.inject({
    method: "POST",
    url: "/swaps/folks/quote",
    payload: {
      address: FOLKS_ROUTER_FIXTURE_ADDRESS,
      fromAssetId: 0,
      toAssetId: FOLKS_ROUTER_USDC_ASSET_ID,
      amount: "1000000",
      type: "fixed-input"
    }
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json() as { data: FolksSwapQuote; meta: { paymentRequired: boolean; executionSubmitted: boolean } };
  assert.equal(payload.data.source, "folks-router");
  assert.equal(payload.data.apiVersion, "v2");
  assert.equal(payload.data.quotedAmount, "184250");
  assert.equal(payload.data.discount.applied, true);
  assert.equal(payload.data.discount.sender, FOLKS_ROUTER_FIXTURE_ADDRESS);
  assert.ok(payload.data.discount.tiers.length > 0);
  assert.equal(payload.meta.paymentRequired, false);
  assert.equal(payload.meta.executionSubmitted, false);
  await app.close();
});

test("POST /swaps/folks/quote documents zero discount when sender is omitted", async () => {
  const app = await createApp(mockService());
  const response = await app.inject({
    method: "POST",
    url: "/swaps/folks/quote",
    payload: {
      fromAssetId: 0,
      toAssetId: FOLKS_ROUTER_USDC_ASSET_ID,
      amount: "1000000"
    }
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json();
  assert.equal(payload.data.discount.applied, false);
  assert.equal(payload.data.discount.sender, null);
  assert.equal(payload.data.discount.userFeeDiscount, 0);
  await app.close();
});

test("POST /swaps/folks/optin returns caller-signable prerequisite transactions", async () => {
  const app = await createApp(mockService());
  const response = await app.inject({
    method: "POST",
    url: "/swaps/folks/optin",
    payload: { address: FOLKS_ROUTER_FIXTURE_ADDRESS, quote: folksRouterQuoteFixture() }
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json();
  assert.equal(payload.data.required, true);
  assert.deepEqual(payload.data.userSignIndexes, [0]);
  assert.equal(payload.data.transactions[0].kind, "asset-opt-in");
  assert.equal(payload.meta.paymentRequired, false);
  await app.close();
});

test("POST /swaps/folks/transactions returns an unsigned ALGO→USDC group", async () => {
  const app = await createApp(mockService());
  const response = await app.inject({
    method: "POST",
    url: "/swaps/folks/transactions",
    payload: { address: FOLKS_ROUTER_FIXTURE_ADDRESS, quote: folksRouterQuoteFixture(), slippage: 1 }
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json();
  assert.equal(payload.data.source, "folks-router");
  assert.equal(payload.data.routeKind, "direct");
  assert.deepEqual(
    payload.data.transactions.map((txn: { encodedTransaction: string }) => txn.encodedTransaction),
    FOLKS_ROUTER_ALGO_USDC_UNSIGNED_GROUP
  );
  assert.ok(payload.data.transactions.every((txn: { signer: string }) => txn.signer === "user"));
  assert.equal(payload.meta.paymentRequired, true);
  assert.equal(payload.meta.executionSubmitted, false);
  await app.close();
});

test("POST /swaps/folks/transactions returns an unsigned multi-hop group", async () => {
  const app = await createApp(mockService());
  const response = await app.inject({
    method: "POST",
    url: "/swaps/folks/transactions",
    payload: {
      address: FOLKS_ROUTER_FIXTURE_ADDRESS,
      quote: folksRouterMultiHopQuoteFixture(),
      slippage: 1
    }
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json();
  assert.equal(payload.data.routeKind, "multi-hop");
  assert.equal(payload.data.hopCount, 2);
  assert.equal(payload.data.transactions.length, 4);
  assert.equal(payload.meta.executionSubmitted, false);
  await app.close();
});

test("Folks route maps upstream rate limits without leaking internals", async () => {
  const service = mockService();
  service.getQuote = async () => {
    throw new FolksRouterError("Folks Router rate limit exceeded; retry later.", "rate-limit");
  };
  const app = await createApp(service);
  const response = await app.inject({
    method: "POST",
    url: "/swaps/folks/quote",
    payload: {
      address: FOLKS_ROUTER_FIXTURE_ADDRESS,
      fromAssetId: 0,
      toAssetId: FOLKS_ROUTER_USDC_ASSET_ID,
      amount: 1
    }
  });

  assert.equal(response.statusCode, 429);
  assert.equal(response.json().error.message, "Folks Router rate limit exceeded; retry later.");
  await app.close();
});

test("quote request validates amount and slippage bounds", async () => {
  const app = await createApp(mockService());
  const badQuote = await app.inject({
    method: "POST",
    url: "/swaps/folks/quote",
    payload: {
      address: FOLKS_ROUTER_FIXTURE_ADDRESS,
      fromAssetId: 0,
      toAssetId: FOLKS_ROUTER_USDC_ASSET_ID,
      amount: "0"
    }
  });
  const badSwap = await app.inject({
    method: "POST",
    url: "/swaps/folks/transactions",
    payload: { address: FOLKS_ROUTER_FIXTURE_ADDRESS, quote: folksRouterQuoteFixture(), slippage: 101 }
  });

  assert.equal(badQuote.statusCode, 400);
  assert.equal(badSwap.statusCode, 400);
  await app.close();
});
