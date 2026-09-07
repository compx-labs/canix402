import assert from "node:assert/strict";
import test from "node:test";

import {
  HogswapClientError,
  HogswapMissingOptInError,
  HogswapQuoteExpiredError,
  parseHogswapExecute,
  parseHogswapQuote,
  quoteHogswapLpMint,
  quoteHogswapLpRedeem,
  executeHogswapQuote,
  setHogswapClientDependenciesForTests
} from "../../src/services/hogswap-client.js";
import {
  STAMM_FIXTURE_POOL_APP_ID,
  STAMM_FIXTURE_TIER1_LP_ASSET_ID
} from "../fixtures/adapters/stamm.js";

test.afterEach(() => {
  setHogswapClientDependenciesForTests(undefined);
});

const QUOTE_PAYLOAD = {
  quote_id: "q-mint-fixture",
  mode: "LP_MINT",
  asset_in: 0,
  asset_out: STAMM_FIXTURE_TIER1_LP_ASSET_ID,
  amount_in: 1_000_000,
  expected_out: 317_366,
  expected_out_robust: 317_000,
  min_out_at_slippage: 314_192,
  slippage_bps: 100,
  network_fee_microalgo: 6000,
  deposits: [{ asset_id: 0, amount: 1_000_000 }],
  lp: {
    mode: "LP_MINT",
    pool_app_id: STAMM_FIXTURE_POOL_APP_ID,
    tier_index: 1,
    lp_asset_id: STAMM_FIXTURE_TIER1_LP_ASSET_ID,
    requires_multi_deposit: false,
    expected_lp_out: 317_366,
    used_pool_ratio: true
  }
};

test("parseHogswapQuote maps LP mint extras without baking router ids", () => {
  setHogswapClientDependenciesForTests({ now: () => 1_700_000_000_000 });
  const quote = parseHogswapQuote(QUOTE_PAYLOAD);
  assert.equal(quote.quoteId, "q-mint-fixture");
  assert.equal(quote.mode, "LP_MINT");
  assert.equal(quote.lp?.poolAppId, STAMM_FIXTURE_POOL_APP_ID);
  assert.equal(quote.lp?.tierIndex, 1);
  assert.equal(quote.lp?.lpAssetId, STAMM_FIXTURE_TIER1_LP_ASSET_ID);
  assert.equal(quote.quotedAtMs, 1_700_000_000_000);
  assert.equal("routerAppId" in quote, false);
});

test("parseHogswapExecute requires unsigned_group and live router_app_id", () => {
  const execute = parseHogswapExecute({
    quote_id: "q-mint-fixture",
    unsigned_group: [{ txn_b64: "AAAA", description: "router call" }],
    router_app_id: 3_544_666_001,
    group_id_b64: "gid",
    network_fee_microalgo: 6000,
    notes: ["walletless"]
  });
  assert.equal(execute.routerAppId, 3_544_666_001);
  assert.equal(execute.unsignedGroup.length, 1);
  assert.deepEqual(execute.notes, ["walletless"]);
  assert.throws(() => parseHogswapExecute({ quote_id: "q", unsigned_group: [], router_app_id: 1 }));
});

test("quoteHogswapLpMint posts pool ids from the request, not hardcoded constants", async () => {
  const posts: Array<{ url: string; body: unknown }> = [];
  setHogswapClientDependenciesForTests({
    now: () => 1,
    fetch: async (input, init) => {
      posts.push({
        url: String(input),
        body: JSON.parse(String(init?.body ?? "{}")) as unknown
      });
      return new Response(JSON.stringify(QUOTE_PAYLOAD), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  await quoteHogswapLpMint({
    poolAppId: STAMM_FIXTURE_POOL_APP_ID,
    tierIndex: 1,
    amountA: 1_000_000n,
    amountB: 0n,
    slippageBps: 100,
    maxLegs: 8,
    sender: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ"
  });

  assert.equal(posts.length, 1);
  assert.match(posts[0]?.url ?? "", /\/quote$/);
  assert.deepEqual(posts[0]?.body, {
    mode: "LP_MINT",
    pool_app_id: STAMM_FIXTURE_POOL_APP_ID,
    tier_index: 1,
    slippage_bps: 100,
    amount_a: 1_000_000,
    amount_b: 0,
    max_legs: 8,
    sender: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ"
  });
});

test("quoteHogswapLpRedeem posts LP_REDEEM with target_asset", async () => {
  const posts: unknown[] = [];
  setHogswapClientDependenciesForTests({
    now: () => 1,
    fetch: async (_input, init) => {
      posts.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(
        JSON.stringify({ ...QUOTE_PAYLOAD, quote_id: "q-redeem", mode: "LP_REDEEM" }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
  });

  await quoteHogswapLpRedeem({
    poolAppId: STAMM_FIXTURE_POOL_APP_ID,
    tierIndex: 1,
    lpAmount: 1_000_000n,
    targetAsset: 0,
    sender: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ"
  });

  assert.deepEqual(posts[0], {
    mode: "LP_REDEEM",
    pool_app_id: STAMM_FIXTURE_POOL_APP_ID,
    tier_index: 1,
    lp_amount: 1_000_000,
    target_asset: 0,
    slippage_bps: 100,
    sender: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ"
  });
});

test("executeHogswapQuote maps 404 to expired and 422 opt-in to missing opt-in", async () => {
  setHogswapClientDependenciesForTests({
    fetch: async () =>
      new Response(JSON.stringify({ detail: "quote not found" }), { status: 404 })
  });
  await assert.rejects(
    executeHogswapQuote("missing", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ"),
    HogswapQuoteExpiredError
  );

  setHogswapClientDependenciesForTests({
    fetch: async () =>
      new Response(
        JSON.stringify({
          detail: "signer is missing opt-in",
          assets: [STAMM_FIXTURE_TIER1_LP_ASSET_ID]
        }),
        { status: 422 }
      )
  });
  await assert.rejects(async () => {
    try {
      await executeHogswapQuote(
        "q",
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ"
      );
    } catch (error) {
      assert.ok(error instanceof HogswapMissingOptInError);
      assert.deepEqual(error.assetIds, [STAMM_FIXTURE_TIER1_LP_ASSET_ID]);
      throw error;
    }
  }, HogswapMissingOptInError);
});

test("HOGSWAP HTTP aborts hung fetches", async () => {
  const previousTimeout = process.env.HOGSWAP_HTTP_TIMEOUT_MS;
  const previousDelay = process.env.HOGSWAP_HTTP_DELAY_MS;
  process.env.HOGSWAP_HTTP_TIMEOUT_MS = "40";
  process.env.HOGSWAP_HTTP_DELAY_MS = "0";
  setHogswapClientDependenciesForTests({
    now: () => 1,
    fetch: (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("The operation was aborted.");
          error.name = "AbortError";
          reject(error);
        });
      })
  });
  try {
    await assert.rejects(
      quoteHogswapLpMint({
        poolAppId: STAMM_FIXTURE_POOL_APP_ID,
        tierIndex: 1,
        amountA: 1_000_000n
      }),
      (error: unknown) =>
        error instanceof HogswapClientError && /timed out after 40ms/.test(error.message)
    );
  } finally {
    if (previousTimeout === undefined) {
      delete process.env.HOGSWAP_HTTP_TIMEOUT_MS;
    } else {
      process.env.HOGSWAP_HTTP_TIMEOUT_MS = previousTimeout;
    }
    if (previousDelay === undefined) {
      delete process.env.HOGSWAP_HTTP_DELAY_MS;
    } else {
      process.env.HOGSWAP_HTTP_DELAY_MS = previousDelay;
    }
  }
});
