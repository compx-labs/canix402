import assert from "node:assert/strict";
import test from "node:test";

import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import {
  ASASTATS_ACCESS_BLOCKER,
  ASASTATS_GROUP_PATH,
  ASASTATS_PLATFORM_FEE_BPS,
  ASASTATS_QUOTE_PATH,
  ASASTATS_SWAP_META,
  AsaStatsAccessBlockedError,
  AsaStatsQuoteStaleError,
  AsaStatsRouterError,
  asaStatsRouterAccessStatus,
  createAsaStatsRouterService,
  isAsaStatsRouterConfigured,
  parseAsaStatsGroup,
  parseAsaStatsQuote,
  scoreAsaStatsQuote,
  setAsaStatsRouterDependenciesForTests,
  wrapAsaStatsGroup,
  wrapAsaStatsQuote,
  type ParseAsaStatsQuoteContext
} from "../../src/services/asastats-router.js";
import {
  AsaStatsGroupResponseSchema,
  AsaStatsQuoteResponseSchema,
  AsaStatsRouterScoreSchema
} from "../../src/types/asastats-router-schema.js";
import {
  ASASTATS_FIXTURE_ADDRESS,
  ASASTATS_FIXTURE_APP_ID,
  ASASTATS_FIXTURE_CREATED_AT_MS,
  ASASTATS_FIXTURE_USDC_ASSET_ID,
  asaStatsMixedGroupPayload,
  asaStatsMultiVenueGroupPayload,
  asaStatsMultiVenueQuotePayload,
  asaStatsSellAlgoUsdcQuotePayload
} from "../fixtures/asastats/router.js";

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
if (!FormatRegistry.Has("date-time")) {
  FormatRegistry.Set("date-time", (value) => ISO_DATE_TIME.test(value));
}

const QUOTE_CONTEXT: ParseAsaStatsQuoteContext = {
  address: ASASTATS_FIXTURE_ADDRESS,
  fromAssetId: "0",
  toAssetId: String(ASASTATS_FIXTURE_USDC_ASSET_ID),
  amount: "1000000",
  type: "fixed-input",
  slippagePct: 0.5,
  appId: String(ASASTATS_FIXTURE_APP_ID),
  createdAtMs: ASASTATS_FIXTURE_CREATED_AT_MS,
  quoteTtlMs: 30_000
};

test.afterEach(() => {
  setAsaStatsRouterDependenciesForTests(undefined);
  delete process.env.ASASTATS_API_TOKEN;
  delete process.env.ASASTATS_HTTP_TIMEOUT_MS;
  delete process.env.ASASTATS_HTTP_DELAY_MS;
});

test("access status records the engine-scope blocker when no partner token is set", () => {
  delete process.env.ASASTATS_API_TOKEN;
  assert.equal(isAsaStatsRouterConfigured(), false);
  const status = asaStatsRouterAccessStatus();
  assert.equal(status.configured, false);
  assert.equal(status.ready, false);
  assert.equal(status.blocker, ASASTATS_ACCESS_BLOCKER);
  assert.deepEqual(status.requiredScopes, ["router:quote", "router:group"]);
  assert.equal(status.quotePath, ASASTATS_QUOTE_PATH);
  assert.match(ASASTATS_ACCESS_BLOCKER, /engine base URL/);
  assert.match(ASASTATS_ACCESS_BLOCKER, /router:quote and router:group/);
  assert.match(ASASTATS_ACCESS_BLOCKER, /never submits/);
});

test("parseAsaStatsQuote maps sell ALGO→USDC without treating fees_total as the platform fee", () => {
  const quote = parseAsaStatsQuote(asaStatsSellAlgoUsdcQuotePayload, QUOTE_CONTEXT);
  assert.equal(quote.router, "asastats");
  assert.equal(quote.mode, "sell");
  assert.equal(quote.type, "fixed-input");
  assert.equal(quote.fromAssetId, "0");
  assert.equal(quote.toAssetId, String(ASASTATS_FIXTURE_USDC_ASSET_ID));
  assert.equal(quote.amountIn, "1000000");
  assert.equal(quote.amountOut, "248750");
  assert.equal(quote.quotedAmount, "248750");
  assert.equal(quote.minimumReceived, "247506");
  assert.equal(quote.networkFeeMicroAlgos, "3000");
  assert.equal(quote.platformFeeBps, ASASTATS_PLATFORM_FEE_BPS);
  assert.equal(quote.platformFeeAlreadyNetted, true);
  assert.equal(quote.routeLabel, "Tinyman v2");
  assert.deepEqual(quote.routeVenues, ["Tinyman v2"]);
  assert.equal(quote.raw.fees_total, 3000);
  assert.deepEqual(
    (quote.raw.allocation as { venues: string[] }).venues,
    ["tinyman-v2"]
  );

  const wrapped = wrapAsaStatsQuote(quote);
  assert.equal(Value.Check(AsaStatsQuoteResponseSchema, wrapped), true);
  assert.deepEqual(wrapped.meta, ASASTATS_SWAP_META);
  assert.equal(wrapped.meta.executionSubmitted, false);
});

test("parseAsaStatsQuote maps a multi-venue Tinyman v2 + Pact + STAMM route", () => {
  const quote = parseAsaStatsQuote(asaStatsMultiVenueQuotePayload, {
    ...QUOTE_CONTEXT,
    amount: "5000000"
  });
  assert.equal(quote.routeLabel, "Tinyman v2, Pact, STAMM");
  assert.deepEqual(quote.routeVenues, ["Tinyman v2", "Pact", "STAMM"]);
  assert.equal(quote.amountIn, "5000000");
  assert.equal(quote.amountOut, "1243125");
  assert.equal(quote.networkFeeMicroAlgos, "9000");
  assert.equal(quote.platformFeeAlreadyNetted, true);
});

test("parseAsaStatsQuote keeps amount strings above Number.MAX_SAFE_INTEGER", () => {
  const huge = "58180000000000001";
  const quote = parseAsaStatsQuote(
    { ...asaStatsSellAlgoUsdcQuotePayload, amount_out: huge },
    QUOTE_CONTEXT
  );
  assert.equal(quote.amountOut, huge);
  assert.equal(quote.quotedAmount, huge);
  assert.notEqual(Number(huge).toString(), huge);
});

test("scoreAsaStatsQuote uses amount_out as net expected out and does not subtract 5 bps again", () => {
  const quote = parseAsaStatsQuote(asaStatsSellAlgoUsdcQuotePayload, QUOTE_CONTEXT);
  const score = scoreAsaStatsQuote(quote);
  assert.equal(Value.Check(AsaStatsRouterScoreSchema, score), true);
  assert.equal(score.expectedNetOutBaseUnits, "248750");
  assert.equal(score.networkFeeMicroAlgos, "3000");
  assert.equal(score.platformFeeBps, 5);
  assert.equal(score.platformFeeAlreadyNetted, true);
  assert.equal(score.subtractPlatformFee, false);
  const naiveHaircut = (BigInt(quote.amountOut) * 9995n) / 10_000n;
  assert.notEqual(score.expectedNetOutBaseUnits, naiveHaircut.toString());
});

test("parseAsaStatsGroup maps unsigned user legs plus a backend-signed quote authorization", () => {
  const quote = parseAsaStatsQuote(asaStatsSellAlgoUsdcQuotePayload, QUOTE_CONTEXT);
  const group = parseAsaStatsGroup(asaStatsMixedGroupPayload, quote, {
    createdAtMs: ASASTATS_FIXTURE_CREATED_AT_MS
  });
  assert.equal(group.router, "asastats");
  assert.equal(group.transactions.length, 3);
  assert.equal(group.transactions[0]?.signer, "user");
  assert.equal(group.transactions[1]?.signer, "user");
  assert.equal(group.transactions[2]?.signer, "protocol");
  assert.equal(group.transactions[2]?.signedTransaction, "c2lnbmVkcXVvdGU=");
  assert.deepEqual(group.userSignIndexes, [0, 1]);
  assert.equal(group.quoteSignerIndex, 2);
  assert.equal(group.quoteExpiresAt, quote.expiresAt);

  const wrapped = wrapAsaStatsGroup(group);
  assert.equal(Value.Check(AsaStatsGroupResponseSchema, wrapped), true);
  assert.equal(wrapped.meta.executionSubmitted, false);
  assert.equal(wrapped.meta.paymentRequired, false);
});

test("parseAsaStatsGroup maps a multi-venue mixed group without signing", () => {
  const quote = parseAsaStatsQuote(asaStatsMultiVenueQuotePayload, {
    ...QUOTE_CONTEXT,
    amount: "5000000"
  });
  const group = parseAsaStatsGroup(asaStatsMultiVenueGroupPayload, quote, {
    createdAtMs: ASASTATS_FIXTURE_CREATED_AT_MS
  });
  assert.equal(group.transactions.length, 4);
  assert.deepEqual(group.userSignIndexes, [0, 1, 2]);
  assert.equal(group.transactions[3]?.signer, "protocol");
  assert.equal(
    group.transactions.every((txn) => typeof txn.encodedTransaction === "string"),
    true
  );
});

test("getQuote posts sell ALGO→USDC with string amounts and wraps Canix swap meta", async () => {
  const posts: Array<{ url: string; body: unknown; authorization: string | null }> = [];
  setAsaStatsRouterDependenciesForTests({
    now: () => ASASTATS_FIXTURE_CREATED_AT_MS,
    fetch: async (input, init) => {
      posts.push({
        url: String(input),
        body: JSON.parse(String(init?.body ?? "{}")) as unknown,
        authorization: new Headers(init?.headers).get("authorization")
      });
      return new Response(JSON.stringify(asaStatsSellAlgoUsdcQuotePayload), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const service = createAsaStatsRouterService({
    apiToken: "partner-token",
    apiBaseUrl: "https://engine.asastats.test"
  });
  const quote = await service.getQuote({
    address: ASASTATS_FIXTURE_ADDRESS,
    fromAssetId: 0,
    toAssetId: ASASTATS_FIXTURE_USDC_ASSET_ID,
    amount: "1000000",
    type: "fixed-input",
    slippagePct: 0.5
  });

  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.url, `https://engine.asastats.test${ASASTATS_QUOTE_PATH}`);
  assert.equal(posts[0]?.authorization, "Bearer partner-token");
  assert.deepEqual(posts[0]?.body, {
    address: ASASTATS_FIXTURE_ADDRESS,
    from_asset_id: 0,
    to_asset_id: ASASTATS_FIXTURE_USDC_ASSET_ID,
    amount: "1000000",
    mode: "sell",
    slippage_pct: 0.5
  });
  assert.equal(quote.amountOut, "248750");
  assert.equal(wrapAsaStatsQuote(quote).meta.executionSubmitted, false);
});

test("buildSwapGroup posts the engine quote blob and returns an unsigned mixed group", async () => {
  const posts: unknown[] = [];
  setAsaStatsRouterDependenciesForTests({
    now: () => ASASTATS_FIXTURE_CREATED_AT_MS,
    fetch: async (_input, init) => {
      posts.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify(asaStatsMixedGroupPayload), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const quote = parseAsaStatsQuote(asaStatsSellAlgoUsdcQuotePayload, QUOTE_CONTEXT);
  const service = createAsaStatsRouterService({ apiToken: "partner-token" });
  const group = await service.buildSwapGroup(ASASTATS_FIXTURE_ADDRESS, quote);

  assert.deepEqual(posts[0], {
    address: ASASTATS_FIXTURE_ADDRESS,
    quote: asaStatsSellAlgoUsdcQuotePayload
  });
  assert.equal(group.transactions[0]?.signer, "user");
  assert.equal(group.transactions[2]?.signer, "protocol");
  assert.equal(wrapAsaStatsGroup(group).meta.executionSubmitted, false);
});

test("missing partner token is an explicit access blocker, not a silent skip", async () => {
  delete process.env.ASASTATS_API_TOKEN;
  const service = createAsaStatsRouterService({ apiToken: "" });
  await assert.rejects(
    service.getQuote({
      address: ASASTATS_FIXTURE_ADDRESS,
      fromAssetId: 0,
      toAssetId: ASASTATS_FIXTURE_USDC_ASSET_ID,
      amount: "1000000"
    }),
    (error: unknown) =>
      error instanceof AsaStatsAccessBlockedError
      && error.kind === "access-blocked"
      && /router:quote and router:group/.test(error.message)
  );
});

test("HTTP 401/403/404 map to the access blocker", async () => {
  for (const status of [401, 403, 404]) {
    setAsaStatsRouterDependenciesForTests({
      fetch: async () =>
        new Response(JSON.stringify({ detail: "no scope" }), { status })
    });
    const service = createAsaStatsRouterService({ apiToken: "wrong-scope" });
    await assert.rejects(
      service.getQuote({
        address: ASASTATS_FIXTURE_ADDRESS,
        fromAssetId: 0,
        toAssetId: ASASTATS_FIXTURE_USDC_ASSET_ID,
        amount: "1"
      }),
      AsaStatsAccessBlockedError
    );
  }
});

test("HTTP 409 maps to stale-quote so callers re-quote instead of signing", async () => {
  setAsaStatsRouterDependenciesForTests({
    now: () => ASASTATS_FIXTURE_CREATED_AT_MS,
    fetch: async () =>
      new Response(JSON.stringify({ detail: "floor missed" }), { status: 409 })
  });
  const quote = parseAsaStatsQuote(asaStatsSellAlgoUsdcQuotePayload, QUOTE_CONTEXT);
  const service = createAsaStatsRouterService({ apiToken: "partner-token" });
  await assert.rejects(
    service.buildSwapGroup(ASASTATS_FIXTURE_ADDRESS, quote),
    AsaStatsQuoteStaleError
  );
});

test("expired quotes are refused locally before a group call", async () => {
  setAsaStatsRouterDependenciesForTests({
    now: () => ASASTATS_FIXTURE_CREATED_AT_MS + 31_000,
    fetch: async () => {
      throw new Error("group must not be called for an expired quote");
    }
  });
  const quote = parseAsaStatsQuote(asaStatsSellAlgoUsdcQuotePayload, QUOTE_CONTEXT);
  const service = createAsaStatsRouterService({ apiToken: "partner-token" });
  await assert.rejects(
    service.buildSwapGroup(ASASTATS_FIXTURE_ADDRESS, quote),
    AsaStatsQuoteStaleError
  );
});

test("buy mode maps maximum_sent and does not expose minimumReceived", () => {
  const quote = parseAsaStatsQuote(
    {
      ...asaStatsSellAlgoUsdcQuotePayload,
      amount_in: "402000",
      amount_out: "1000000",
      minimum_received: "1000000",
      maximum_sent: "404010"
    },
    { ...QUOTE_CONTEXT, type: "fixed-output", amount: "1000000" }
  );
  assert.equal(quote.mode, "buy");
  assert.equal(quote.amountIn, "402000");
  assert.equal(quote.amountOut, "1000000");
  assert.equal(quote.maximumSent, "404010");
  assert.equal(quote.minimumReceived, undefined);
  assert.equal(quote.quotedAmount, "402000");
});

test("HTTP aborts hung engine fetches", async () => {
  process.env.ASASTATS_HTTP_TIMEOUT_MS = "40";
  process.env.ASASTATS_HTTP_DELAY_MS = "0";
  setAsaStatsRouterDependenciesForTests({
    fetch: (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("The operation was aborted.");
          error.name = "AbortError";
          reject(error);
        });
      })
  });
  const service = createAsaStatsRouterService({ apiToken: "partner-token" });
  await assert.rejects(
    service.getQuote({
      address: ASASTATS_FIXTURE_ADDRESS,
      fromAssetId: 0,
      toAssetId: ASASTATS_FIXTURE_USDC_ASSET_ID,
      amount: "1"
    }),
    (error: unknown) =>
      error instanceof AsaStatsRouterError && /timed out after 40ms/.test(error.message)
  );
});
