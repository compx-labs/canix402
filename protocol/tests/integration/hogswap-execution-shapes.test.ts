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
  hogswapSwapFixedInputShape,
  hogswapSwapFixedOutputShape,
  setHogswapSwapDependenciesForTests,
  setHogswapSwapGroupDependenciesForTests
} from "../../src/execution/shapes/hogswap/index.js";
import {
  HogswapNoRouteError,
  parseHogswapQuote,
  type HogswapExecuteResult,
  type HogswapQuote
} from "../../src/services/hogswap-client.js";
import {
  assertEncodedGroupIsValid,
  assertGoldenGroup
} from "../helpers/golden-group.js";
import {
  hogswapAlgoUsdcQuotePayload,
  hogswapGoldUsdcQuotePayload,
  HOGSWAP_FIXTURE_GOLD_ASSET_ID,
  HOGSWAP_FIXTURE_ROUTER_APP_ID,
  HOGSWAP_FIXTURE_USDC_ASSET_ID
} from "../fixtures/hogswap/swap.js";

const USER = algosdk.generateAccount();
const USER_ADDRESS = USER.addr.toString();
const GENESIS_HASH = new Uint8Array(32).fill(11);
const QUOTED_AT = Date.UTC(2026, 8, 7, 12, 0, 0);

test.afterEach(() => {
  setHogswapSwapDependenciesForTests(undefined);
  setHogswapSwapGroupDependenciesForTests(undefined);
});

function suggestedParams(fee: number): algosdk.SuggestedParams {
  return {
    fee: BigInt(fee),
    minFee: 1000n,
    firstValid: 1000n,
    lastValid: 2000n,
    genesisID: "mainnet-v1.0",
    genesisHash: GENESIS_HASH,
    flatFee: true
  };
}

function buildContext(nowMs = QUOTED_AT): ShapeBuildContext {
  return {
    network: "mainnet",
    algod: new algosdk.Algodv2("", "http://localhost", ""),
    now: () => nowMs,
    quoteTtlMs: 30_000
  };
}

function encodeMember(txn: algosdk.Transaction): { txnB64: string; description: string } {
  return {
    txnB64: Buffer.from(algosdk.encodeUnsignedTransaction(txn)).toString("base64"),
    description: txn.type === "appl" ? "HOGSWAP router call" : "asset transfer"
  };
}

function buildUnsignedSwapGroup(input: {
  assetIndex: number;
  amount: bigint;
  routerAppId?: number;
}): { transactions: algosdk.Transaction[]; execute: HogswapExecuteResult } {
  const routerAppId = input.routerAppId ?? HOGSWAP_FIXTURE_ROUTER_APP_ID;
  const params = suggestedParams(1000);
  const receiver = algosdk.getApplicationAddress(routerAppId).toString();
  const transfer =
    input.assetIndex === 0
      ? algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          sender: USER_ADDRESS,
          receiver,
          amount: input.amount,
          suggestedParams: params
        })
      : algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          sender: USER_ADDRESS,
          receiver,
          amount: input.amount,
          assetIndex: input.assetIndex,
          suggestedParams: params
        });
  const appl = algosdk.makeApplicationNoOpTxnFromObject({
    sender: USER_ADDRESS,
    appIndex: BigInt(routerAppId),
    suggestedParams: { ...params, fee: 5000n, flatFee: true }
  });
  const transactions = [transfer, appl];
  algosdk.assignGroupID(transactions);
  return {
    transactions,
    execute: {
      quoteId: "q-fixture",
      unsignedGroup: transactions.map(encodeMember),
      routerAppId,
      groupIdB64: Buffer.from(transactions[0]?.group ?? new Uint8Array()).toString("base64"),
      assetIn: input.assetIndex,
      assetOut: HOGSWAP_FIXTURE_USDC_ASSET_ID,
      amountIn: Number(input.amount),
      minOutAtSlippage: 94_169,
      networkFeeMicroalgo: 19_000,
      notes: ["unsigned; never broadcast"],
      raw: {}
    }
  };
}

function swapQuote(payload: Record<string, unknown>): HogswapQuote {
  const quote = parseHogswapQuote(payload);
  quote.quotedAtMs = QUOTED_AT;
  return quote;
}

test("fixed-in ALGO→USDC compiles an unsigned HOGSWAP group", async () => {
  const { execute } = buildUnsignedSwapGroup({
    assetIndex: 0,
    amount: 1_000_000n
  });
  setHogswapSwapDependenciesForTests({
    quoteSwap: async (request) => {
      assert.equal(request.assetIn, 0);
      assert.equal(request.assetOut, HOGSWAP_FIXTURE_USDC_ASSET_ID);
      assert.equal(request.amountIn, 1_000_000n);
      assert.equal(request.amountOut, undefined);
      return swapQuote(hogswapAlgoUsdcQuotePayload);
    }
  });
  setHogswapSwapGroupDependenciesForTests({
    executeQuote: async () => execute
  });

  const registry = new TransactionShapeRegistry();
  registry.register(hogswapSwapFixedInputShape);
  const quote = await compileExecutableQuote(
    registry,
    hogswapSwapFixedInputShape.key,
    {
      userAddress: USER_ADDRESS,
      fromAssetId: 0,
      toAssetId: String(HOGSWAP_FIXTURE_USDC_ASSET_ID),
      amount: "1000000",
      maxSlippageBps: 50
    },
    buildContext()
  );

  assert.equal(quote.shapeKey, "mainnet:hogswap:v1:swap:fixed-input");
  assert.equal(quote.identity.protocol, "hogswap");
  assert.equal(quote.transactions.length, 2);
  assert.equal(quote.metadata?.signed, false);
  assert.equal(quote.metadata?.submitted, false);
  assert.equal(quote.metadata?.executionSubmitted, false);
  assert.equal(quote.metadata?.router, "hogswap");
  assert.equal(quote.metadata?.quotedAmount, "94738");
  assert.equal(quote.metadata?.routerFeeAlreadyNetted, true);
  assert.equal(quote.metadata?.routerAppId, HOGSWAP_FIXTURE_ROUTER_APP_ID);
  assert.match(quote.warnings.join(" "), /already netted/);
  assert.match(quote.warnings.join(" "), /does not sign or submit/);
  assertEncodedGroupIsValid(quote.encodedTransactions);
  assertGoldenGroup(quote.transactions, {
    types: ["pay", "appl"],
    members: [
      {
        type: "pay",
        fee: "1000",
        appIndex: null,
        amount: "1000000",
        assetIndex: null,
        receiver: algosdk.getApplicationAddress(HOGSWAP_FIXTURE_ROUTER_APP_ID).toString()
      },
      {
        type: "appl",
        fee: "5000",
        appIndex: String(HOGSWAP_FIXTURE_ROUTER_APP_ID),
        amount: null,
        assetIndex: null,
        receiver: null
      }
    ],
    userSignIndexes: [0, 1]
  });
});

test("fixed-in GOLD→USDC compiles an unsigned ASA→ASA HOGSWAP group", async () => {
  const { execute } = buildUnsignedSwapGroup({
    assetIndex: HOGSWAP_FIXTURE_GOLD_ASSET_ID,
    amount: 1_000_000n
  });
  setHogswapSwapDependenciesForTests({
    quoteSwap: async (request) => {
      assert.equal(request.assetIn, HOGSWAP_FIXTURE_GOLD_ASSET_ID);
      assert.equal(request.amountIn, 1_000_000n);
      return swapQuote(hogswapGoldUsdcQuotePayload);
    }
  });
  setHogswapSwapGroupDependenciesForTests({
    executeQuote: async () => execute
  });

  const registry = new TransactionShapeRegistry();
  registry.register(hogswapSwapFixedInputShape);
  const quote = await compileExecutableQuote(
    registry,
    hogswapSwapFixedInputShape.key,
    {
      userAddress: USER_ADDRESS,
      fromAssetId: HOGSWAP_FIXTURE_GOLD_ASSET_ID,
      toAssetId: HOGSWAP_FIXTURE_USDC_ASSET_ID,
      amount: "1000000"
    },
    buildContext()
  );

  assert.equal(quote.metadata?.type, "fixed-input");
  assert.equal(quote.metadata?.fromAssetId, HOGSWAP_FIXTURE_GOLD_ASSET_ID);
  assert.equal(quote.metadata?.quotedAmount, "129668838");
  assert.equal(quote.transactions.length, 2);
  assert.equal(quote.transactions[0]?.type, "axfer");
  assert.equal(
    quote.transactions[0]?.assetTransfer?.assetIndex,
    String(HOGSWAP_FIXTURE_GOLD_ASSET_ID)
  );
  assertEncodedGroupIsValid(quote.encodedTransactions);
});

test("fixed-output shape posts amountOut", async () => {
  const { execute } = buildUnsignedSwapGroup({
    assetIndex: 0,
    amount: 1_000_000n
  });
  let capturedAmountOut: bigint | undefined;
  setHogswapSwapDependenciesForTests({
    quoteSwap: async (request) => {
      capturedAmountOut = request.amountOut;
      assert.equal(request.amountIn, undefined);
      return swapQuote(hogswapAlgoUsdcQuotePayload);
    }
  });
  setHogswapSwapGroupDependenciesForTests({
    executeQuote: async () => execute
  });

  const registry = new TransactionShapeRegistry();
  registry.register(hogswapSwapFixedOutputShape);
  const quote = await compileExecutableQuote(
    registry,
    hogswapSwapFixedOutputShape.key,
    {
      userAddress: USER_ADDRESS,
      fromAssetId: 0,
      toAssetId: HOGSWAP_FIXTURE_USDC_ASSET_ID,
      amount: "94169"
    },
    buildContext()
  );

  assert.equal(capturedAmountOut, 94_169n);
  assert.equal(quote.shapeKey, "mainnet:hogswap:v1:swap:fixed-output");
  assert.equal(quote.metadata?.type, "fixed-output");
  assert.equal(quote.metadata?.executionSubmitted, false);
});

test("swap parseInput rejects identical assets", () => {
  assert.throws(
    () =>
      hogswapSwapFixedInputShape.parseInput({
        userAddress: USER_ADDRESS,
        fromAssetId: 0,
        toAssetId: 0,
        amount: "1000000"
      }),
    InvalidShapeInputError
  );
});

test("swap shape maps quote 404 to a no-route state error", async () => {
  setHogswapSwapDependenciesForTests({
    quoteSwap: async () => {
      throw new HogswapNoRouteError("HOGSWAP /quote returned HTTP 404: no route", 404);
    }
  });
  const registry = new TransactionShapeRegistry();
  registry.register(hogswapSwapFixedInputShape);
  await assert.rejects(
    compileExecutableQuote(
      registry,
      hogswapSwapFixedInputShape.key,
      {
        userAddress: USER_ADDRESS,
        fromAssetId: 0,
        toAssetId: HOGSWAP_FIXTURE_USDC_ASSET_ID,
        amount: "1000000"
      },
      buildContext()
    ),
    (error: unknown) => {
      assert.ok(error instanceof ShapeStateError);
      assert.match(error.message, /no route/);
      return true;
    }
  );
});

test("swap shape rejects a stale HOGSWAP quote before execute", async () => {
  setHogswapSwapDependenciesForTests({
    quoteSwap: async () => {
      const quote = swapQuote(hogswapAlgoUsdcQuotePayload);
      quote.quotedAtMs = QUOTED_AT - 31_000;
      return quote;
    }
  });
  setHogswapSwapGroupDependenciesForTests({
    executeQuote: async () => {
      throw new Error("execute must not run for a stale quote");
    }
  });
  const registry = new TransactionShapeRegistry();
  registry.register(hogswapSwapFixedInputShape);
  await assert.rejects(
    compileExecutableQuote(
      registry,
      hogswapSwapFixedInputShape.key,
      {
        userAddress: USER_ADDRESS,
        fromAssetId: 0,
        toAssetId: HOGSWAP_FIXTURE_USDC_ASSET_ID,
        amount: "1000000"
      },
      buildContext()
    ),
    (error: unknown) => {
      assert.ok(error instanceof ShapeStateError);
      assert.match(error.message, /stale-quote/);
      return true;
    }
  );
});

test("createExecutionRegistry registers HOGSWAP swap keys", () => {
  const registry = createExecutionRegistry();
  assert.equal(registry.has("mainnet:hogswap:v1:swap:fixed-input"), true);
  assert.equal(registry.has("mainnet:hogswap:v1:swap:fixed-output"), true);
  assert.ok(hogswapSwapFixedInputShape.requiredInputs.includes("fromAssetId"));
  assert.ok(hogswapSwapFixedInputShape.requiredInputs.includes("maxSlippageBps"));
  assert.equal(hogswapSwapFixedInputShape.opportunityRole, "enter");
});
