import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import {
  InvalidShapeInputError,
  ShapeStateError,
  TransactionShapeRegistry,
  compileExecutableQuote,
  createExecutionRegistry
} from "../../src/execution/index.js";
import type { ShapeBuildContext } from "../../src/execution/index.js";
import {
  SWAP_ONE_HOP_SELECTOR_HEX,
  SWAP_TWO_HOP_SELECTOR_HEX,
  pactSmartRouterSwapShape,
  setPactSmartRouterSwapDependenciesForTests
} from "../../src/execution/shapes/pact/index.js";
import { setPactSmartRouterDependenciesForTests } from "../../src/services/pact-smart-router.js";
import {
  assertEncodedGroupIsValid,
  assertGoldenGroup
} from "../helpers/golden-group.js";
import {
  PACT_FIXTURE_ALGO_USDC_POOL_APP_ID,
  PACT_FIXTURE_USDC_X_POOL_APP_ID,
  PACT_SMART_ROUTER_ALGO_ID,
  PACT_SMART_ROUTER_FIXTURE_APP_ID,
  PACT_SMART_ROUTER_TOKEN_X_ID,
  PACT_SMART_ROUTER_USDC_ID,
  pactSmartRouterSinglePool,
  pactSmartRouterUsdcXPool
} from "../fixtures/pact-smart-router.js";

const USER = algosdk.generateAccount();
const USER_ADDRESS = USER.addr.toString();
const GENESIS_HASH = new Uint8Array(32).fill(13);
const QUOTED_AT = Date.UTC(2026, 8, 7, 12, 0, 0);
const ROUTER_ADDRESS = algosdk
  .getApplicationAddress(PACT_SMART_ROUTER_FIXTURE_APP_ID)
  .toString();

function suggestedParams(): algosdk.SuggestedParams {
  return {
    fee: 1000n,
    minFee: 1000n,
    firstValid: 1000n,
    lastValid: 2000n,
    genesisID: "mainnet-v1.0",
    genesisHash: GENESIS_HASH,
    flatFee: true
  };
}

function buildContext(): ShapeBuildContext {
  return {
    network: "mainnet",
    algod: new algosdk.Algodv2("", "http://localhost", ""),
    now: () => QUOTED_AT,
    quoteTtlMs: 30_000
  };
}

test.afterEach(() => {
  setPactSmartRouterSwapDependenciesForTests(undefined);
  setPactSmartRouterDependenciesForTests(undefined);
});

function stubQuoteHops(): void {
  setPactSmartRouterDependenciesForTests({
    fetchPools: async () => [pactSmartRouterSinglePool, pactSmartRouterUsdcXPool],
    quoteHop: async ({ pool, fromAssetId, amountIn }) => {
      const toAssetId =
        fromAssetId === pool.primaryAssetId ? pool.secondaryAssetId : pool.primaryAssetId;
      const amountOut =
        pool.poolAppId === PACT_FIXTURE_ALGO_USDC_POOL_APP_ID ? 500_000n : 480_000n;
      return {
        poolAppId: pool.poolAppId,
        poolEscrowAddress:
          pool.escrowAddress ?? algosdk.getApplicationAddress(pool.poolAppId).toString(),
        fromAssetId,
        toAssetId,
        amountIn,
        amountOut,
        feeBps: pool.feeBps
      };
    }
  });
}

test("registry includes Pact Smart Router swap without attaching it to LP rows", () => {
  const registry = createExecutionRegistry();
  assert.equal(registry.has("mainnet:pact:smart-router:swap:fixed-input"), true);
  assert.equal(pactSmartRouterSwapShape.supportedOpportunityTypes.length, 0);
  assert.equal(
    registry.listForOpportunity("pact", "lp").some(
      (shape) => shape.key === pactSmartRouterSwapShape.key
    ),
    false
  );
});

test("single-pool Pact Smart Router fixture is deposit + 1-hop SWAP", async () => {
  stubQuoteHops();
  setPactSmartRouterSwapDependenciesForTests({
    getSuggestedParams: async () => suggestedParams()
  });

  const registry = new TransactionShapeRegistry();
  registry.register(pactSmartRouterSwapShape);
  const quote = await compileExecutableQuote(
    registry,
    pactSmartRouterSwapShape.key,
    {
      userAddress: USER_ADDRESS,
      fromAssetId: PACT_SMART_ROUTER_ALGO_ID,
      toAssetId: PACT_SMART_ROUTER_USDC_ID,
      amount: "1000000",
      maxSlippageBps: 50,
      routerAppId: PACT_SMART_ROUTER_FIXTURE_APP_ID
    },
    buildContext()
  );

  assert.equal(quote.shapeKey, "mainnet:pact:smart-router:swap:fixed-input");
  assert.deepEqual(
    quote.transactions.map((txn) => txn.type),
    ["pay", "appl"]
  );
  assert.equal(quote.transactions[0]?.payment?.receiver, ROUTER_ADDRESS);
  assert.equal(quote.transactions[0]?.payment?.amount, "1000000");
  assert.equal(
    quote.transactions[1]?.applicationCall?.appIndex,
    String(PACT_SMART_ROUTER_FIXTURE_APP_ID)
  );
  const selector = Buffer.from(
    quote.transactions[1]?.applicationCall?.appArgsBase64[0] ?? "",
    "base64"
  ).toString("hex");
  assert.equal(selector, SWAP_ONE_HOP_SELECTOR_HEX);
  assert.ok(
    quote.transactions[1]?.applicationCall?.foreignApps.includes(
      String(PACT_FIXTURE_ALGO_USDC_POOL_APP_ID)
    )
  );
  assert.equal(quote.metadata.hopCount, 1);
  assert.equal(quote.encodedTransactions.length, 2);
  assertEncodedGroupIsValid(quote.encodedTransactions);
  quote.encodedTransactions.forEach((encoded) => {
    const txn = algosdk.decodeUnsignedTransaction(Buffer.from(encoded, "base64"));
    assert.equal(txn.group !== undefined, true);
  });
  assertGoldenGroup(quote.transactions, {
    types: ["pay", "appl"],
    members: [
      {
        type: "pay",
        fee: "1000",
        appIndex: null,
        amount: "1000000",
        assetIndex: null,
        receiver: ROUTER_ADDRESS
      },
      {
        type: "appl",
        fee: "5000",
        appIndex: String(PACT_SMART_ROUTER_FIXTURE_APP_ID),
        amount: null,
        assetIndex: null,
        receiver: null
      }
    ],
    userSignIndexes: [0, 1]
  });
});

test("multi-hop Pact Smart Router fixture is deposit + packed 2-hop SWAP", async () => {
  stubQuoteHops();
  setPactSmartRouterSwapDependenciesForTests({
    getSuggestedParams: async () => suggestedParams()
  });

  const registry = new TransactionShapeRegistry();
  registry.register(pactSmartRouterSwapShape);
  const quote = await compileExecutableQuote(
    registry,
    pactSmartRouterSwapShape.key,
    {
      userAddress: USER_ADDRESS,
      fromAssetId: PACT_SMART_ROUTER_ALGO_ID,
      toAssetId: PACT_SMART_ROUTER_TOKEN_X_ID,
      amount: "1000000",
      maxSlippageBps: 50,
      routerAppId: PACT_SMART_ROUTER_FIXTURE_APP_ID
    },
    buildContext()
  );

  assert.equal(quote.metadata.hopCount, 2);
  assert.deepEqual(
    quote.transactions.map((txn) => txn.type),
    ["pay", "appl"]
  );
  const selector = Buffer.from(
    quote.transactions[1]?.applicationCall?.appArgsBase64[0] ?? "",
    "base64"
  ).toString("hex");
  assert.equal(selector, SWAP_TWO_HOP_SELECTOR_HEX);
  const foreignApps = quote.transactions[1]?.applicationCall?.foreignApps ?? [];
  assert.ok(foreignApps.includes(String(PACT_FIXTURE_ALGO_USDC_POOL_APP_ID)));
  assert.ok(foreignApps.includes(String(PACT_FIXTURE_USDC_X_POOL_APP_ID)));
  assert.equal(quote.transactions[1]?.applicationCall?.appIndex, String(PACT_SMART_ROUTER_FIXTURE_APP_ID));
  assert.equal((quote.metadata.quoteSource as { publicQuoteHttp?: boolean }).publicQuoteHttp, false);
  assertEncodedGroupIsValid(quote.encodedTransactions);
  assert.equal(quote.transactions.every((txn) => txn.groupPresent), true);
});

test("parseInput rejects identical assets and missing router configuration", async () => {
  assert.throws(
    () =>
      pactSmartRouterSwapShape.parseInput({
        userAddress: USER_ADDRESS,
        fromAssetId: 0,
        toAssetId: 0,
        amount: "1",
        maxSlippageBps: 50
      }),
    InvalidShapeInputError
  );

  stubQuoteHops();
  setPactSmartRouterSwapDependenciesForTests({
    getSuggestedParams: async () => suggestedParams()
  });
  const registry = new TransactionShapeRegistry();
  registry.register(pactSmartRouterSwapShape);
  await assert.rejects(
    () =>
      compileExecutableQuote(
        registry,
        pactSmartRouterSwapShape.key,
        {
          userAddress: USER_ADDRESS,
          fromAssetId: PACT_SMART_ROUTER_ALGO_ID,
          toAssetId: PACT_SMART_ROUTER_USDC_ID,
          amount: "1000000",
          maxSlippageBps: 50
        },
        buildContext()
      ),
    ShapeStateError
  );
});
