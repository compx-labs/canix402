import assert from "node:assert/strict";
import test from "node:test";

import type { MetaRouterId, MetaSwapQuote } from "../../src/types/swap-schema.js";
import type { MetaSwapAdapter } from "../../src/services/meta-swap-adapters.js";
import {
  MetaSwapError,
  createMetaSwapService
} from "../../src/services/meta-swap-router.js";
import {
  compareQuotedRoutes,
  selectMetaSwapWinner,
  type MetaSwapQuotedRoute
} from "../../src/services/meta-swap-score.js";

const ADDRESS = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";
const NOW = Date.UTC(2026, 8, 7, 14, 0, 0);

function route(
  router: MetaRouterId,
  expectedOut: bigint,
  minOut: bigint,
  networkFee = 0n
): MetaSwapQuotedRoute {
  return {
    router,
    score: {
      expectedNetOut: expectedOut,
      minOut,
      expectedIn: 1_000_000n,
      maxIn: 1_000_000n,
      networkFeeMicroAlgos: networkFee,
      feeAlreadyNetted: true
    },
    expiresAtMs: NOW + 30_000,
    legs: [],
    payload: { router }
  };
}

test("fixed-input winner is higher expected net out", () => {
  const hogswap = route("hogswap", 200n, 190n, 5_000n);
  const haystack = route("haystack", 180n, 175n, 0n);
  assert.equal(selectMetaSwapWinner("fixed-input", [haystack, hogswap]).router, "hogswap");
});

test("fixed-input ties break on min-out then network fee then priority", () => {
  const hogswap = route("hogswap", 200n, 190n, 8_000n);
  const haystackBetterMin = route("haystack", 200n, 195n, 8_000n);
  assert.equal(
    selectMetaSwapWinner("fixed-input", [hogswap, haystackBetterMin]).router,
    "haystack"
  );

  const hogswapCheaper = route("hogswap", 200n, 190n, 1_000n);
  const haystackSame = route("haystack", 200n, 190n, 5_000n);
  assert.equal(
    selectMetaSwapWinner("fixed-input", [haystackSame, hogswapCheaper]).router,
    "hogswap"
  );

  const hogswapTied = route("hogswap", 200n, 190n, 0n);
  const haystackTied = route("haystack", 200n, 190n, 0n);
  assert.equal(
    selectMetaSwapWinner("fixed-input", [hogswapTied, haystackTied]).router,
    "haystack"
  );
  assert.ok(compareQuotedRoutes("fixed-input", haystackTied, hogswapTied) < 0);
});

test("fixed-output winner is lower expected in", () => {
  const hogswap: MetaSwapQuotedRoute = {
    ...route("hogswap", 100_000n, 100_000n),
    score: {
      expectedNetOut: 100_000n,
      minOut: 100_000n,
      expectedIn: 90_000n,
      maxIn: 91_000n,
      networkFeeMicroAlgos: 2_000n,
      feeAlreadyNetted: true
    }
  };
  const haystack: MetaSwapQuotedRoute = {
    ...route("haystack", 100_000n, 100_000n),
    score: {
      expectedNetOut: 100_000n,
      minOut: 100_000n,
      expectedIn: 95_000n,
      maxIn: 96_000n,
      networkFeeMicroAlgos: 0n,
      feeAlreadyNetted: true
    }
  };
  assert.equal(selectMetaSwapWinner("fixed-output", [haystack, hogswap]).router, "hogswap");
});

function mockAdapter(
  id: MetaRouterId,
  options: {
    enabled?: boolean;
    expectedOut?: bigint;
    delayMs?: number;
    error?: Error;
    skipReason?: string;
  } = {}
): MetaSwapAdapter {
  return {
    id,
    isEnabled() {
      return options.enabled ?? true;
    },
    skipReason() {
      return options.skipReason;
    },
    async quote() {
      if (options.delayMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
      if (options.error) {
        throw options.error;
      }
      const expectedOut = options.expectedOut ?? 100n;
      return route(id, expectedOut, expectedOut - 5n);
    },
    async buildOptIns() {
      return {
        required: false,
        transactions: [],
        userSignIndexes: [],
        createdAt: new Date(NOW).toISOString(),
        expiresAt: new Date(NOW + 120_000).toISOString()
      };
    },
    async buildSwapTransactions() {
      return {
        router: id,
        transactions: [
          {
            index: 0,
            encodedTransaction: "dXNlcg==",
            signer: "user"
          }
        ],
        userSignIndexes: [0],
        createdAt: new Date(NOW).toISOString(),
        quoteExpiresAt: new Date(NOW + 20_000).toISOString()
      };
    }
  };
}

test("meta-quote picks hogswap over haystack when hogswap returns more out", async () => {
  const service = createMetaSwapService({
    now: () => NOW,
    adapters: [
      mockAdapter("haystack", { expectedOut: 180n }),
      mockAdapter("hogswap", { expectedOut: 200n })
    ]
  });

  const quote = await service.getQuote({
    address: ADDRESS,
    fromAssetId: 0,
    toAssetId: 31566704,
    amount: "1000000",
    type: "fixed-input"
  });

  assert.equal(quote.router, "hogswap");
  assert.equal(quote.quotedAmount, "200");
  assert.equal(quote.minOut, "195");
  assert.equal(quote.score.feeAlreadyNetted, true);
  assert.deepEqual(
    quote.alternatives.map((row) => row.router),
    ["haystack", "hogswap"]
  );
  assert.ok(quote.alternatives.every((row) => row.status === "quoted"));
});

test("meta-quote isolates a failing adapter and still returns a winner", async () => {
  const service = createMetaSwapService({
    now: () => NOW,
    adapters: [
      mockAdapter("haystack", { error: new Error("haystack 503") }),
      mockAdapter("hogswap", { expectedOut: 150n })
    ]
  });

  const quote = await service.getQuote({
    address: ADDRESS,
    fromAssetId: 0,
    toAssetId: 31566704,
    amount: "1000000"
  });

  assert.equal(quote.router, "hogswap");
  const haystack = quote.alternatives.find((row) => row.router === "haystack");
  assert.equal(haystack?.status, "error");
  assert.match(haystack?.reason ?? "", /haystack 503/);
});

test("meta-quote records timeouts without blocking other routers", async () => {
  const service = createMetaSwapService({
    now: () => NOW,
    timeoutMs: 20,
    adapters: [
      mockAdapter("haystack", { delayMs: 200, expectedOut: 999n }),
      mockAdapter("hogswap", { expectedOut: 120n })
    ]
  });

  const quote = await service.getQuote({
    address: ADDRESS,
    fromAssetId: 0,
    toAssetId: 31566704,
    amount: "1000000"
  });

  assert.equal(quote.router, "hogswap");
  assert.equal(
    quote.alternatives.find((row) => row.router === "haystack")?.status,
    "timeout"
  );
});

test("router override quotes only that adapter", async () => {
  const service = createMetaSwapService({
    now: () => NOW,
    adapters: [
      mockAdapter("haystack", { expectedOut: 50n }),
      mockAdapter("hogswap", { expectedOut: 500n })
    ]
  });

  const quote = await service.getQuote({
    address: ADDRESS,
    fromAssetId: 0,
    toAssetId: 31566704,
    amount: "1000000",
    router: "haystack"
  });

  assert.equal(quote.router, "haystack");
  assert.equal(quote.quotedAmount, "50");
  assert.equal(quote.alternatives.length, 1);
  assert.equal(quote.alternatives[0]?.router, "haystack");
});

test("all failed quotes surface no-route with alternatives", async () => {
  const service = createMetaSwapService({
    now: () => NOW,
    adapters: [mockAdapter("haystack", { error: new Error("down") })]
  });

  await assert.rejects(
    () =>
      service.getQuote({
        address: ADDRESS,
        fromAssetId: 0,
        toAssetId: 31566704,
        amount: "1000000"
      }),
    (error: unknown) => {
      assert.ok(error instanceof MetaSwapError);
      assert.equal(error.kind, "no-route");
      return true;
    }
  );
});

test("disabled adapter is skipped when override is omitted", async () => {
  const service = createMetaSwapService({
    now: () => NOW,
    adapters: [
      mockAdapter("asastats", { enabled: false, expectedOut: 9_000n }),
      mockAdapter("hogswap", { expectedOut: 100n })
    ]
  });

  const quote = await service.getQuote({
    address: ADDRESS,
    fromAssetId: 0,
    toAssetId: 31566704,
    amount: "1000000"
  });

  assert.equal(quote.router, "hogswap");
  assert.equal(
    quote.alternatives.some((row) => row.router === "asastats"),
    false
  );
});

test("opt-in and transactions use the winning adapter payload", async () => {
  const service = createMetaSwapService({
    now: () => NOW,
    adapters: [mockAdapter("hogswap", { expectedOut: 111n })]
  });
  const quote = await service.getQuote({
    address: ADDRESS,
    fromAssetId: 0,
    toAssetId: 31566704,
    amount: "1000000"
  });

  const optins = await service.buildOptIns(ADDRESS, quote);
  assert.equal(optins.required, false);

  const group = await service.buildSwapTransactions(ADDRESS, quote, 1);
  assert.equal(group.router, "hogswap");
  assert.equal(group.transactions[0]?.signer, "user");
});

test("skipReason adapters are recorded and never win", async () => {
  const service = createMetaSwapService({
    now: () => NOW,
    adapters: [
      mockAdapter("pact-smart-router", {
        skipReason: "Pact Smart Router does not support fixed-output swaps.",
        expectedOut: 9_999n
      }),
      mockAdapter("hogswap", { expectedOut: 100n })
    ]
  });

  const quote = await service.getQuote({
    address: ADDRESS,
    fromAssetId: 0,
    toAssetId: 31566704,
    amount: "1000000",
    type: "fixed-output"
  });

  assert.equal(quote.router, "hogswap");
  assert.equal(
    quote.alternatives.find((row) => row.router === "pact-smart-router")?.status,
    "skipped"
  );
});

test("stale meta quotes are rejected before execute", async () => {
  const service = createMetaSwapService({
    now: () => NOW,
    adapters: [mockAdapter("hogswap", { expectedOut: 111n })]
  });
  const quote: MetaSwapQuote = {
    ...(await service.getQuote({
      address: ADDRESS,
      fromAssetId: 0,
      toAssetId: 31566704,
      amount: "1000000"
    })),
    expiresAt: new Date(NOW - 1).toISOString()
  };

  await assert.rejects(
    () => service.buildSwapTransactions(ADDRESS, quote, 1),
    /expired/
  );
});
