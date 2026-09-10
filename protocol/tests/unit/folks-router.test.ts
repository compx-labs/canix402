import assert from "node:assert/strict";
import test from "node:test";

import { Network, SwapMode, type SwapParams, type SwapQuote } from "@folks-router/js-sdk";

import {
  FOLKS_ROUTER_DEFAULT_FEE_BPS,
  FOLKS_ROUTER_MAINNET_APP_ID,
  FOLKS_ROUTER_V1_MAINNET_API_BASE,
  FOLKS_ROUTER_V2_MAINNET_API_BASE,
  FolksRouterError,
  assertFolksRouterV2BaseUrl,
  createFolksRouterService,
  inferFolksRouteKind,
  percentSlippageToFolksBps,
  type FolksRouterSdk
} from "../../src/services/folks-router.js";
import {
  FOLKS_ROUTER_ALGO_USDC_QUOTE,
  FOLKS_ROUTER_ALGO_USDC_UNSIGNED_GROUP,
  FOLKS_ROUTER_FIXTURE_ADDRESS,
  FOLKS_ROUTER_FIXTURE_NOW_MS,
  FOLKS_ROUTER_GOLD_ASSET_ID,
  FOLKS_ROUTER_MULTI_HOP_QUOTE,
  FOLKS_ROUTER_MULTI_HOP_UNSIGNED_GROUP,
  FOLKS_ROUTER_USDC_ASSET_ID,
  folksRouterMultiHopQuoteFixture,
  folksRouterQuoteFixture
} from "../fixtures/folks-router.js";

const OTHER_ADDRESS = "RS7TLLQRXKBAQDAVTSZC2ZLMVMLNSCL3FOUOESJJZ5XSKFFL56UI6X33CI";

interface QuoteCall {
  params: SwapParams;
  maxGroupSize?: number;
  feeBps?: number | bigint;
  userFeeDiscount?: number | bigint;
  referrer?: string;
}

function mockSdk(options: {
  discount?: number;
  discountError?: Error;
  quote?: SwapQuote;
  unsignedGroup?: string[];
  quoteCalls?: QuoteCall[];
  discountCalls?: string[];
  prepareCalls?: Array<{ userAddress: string; slippageBps: number | bigint }>;
} = {}): FolksRouterSdk {
  return {
    async fetchUserDiscount(userAddress) {
      options.discountCalls?.push(userAddress);
      if (options.discountError) {
        throw options.discountError;
      }
      return options.discount ?? 10;
    },
    async fetchSwapQuote(params, maxGroupSize, feeBps, userFeeDiscount, referrer) {
      options.quoteCalls?.push({
        params,
        ...(maxGroupSize === undefined ? {} : { maxGroupSize }),
        ...(feeBps === undefined ? {} : { feeBps }),
        ...(userFeeDiscount === undefined ? {} : { userFeeDiscount }),
        ...(referrer === undefined ? {} : { referrer })
      });
      return options.quote ?? FOLKS_ROUTER_ALGO_USDC_QUOTE;
    },
    async prepareSwapTransactions(_params, userAddress, slippageBps) {
      options.prepareCalls?.push({ userAddress, slippageBps });
      return options.unsignedGroup ?? FOLKS_ROUTER_ALGO_USDC_UNSIGNED_GROUP;
    }
  };
}

test("assertFolksRouterV2BaseUrl rejects deprecated V1 hosts", () => {
  assert.doesNotThrow(() => assertFolksRouterV2BaseUrl(FOLKS_ROUTER_V2_MAINNET_API_BASE));
  assert.doesNotThrow(() =>
    assertFolksRouterV2BaseUrl("https://api.folksrouter.io/testnet/v2/")
  );
  assert.throws(
    () => assertFolksRouterV2BaseUrl(FOLKS_ROUTER_V1_MAINNET_API_BASE),
    /V1 base URLs are not supported/
  );
  assert.throws(
    () => assertFolksRouterV2BaseUrl("https://api.folksrouter.io/testnet"),
    /V1 base URLs are not supported/
  );
});

test("percent slippage maps to Folks 4 d.p. bps and hop counts classify multi-hop", () => {
  assert.equal(percentSlippageToFolksBps(1), 100);
  assert.equal(percentSlippageToFolksBps(0.1), 10);
  assert.deepEqual(inferFolksRouteKind(2), { hopCount: 1, routeKind: "direct" });
  assert.deepEqual(inferFolksRouteKind(4), { hopCount: 2, routeKind: "multi-hop" });
  assert.equal(FOLKS_ROUTER_DEFAULT_FEE_BPS, 10);
});

test("FIXED_INPUT ALGO→USDC quote applies sender fee discount into Canix DTO", async () => {
  const quoteCalls: QuoteCall[] = [];
  const discountCalls: string[] = [];
  const service = createFolksRouterService({
    client: mockSdk({
      discount: 20,
      quote: FOLKS_ROUTER_ALGO_USDC_QUOTE,
      quoteCalls,
      discountCalls
    }),
    now: () => FOLKS_ROUTER_FIXTURE_NOW_MS
  });

  const quote = await service.getQuote({
    address: FOLKS_ROUTER_FIXTURE_ADDRESS,
    fromAssetId: 0,
    toAssetId: FOLKS_ROUTER_USDC_ASSET_ID,
    amount: "1000000",
    type: "fixed-input"
  });

  assert.deepEqual(discountCalls, [FOLKS_ROUTER_FIXTURE_ADDRESS]);
  assert.equal(quoteCalls.length, 1);
  assert.equal(quoteCalls[0]?.params.fromAssetId, 0);
  assert.equal(quoteCalls[0]?.params.toAssetId, FOLKS_ROUTER_USDC_ASSET_ID);
  assert.equal(quoteCalls[0]?.params.amount, 1_000_000n);
  assert.equal(quoteCalls[0]?.params.swapMode, SwapMode.FIXED_INPUT);
  assert.equal(quoteCalls[0]?.userFeeDiscount, 20);
  assert.equal(quote.source, "folks-router");
  assert.equal(quote.apiVersion, "v2");
  assert.equal(quote.routerAppId, String(FOLKS_ROUTER_MAINNET_APP_ID));
  assert.equal(quote.quotedAmount, "184250");
  assert.equal(quote.txnPayload, FOLKS_ROUTER_ALGO_USDC_QUOTE.txnPayload);
  assert.equal(quote.discount.applied, true);
  assert.equal(quote.discount.sender, FOLKS_ROUTER_FIXTURE_ADDRESS);
  assert.equal(quote.discount.userFeeDiscount, 20);
  assert.deepEqual(
    quote.discount.tiers.map((tier) => tier.discountPercent),
    [0, 10, 20, 30, 40, 50]
  );
  assert.deepEqual(quote.requiredAppOptIns, [String(FOLKS_ROUTER_MAINNET_APP_ID)]);
});

test("quote without a sender skips discount lookup", async () => {
  const quoteCalls: QuoteCall[] = [];
  const discountCalls: string[] = [];
  const service = createFolksRouterService({
    client: mockSdk({ quoteCalls, discountCalls }),
    now: () => FOLKS_ROUTER_FIXTURE_NOW_MS
  });

  const quote = await service.getQuote({
    fromAssetId: 0,
    toAssetId: FOLKS_ROUTER_USDC_ASSET_ID,
    amount: 1_000_000
  });

  assert.deepEqual(discountCalls, []);
  assert.equal(quoteCalls[0]?.userFeeDiscount, undefined);
  assert.equal(quote.address, undefined);
  assert.equal(quote.discount.applied, false);
  assert.equal(quote.discount.sender, null);
  assert.equal(quote.discount.userFeeDiscount, 0);
});

test("discount lookup failure quotes at list-price fee instead of failing", async () => {
  const quoteCalls: QuoteCall[] = [];
  const service = createFolksRouterService({
    client: mockSdk({
      quoteCalls,
      discountError: new Error("discount 503")
    }),
    now: () => FOLKS_ROUTER_FIXTURE_NOW_MS
  });

  const quote = await service.getQuote({
    address: FOLKS_ROUTER_FIXTURE_ADDRESS,
    fromAssetId: 0,
    toAssetId: FOLKS_ROUTER_USDC_ASSET_ID,
    amount: 1_000_000
  });

  assert.equal(quote.discount.applied, false);
  assert.equal(quote.discount.sender, FOLKS_ROUTER_FIXTURE_ADDRESS);
  assert.equal(quote.discount.userFeeDiscount, 0);
  assert.equal(quoteCalls[0]?.userFeeDiscount, undefined);
  assert.equal(quote.quotedAmount, FOLKS_ROUTER_ALGO_USDC_QUOTE.quoteAmount.toString());
});

test("prepare returns an unsigned ALGO→USDC group without signing", async () => {
  const prepareCalls: Array<{ userAddress: string; slippageBps: number | bigint }> = [];
  const service = createFolksRouterService({
    client: mockSdk({
      unsignedGroup: FOLKS_ROUTER_ALGO_USDC_UNSIGNED_GROUP,
      prepareCalls
    }),
    now: () => FOLKS_ROUTER_FIXTURE_NOW_MS
  });

  const group = await service.buildSwapTransactions(
    FOLKS_ROUTER_FIXTURE_ADDRESS,
    folksRouterQuoteFixture(),
    1
  );

  assert.equal(prepareCalls[0]?.slippageBps, 100);
  assert.equal(group.source, "folks-router");
  assert.equal(group.apiVersion, "v2");
  assert.equal(group.routeKind, "direct");
  assert.equal(group.hopCount, 1);
  assert.deepEqual(
    group.transactions.map((txn) => txn.encodedTransaction),
    FOLKS_ROUTER_ALGO_USDC_UNSIGNED_GROUP
  );
  assert.ok(group.transactions.every((txn) => txn.signer === "user"));
  assert.ok(group.transactions.every((txn) => !("signedTransaction" in txn)));
  assert.deepEqual(group.userSignIndexes, [0, 1]);
  assert.equal(group.quoteExpiresAt, folksRouterQuoteFixture().expiresAt);
});

test("multi-hop GOLD→USDC fixture returns an unsigned V2 group", async () => {
  const quoteCalls: QuoteCall[] = [];
  const service = createFolksRouterService({
    client: mockSdk({
      discount: 0,
      quote: FOLKS_ROUTER_MULTI_HOP_QUOTE,
      unsignedGroup: FOLKS_ROUTER_MULTI_HOP_UNSIGNED_GROUP,
      quoteCalls
    }),
    now: () => FOLKS_ROUTER_FIXTURE_NOW_MS
  });

  const quote = await service.getQuote({
    address: FOLKS_ROUTER_FIXTURE_ADDRESS,
    fromAssetId: FOLKS_ROUTER_GOLD_ASSET_ID,
    toAssetId: FOLKS_ROUTER_USDC_ASSET_ID,
    amount: "1000000000",
    type: "fixed-input"
  });
  const group = await service.buildSwapTransactions(
    FOLKS_ROUTER_FIXTURE_ADDRESS,
    folksRouterMultiHopQuoteFixture({
      quotedAmount: quote.quotedAmount,
      txnPayload: quote.txnPayload,
      discount: quote.discount
    }),
    0.5
  );

  assert.equal(quoteCalls[0]?.params.fromAssetId, FOLKS_ROUTER_GOLD_ASSET_ID);
  assert.equal(quote.quotedAmount, FOLKS_ROUTER_MULTI_HOP_QUOTE.quoteAmount.toString());
  assert.equal(group.routeKind, "multi-hop");
  assert.equal(group.hopCount, 2);
  assert.equal(group.transactions.length, 4);
  assert.deepEqual(
    group.transactions.map((txn) => txn.encodedTransaction),
    FOLKS_ROUTER_MULTI_HOP_UNSIGNED_GROUP
  );
  assert.equal(group.transactions.some((txn) => "signedTransaction" in txn), false);
});

test("service constructs the official V2 SDK client for mainnet", () => {
  const networks: Network[] = [];
  createFolksRouterService({
    createClient: (network) => {
      networks.push(network);
      return mockSdk();
    }
  });
  assert.deepEqual(networks, [Network.MAINNET]);
});

test("service rejects V1 API base overrides before any quote call", () => {
  assert.throws(
    () =>
      createFolksRouterService({
        apiBaseUrl: FOLKS_ROUTER_V1_MAINNET_API_BASE,
        client: mockSdk()
      }),
    /V1 base URLs are not supported/
  );
});

test("expired and address-mismatched quotes are rejected before prepare", async () => {
  const prepareCalls: Array<{ userAddress: string; slippageBps: number | bigint }> = [];
  const service = createFolksRouterService({
    client: mockSdk({ prepareCalls }),
    now: () => FOLKS_ROUTER_FIXTURE_NOW_MS
  });

  await assert.rejects(
    service.buildSwapTransactions(
      FOLKS_ROUTER_FIXTURE_ADDRESS,
      folksRouterQuoteFixture({
        expiresAt: new Date(FOLKS_ROUTER_FIXTURE_NOW_MS - 1).toISOString()
      }),
      1
    ),
    /quote has expired/
  );
  await assert.rejects(
    service.buildSwapTransactions(OTHER_ADDRESS, folksRouterQuoteFixture(), 1),
    /different Algorand address/ // pragma: allowlist secret
  );
  assert.equal(prepareCalls.length, 0);
});

test("empty prepare groups surface as upstream errors", async () => {
  const service = createFolksRouterService({
    client: mockSdk({ unsignedGroup: [] }),
    now: () => FOLKS_ROUTER_FIXTURE_NOW_MS
  });
  await assert.rejects(
    service.buildSwapTransactions(
      FOLKS_ROUTER_FIXTURE_ADDRESS,
      folksRouterQuoteFixture(),
      1
    ),
    (error: unknown) =>
      error instanceof FolksRouterError && error.kind === "upstream"
  );
});
