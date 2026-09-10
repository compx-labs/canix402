import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";

import {
  MetaSwapError,
  createMetaSwapService,
  type MetaSwapService
} from "../../src/services/meta-swap-router.js";
import { registerSwapRoutes } from "../../src/routes/swaps.js";
import type { MetaSwapQuote } from "../../src/types/swap-schema.js";

const ADDRESS = "3Y2V6ODUVUGM4TXOEXY65YLMKMVLG4PB3GSOXDCJDE4X5YQA5JA3P2FHAQ";
const OTHER_ADDRESS = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";
const GOLD_ASSET_ID = 246516580;

function quote(overrides: Partial<MetaSwapQuote> = {}): MetaSwapQuote {
  return {
    router: "haystack",
    address: ADDRESS,
    fromAssetId: "0",
    toAssetId: "31566704",
    amount: "1000000",
    type: "fixed-input",
    quotedAmount: "250000",
    minOut: "247500",
    networkFeeMicroAlgos: "0",
    slippageBps: 100,
    createdAt: new Date(Date.now() - 1_000).toISOString(),
    expiresAt: new Date(Date.now() + 29_000).toISOString(),
    score: {
      expectedNetOut: "250000",
      minOut: "247500",
      expectedIn: "1000000",
      maxIn: "1000000",
      networkFeeMicroAlgos: "0",
      feeAlreadyNetted: true
    },
    alternatives: [
      {
        router: "haystack",
        status: "quoted",
        expectedNetOut: "250000",
        minOut: "247500",
        networkFeeMicroAlgos: "0"
      }
    ],
    legs: [],
    payload: { iv: "iv", data: "payload" },
    ...overrides
  };
}

function mockService(): MetaSwapService {
  return {
    async getQuote(input) {
      return quote({
        address: input.address,
        fromAssetId: String(input.fromAssetId),
        toAssetId: String(input.toAssetId),
        amount: String(input.amount),
        type: input.type ?? "fixed-input",
        ...(input.router === undefined ? {} : { router: input.router })
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
    async buildSwapTransactions(_address, metaQuote) {
      return {
        router: metaQuote.router,
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

async function createApp(service: MetaSwapService) {
  const app = Fastify();
  registerSwapRoutes(app, service);
  await app.ready();
  return app;
}

test("POST /swaps/quote returns a free serializable multi-router quote", async () => {
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
  assert.equal(payload.data.router, "haystack");
  assert.equal(payload.data.minOut, "247500");
  assert.equal(payload.meta.paymentRequired, false);
  assert.equal(payload.meta.executionSubmitted, false);
  await app.close();
});

test("POST /swaps/quote passes opaque winner payload through unchanged", async () => {
  const service = mockService();
  const app = await createApp({
    ...service,
    async getQuote(input) {
      return quote({
        address: input.address,
        fromAssetId: String(input.fromAssetId),
        toAssetId: String(input.toAssetId),
        amount: String(input.amount),
        type: input.type ?? "fixed-input",
        payload: { iv: "", data: "payload" }
      });
    }
  });
  const response = await app.inject({
    method: "POST",
    url: "/swaps/quote",
    payload: {
      address: ADDRESS,
      fromAssetId: "31566704",
      toAssetId: 0,
      amount: "100000",
      type: "fixed-input"
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.payload.iv, "");
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
  assert.equal(payload.data.router, "haystack");
  assert.deepEqual(payload.data.userSignIndexes, [0]);
  assert.equal(payload.data.transactions[0].signer, "user");
  assert.equal(payload.data.transactions[1].signer, "haystack");
  assert.equal(payload.data.transactions[1].signedTransaction, "c2lnbmVk");
  assert.equal(payload.meta.paymentRequired, true);
  assert.equal(payload.meta.executionSubmitted, false);
  await app.close();
});

test("swap route maps upstream rate limits without leaking upstream details", async () => {
  const service = mockService();
  service.getQuote = async () => {
    throw new MetaSwapError("Haystack rate limit exceeded; retry later.", "rate-limit");
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

test("swap route surfaces upstream message details for unhandled SDK failures", async () => {
  const service = mockService();
  service.getQuote = async () => {
    throw new MetaSwapError(
      "Unable to fetch a Haystack swap quote.",
      "upstream",
      { upstreamMessage: "response.quotes is not iterable" }
    );
  };
  const app = await createApp(service);
  const response = await app.inject({
    method: "POST",
    url: "/swaps/quote",
    payload: {
      address: ADDRESS,
      fromAssetId: GOLD_ASSET_ID,
      toAssetId: 31566704,
      amount: "400392"
    }
  });

  assert.equal(response.statusCode, 502);
  assert.equal(response.json().error.message, "Unable to fetch a Haystack swap quote.");
  assert.equal(
    response.json().error.details.upstreamMessage,
    "response.quotes is not iterable"
  );
  await app.close();
});

test("swap route returns not-found when no router quotes the pair", async () => {
  const service = mockService();
  service.getQuote = async () => {
    throw new MetaSwapError("No enabled swap router returned a quote for this pair.", "no-route", {
      alternatives: [{ router: "hogswap", status: "error", reason: "no route" }]
    });
  };
  const app = await createApp(service);
  const response = await app.inject({
    method: "POST",
    url: "/swaps/quote",
    payload: {
      address: ADDRESS,
      fromAssetId: 0,
      toAssetId: 31566704,
      amount: "1000000"
    }
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, "NOT_FOUND");
  await app.close();
});

test("service rejects stale and address-mismatched quotes before adapter calls", async () => {
  const service = createMetaSwapService({
    now: () => Date.now(),
    adapters: []
  });

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

test("quote request accepts Tinyman and Humble in disabledProtocols and router override", async () => {
  const app = await createApp(mockService());
  const response = await app.inject({
    method: "POST",
    url: "/swaps/quote",
    payload: {
      address: ADDRESS,
      fromAssetId: 0,
      toAssetId: 31566704,
      amount: "1000000",
      router: "haystack",
      slippage: 1,
      disabledProtocols: ["Tinyman", "Humble", "Algofi", "Algomint"]
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.router, "haystack");
  await app.close();
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
