import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import {
  SWAP_ONE_HOP_SELECTOR_HEX,
  SWAP_TWO_HOP_SELECTOR_HEX,
  packRouterSwaps,
  pactSwapInterfaceName
} from "../../src/execution/shapes/pact/router-abi.js";
import {
  PactSmartRouterError,
  applyPactSmartRouterMinOut,
  findAssetPaths,
  quotePactSmartRouter,
  resolvePactSmartRouterAppId,
  setPactSmartRouterDependenciesForTests
} from "../../src/services/pact-smart-router.js";
import {
  PACT_FIXTURE_ALGO_USDC_POOL_APP_ID,
  PACT_FIXTURE_USDC_X_POOL_APP_ID,
  PACT_SMART_ROUTER_ALGO_ID,
  PACT_SMART_ROUTER_FIXTURE_APP_ID,
  PACT_SMART_ROUTER_TOKEN_X_ID,
  PACT_SMART_ROUTER_TOKEN_Y_ID,
  PACT_SMART_ROUTER_USDC_ID,
  pactSmartRouterAlgoUsdcHighFee,
  pactSmartRouterDiscoveryPools,
  pactSmartRouterSinglePool,
  pactSmartRouterUsdcXPool,
  pactSmartRouterXYPool
} from "../fixtures/pact-smart-router.js";

test.afterEach(() => {
  setPactSmartRouterDependenciesForTests(undefined);
  delete process.env.PACT_SMART_ROUTER_APP_ID;
});

test("SWAP ABI selectors match pact-docs router_interface.json", () => {
  assert.equal(SWAP_ONE_HOP_SELECTOR_HEX, "3a8c06cf");
  assert.equal(SWAP_TWO_HOP_SELECTOR_HEX, "84dd8e10");
});

test("pactSwapInterfaceName maps ALGO legs", () => {
  assert.equal(pactSwapInterfaceName(0, PACT_SMART_ROUTER_USDC_ID), "PACT_SWAP_ALGOS_ASA");
  assert.equal(pactSwapInterfaceName(PACT_SMART_ROUTER_USDC_ID, 0), "PACT_SWAP_ASA_ALGOS");
  assert.equal(
    pactSwapInterfaceName(PACT_SMART_ROUTER_USDC_ID, PACT_SMART_ROUTER_TOKEN_X_ID),
    "PACT_SWAP_ASA_ASA"
  );
});

test("packRouterSwaps uses packed 2-hop then 1-hop for three pools", () => {
  const hops = [
    {
      poolAppId: 1,
      poolEscrowAddress: algosdk.getApplicationAddress(1).toString(),
      fromAssetId: 0,
      toAssetId: 2,
      amountIn: 100n,
      amountOut: 90n,
      feeBps: 30
    },
    {
      poolAppId: 2,
      poolEscrowAddress: algosdk.getApplicationAddress(2).toString(),
      fromAssetId: 2,
      toAssetId: 3,
      amountIn: 90n,
      amountOut: 80n,
      feeBps: 30
    },
    {
      poolAppId: 3,
      poolEscrowAddress: algosdk.getApplicationAddress(3).toString(),
      fromAssetId: 3,
      toAssetId: 4,
      amountIn: 80n,
      amountOut: 70n,
      feeBps: 30
    }
  ];
  const packed = packRouterSwaps(hops, 69n);
  assert.equal(packed.length, 2);
  assert.equal(packed[0]?.variant, "two");
  assert.equal(packed[0]?.minExpected, 0n);
  assert.equal(packed[1]?.variant, "one");
  assert.equal(packed[1]?.minExpected, 69n);
});

test("findAssetPaths returns 1-hop and 2-hop sequences", () => {
  const paths = findAssetPaths(
    pactSmartRouterDiscoveryPools,
    PACT_SMART_ROUTER_ALGO_ID,
    PACT_SMART_ROUTER_TOKEN_X_ID
  );
  assert.ok(paths.some((path) => path.length === 3));
  assert.ok(
    paths.some(
      (path) =>
        path[0] === PACT_SMART_ROUTER_ALGO_ID &&
        path[1] === PACT_SMART_ROUTER_USDC_ID &&
        path[2] === PACT_SMART_ROUTER_TOKEN_X_ID
    )
  );
});

test("quotePactSmartRouter picks the better fee-tier pool on a 1-hop pair", async () => {
  setPactSmartRouterDependenciesForTests({
    fetchPools: async () => [pactSmartRouterSinglePool, pactSmartRouterAlgoUsdcHighFee],
    quoteHop: async ({ pool, fromAssetId, amountIn }) => {
      const amountOut = pool.poolAppId === PACT_FIXTURE_ALGO_USDC_POOL_APP_ID ? 990_000n : 900_000n;
      const toAssetId =
        fromAssetId === pool.primaryAssetId ? pool.secondaryAssetId : pool.primaryAssetId;
      return {
        poolAppId: pool.poolAppId,
        poolEscrowAddress: pool.escrowAddress ?? algosdk.getApplicationAddress(pool.poolAppId).toString(),
        fromAssetId,
        toAssetId,
        amountIn,
        amountOut,
        feeBps: pool.feeBps
      };
    }
  });

  const quote = await quotePactSmartRouter({
    fromAssetId: PACT_SMART_ROUTER_ALGO_ID,
    toAssetId: PACT_SMART_ROUTER_USDC_ID,
    amount: 1_000_000n,
    maxSlippageBps: 50
  });

  assert.equal(quote.hops.length, 1);
  assert.equal(quote.hops[0]?.poolAppId, PACT_FIXTURE_ALGO_USDC_POOL_APP_ID);
  assert.equal(quote.amountOut, 990_000n);
  assert.equal(quote.minAmountOut, applyPactSmartRouterMinOut(990_000n, 50));
  assert.equal(quote.quoteSource.publicQuoteHttp, false);
  assert.equal(quote.quoteSource.sdkRouterModule, false);
  assert.match(quote.quoteSource.hopQuote, /prepareSwap/);
});

test("quotePactSmartRouter returns a multi-hop route when that is the only path", async () => {
  setPactSmartRouterDependenciesForTests({
    fetchPools: async () => [pactSmartRouterSinglePool, pactSmartRouterUsdcXPool],
    quoteHop: async ({ pool, fromAssetId, amountIn }) => {
      const toAssetId =
        fromAssetId === pool.primaryAssetId ? pool.secondaryAssetId : pool.primaryAssetId;
      const amountOut =
        pool.poolAppId === PACT_FIXTURE_ALGO_USDC_POOL_APP_ID ? 500_000n : amountIn - 1_000n;
      return {
        poolAppId: pool.poolAppId,
        poolEscrowAddress: pool.escrowAddress ?? algosdk.getApplicationAddress(pool.poolAppId).toString(),
        fromAssetId,
        toAssetId,
        amountIn,
        amountOut,
        feeBps: pool.feeBps
      };
    }
  });

  const quote = await quotePactSmartRouter({
    fromAssetId: PACT_SMART_ROUTER_ALGO_ID,
    toAssetId: PACT_SMART_ROUTER_TOKEN_X_ID,
    amount: 1_000_000n,
    maxSlippageBps: 100
  });

  assert.equal(quote.hops.length, 2);
  assert.equal(quote.hops[0]?.poolAppId, PACT_FIXTURE_ALGO_USDC_POOL_APP_ID);
  assert.equal(quote.hops[1]?.poolAppId, PACT_FIXTURE_USDC_X_POOL_APP_ID);
  assert.equal(quote.hops[0]?.toAssetId, PACT_SMART_ROUTER_USDC_ID);
  assert.equal(quote.toAssetId, PACT_SMART_ROUTER_TOKEN_X_ID);
});

test("quotePactSmartRouter discovers pools via GET /pools", async () => {
  const urls: string[] = [];
  setPactSmartRouterDependenciesForTests({
    fetch: async (input) => {
      const url = String(input);
      urls.push(url);
      return new Response(
        JSON.stringify({
          results: [
            {
              on_chain_id: String(pactSmartRouterSinglePool.poolAppId),
              address: pactSmartRouterSinglePool.escrowAddress,
              fee_bps: 30,
              tvl_usd: "1000000",
              is_verified: true,
              primary_asset: { on_chain_id: "0" },
              secondary_asset: { on_chain_id: String(PACT_SMART_ROUTER_USDC_ID) }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    },
    quoteHop: async ({ pool, fromAssetId, amountIn }) => ({
      poolAppId: pool.poolAppId,
      poolEscrowAddress: algosdk.getApplicationAddress(pool.poolAppId).toString(),
      fromAssetId,
      toAssetId: PACT_SMART_ROUTER_USDC_ID,
      amountIn,
      amountOut: 900_000n,
      feeBps: 30
    })
  });

  const quote = await quotePactSmartRouter({
    fromAssetId: PACT_SMART_ROUTER_ALGO_ID,
    toAssetId: PACT_SMART_ROUTER_USDC_ID,
    amount: 1_000_000n,
    maxSlippageBps: 50
  });

  assert.ok(urls[0]?.includes("/pools?"));
  assert.equal(quote.hops[0]?.poolAppId, PACT_FIXTURE_ALGO_USDC_POOL_APP_ID);
});

test("resolvePactSmartRouterAppId requires env or override", () => {
  assert.throws(
    () => resolvePactSmartRouterAppId(),
    (error: unknown) => error instanceof PactSmartRouterError && error.kind === "configuration"
  );
  process.env.PACT_SMART_ROUTER_APP_ID = String(PACT_SMART_ROUTER_FIXTURE_APP_ID);
  assert.equal(resolvePactSmartRouterAppId(), PACT_SMART_ROUTER_FIXTURE_APP_ID);
  assert.equal(resolvePactSmartRouterAppId(12), 12);
});

test("quotePactSmartRouter throws no-route when assets are disconnected", async () => {
  setPactSmartRouterDependenciesForTests({
    fetchPools: async () => [pactSmartRouterXYPool],
    quoteHop: async () => null
  });
  await assert.rejects(
    () =>
      quotePactSmartRouter({
        fromAssetId: PACT_SMART_ROUTER_ALGO_ID,
        toAssetId: PACT_SMART_ROUTER_TOKEN_Y_ID,
        amount: 1_000_000n,
        maxSlippageBps: 50
      }),
    (error: unknown) => error instanceof PactSmartRouterError && error.kind === "no-route"
  );
});
