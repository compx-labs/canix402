import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";
import {
  PoolStatus,
  SwapQuoteType,
  generateSwapRouterTxns,
  type SignerTransaction,
  type V2PoolInfo
} from "@tinymanorg/tinyman-js-sdk";

import {
  InvalidShapeInputError,
  ShapeStateError,
  TransactionShapeRegistry,
  compileExecutableQuote,
  serializeTransaction
} from "../../src/execution/index.js";
import type { ShapeBuildContext } from "../../src/execution/index.js";
import {
  setTinymanSwapRouterDependenciesForTests,
  tinymanSwapFixedInputShape,
  tinymanSwapFixedOutputShape,
  type TinymanSwapRouterDependencies
} from "../../src/execution/shapes/tinyman/swap-router.js";
import {
  ALGO_ASSET_ID,
  COMPX_ASSET_ID,
  ONE_HOP_DIRECT_OUTPUT,
  ONE_HOP_INPUT_AMOUNT,
  ONE_HOP_ROUTER_OUTPUT,
  POOL_ALGO_USDC,
  POOL_COMPX_ALGO,
  POOL_COMPX_USDC,
  TINYMAN_SWAP_ROUTER_APP_ID,
  TINYMAN_V2_VALIDATOR_APP_ID,
  TWO_HOP_DIRECT_OUTPUT,
  TWO_HOP_INPUT_AMOUNT,
  TWO_HOP_ROUTER_FEE,
  TWO_HOP_ROUTER_OUTPUT,
  USDC_ASSET_ID,
  buildDirectSwapGroup,
  oneHopRouterResponse,
  suggestedParams,
  twoHopRouterResponse
} from "../fixtures/tinyman/swap-router.js";

const USER = algosdk.generateAccount();
const USER_ADDRESS = USER.addr.toString();

test.afterEach(() => {
  setTinymanSwapRouterDependenciesForTests(undefined);
});

function context(): ShapeBuildContext {
  return {
    network: "mainnet",
    algod: new algosdk.Algodv2("", "http://localhost", ""),
    now: () => Date.UTC(2026, 8, 7, 12, 0, 0),
    quoteTtlMs: 30_000
  };
}

function mockPool(
  address: string,
  asset1Id = COMPX_ASSET_ID,
  asset2Id = USDC_ASSET_ID
): V2PoolInfo {
  return {
    account: { address: () => address },
    status: PoolStatus.READY,
    asset1ID: asset1Id,
    asset2ID: asset2Id,
    validatorAppID: TINYMAN_V2_VALIDATOR_APP_ID,
    totalFeeShare: 30n,
    asset1Reserves: 10_000_000_000n,
    asset2Reserves: 10_000_000_000n
  } as unknown as V2PoolInfo;
}

function asSignerTxns(group: algosdk.Transaction[]): SignerTransaction[] {
  return group.map((txn) => ({ txn, signers: [USER_ADDRESS] }));
}

function fakeAlgod(): algosdk.Algodv2 {
  return {
    getTransactionParams: () => ({
      do: async () => suggestedParams(1000)
    })
  } as unknown as algosdk.Algodv2;
}

function resolveDecimals(): TinymanSwapRouterDependencies["resolveAssetDecimals"] {
  return async (assetIds) => {
    const map = new Map<number, number>();
    for (const id of assetIds) map.set(id, 6);
    return map;
  };
}

function installRouterWinDeps(kind: "two-hop" | "one-hop"): void {
  const router = kind === "two-hop" ? twoHopRouterResponse() : oneHopRouterResponse();
  const directOut = kind === "two-hop" ? TWO_HOP_DIRECT_OUTPUT : ONE_HOP_DIRECT_OUTPUT;
  const inputAmount = kind === "two-hop" ? TWO_HOP_INPUT_AMOUNT : ONE_HOP_INPUT_AMOUNT;
  const assetInId = kind === "two-hop" ? COMPX_ASSET_ID : ALGO_ASSET_ID;
  const poolAddress = kind === "two-hop" ? POOL_COMPX_USDC : POOL_ALGO_USDC;
  const pool =
    kind === "two-hop"
      ? mockPool(poolAddress, COMPX_ASSET_ID, USDC_ASSET_ID)
      : mockPool(poolAddress, USDC_ASSET_ID, ALGO_ASSET_ID);

  setTinymanSwapRouterDependenciesForTests({
    resolveAssetDecimals: resolveDecimals(),
    getPoolInfo: async () => pool,
    getSwapRoute: async () => router,
    getDirectQuote: () => ({
      type: SwapQuoteType.Direct,
      data: {
        pool,
        quote: {
          assetInID: assetInId,
          assetInAmount: inputAmount,
          assetOutID: USDC_ASSET_ID,
          assetOutAmount: directOut,
          swapFee: 600,
          rate: 0.2,
          priceImpact: 0.02
        }
      }
    }),
    generateTxns: async (params) =>
      generateSwapRouterTxns({
        client: fakeAlgod(),
        initiatorAddr: params.initiatorAddr,
        route: params.quote.type === SwapQuoteType.Router ? params.quote.data : router
      }),
    getRouterAppId: () => TINYMAN_SWAP_ROUTER_APP_ID,
    getValidatorAppId: () => TINYMAN_V2_VALIDATOR_APP_ID
  });
}

test("parseInput rejects identical assets and invalid slippage", () => {
  assert.throws(
    () =>
      tinymanSwapFixedInputShape.parseInput({
        userAddress: USER_ADDRESS,
        assetInId: USDC_ASSET_ID,
        assetOutId: USDC_ASSET_ID,
        amount: "1000000",
        maxSlippageBps: 50
      }),
    InvalidShapeInputError
  );
  assert.throws(
    () =>
      tinymanSwapFixedInputShape.parseInput({
        userAddress: USER_ADDRESS,
        assetInId: 0,
        assetOutId: USDC_ASSET_ID,
        amount: "1000000",
        maxSlippageBps: 20_000
      }),
    InvalidShapeInputError
  );
});

test("fixed-input 2-hop COMPX→USDC returns an unsigned Swap Router group when the router wins", async () => {
  installRouterWinDeps("two-hop");
  const registry = new TransactionShapeRegistry();
  registry.register(tinymanSwapFixedInputShape);

  const quote = await compileExecutableQuote(
    registry,
    tinymanSwapFixedInputShape.key,
    {
      userAddress: USER_ADDRESS,
      assetInId: COMPX_ASSET_ID,
      assetOutId: USDC_ASSET_ID,
      amount: TWO_HOP_INPUT_AMOUNT.toString(),
      maxSlippageBps: 50
    },
    context()
  );

  assert.equal(quote.shapeKey, "mainnet:tinyman:v2:swap:fixedInput");
  assert.equal(quote.metadata.path, "router");
  assert.equal(quote.metadata.hopCount, 2);
  assert.equal(quote.metadata.fallbackReason, undefined);
  assert.equal(quote.metadata.expectedOut, TWO_HOP_ROUTER_OUTPUT.toString());
  assert.equal(quote.metadata.signed, false);
  assert.equal(quote.metadata.submitted, false);
  assert.equal(quote.metadata.crossDexAggregator, false);
  assert.equal(quote.transactions.length, 2);
  assert.equal(quote.transactions[0]?.fee, TWO_HOP_ROUTER_FEE.toString());
  assert.ok(quote.transactions.every((txn) => txn.groupPresent));
  assert.equal(quote.encodedTransactions.length, 2);

  const swapCall = quote.transactions.find((txn) => txn.type === "appl");
  assert.equal(swapCall?.applicationCall?.appIndex, String(TINYMAN_SWAP_ROUTER_APP_ID));
  assert.deepEqual(swapCall?.applicationCall?.appArgsText.slice(0, 2), ["swap", "fixed-input"]);
  assert.ok(swapCall?.applicationCall?.accounts.includes(POOL_COMPX_ALGO));
  assert.ok(swapCall?.applicationCall?.accounts.includes(POOL_ALGO_USDC));

  for (const encoded of quote.encodedTransactions) {
    const txn = algosdk.decodeUnsignedTransaction(Buffer.from(encoded, "base64"));
    assert.equal(txn.sender.toString(), USER_ADDRESS);
  }
});

test("fixed-input 1-hop ALGO→USDC still returns a Swap Router group when it beats the pool", async () => {
  installRouterWinDeps("one-hop");
  const registry = new TransactionShapeRegistry();
  registry.register(tinymanSwapFixedInputShape);

  const quote = await compileExecutableQuote(
    registry,
    tinymanSwapFixedInputShape.key,
    {
      userAddress: USER_ADDRESS,
      assetInId: ALGO_ASSET_ID,
      assetOutId: USDC_ASSET_ID,
      amount: ONE_HOP_INPUT_AMOUNT.toString(),
      maxSlippageBps: 50
    },
    context()
  );

  assert.equal(quote.metadata.path, "router");
  assert.equal(quote.metadata.hopCount, 1);
  assert.equal(quote.metadata.expectedOut, ONE_HOP_ROUTER_OUTPUT.toString());
  assert.equal(quote.transactions[0]?.type, "pay");
  assert.equal(
    quote.transactions[1]?.applicationCall?.appIndex,
    String(TINYMAN_SWAP_ROUTER_APP_ID)
  );
  assert.ok(quote.warnings.some((warning) => warning.includes("opted into")));
});

test("fixed-input falls back to a single-pool unsigned group when the router is worse", async () => {
  const minOut = 198_000n;
  setTinymanSwapRouterDependenciesForTests({
    resolveAssetDecimals: resolveDecimals(),
    getPoolInfo: async () => mockPool(POOL_COMPX_USDC),
    getSwapRoute: async () =>
      twoHopRouterResponse({
        output_amount: "190000",
        output_amount_arg: "188000"
      }),
    getDirectQuote: () => ({
      type: SwapQuoteType.Direct,
      data: {
        pool: mockPool(POOL_COMPX_USDC),
        quote: {
          assetInID: COMPX_ASSET_ID,
          assetInAmount: TWO_HOP_INPUT_AMOUNT,
          assetOutID: USDC_ASSET_ID,
          assetOutAmount: TWO_HOP_DIRECT_OUTPUT,
          swapFee: 600,
          rate: 0.2,
          priceImpact: 0.03
        }
      }
    }),
    generateTxns: async () =>
      asSignerTxns(
        buildDirectSwapGroup({
          userAddress: USER_ADDRESS,
          poolAddress: POOL_COMPX_USDC,
          assetInId: COMPX_ASSET_ID,
          inputAmount: TWO_HOP_INPUT_AMOUNT,
          minOut
        })
      ),
    getRouterAppId: () => TINYMAN_SWAP_ROUTER_APP_ID,
    getValidatorAppId: () => TINYMAN_V2_VALIDATOR_APP_ID
  });

  const result = await tinymanSwapFixedInputShape.build(
    context(),
    {
      userAddress: USER_ADDRESS,
      assetInId: COMPX_ASSET_ID,
      assetOutId: USDC_ASSET_ID,
      amount: TWO_HOP_INPUT_AMOUNT,
      maxSlippageBps: 50
    },
    await tinymanSwapFixedInputShape.resolveState(context(), {
      userAddress: USER_ADDRESS,
      assetInId: COMPX_ASSET_ID,
      assetOutId: USDC_ASSET_ID,
      amount: TWO_HOP_INPUT_AMOUNT,
      maxSlippageBps: 50
    })
  );

  assert.equal(result.metadata.path, "direct");
  assert.equal(result.metadata.fallbackReason, "single-pool-better");
  assert.equal(result.metadata.hopCount, 1);
  assert.ok(
    result.warnings.some((warning) => warning.includes("lost to the single-pool path"))
  );

  const serialized = result.transactions.map((txn) => serializeTransaction(txn));
  const swapCall = serialized.find((txn) => txn.type === "appl");
  assert.equal(swapCall?.applicationCall?.appIndex, String(TINYMAN_V2_VALIDATOR_APP_ID));
  assert.equal(result.transactions.length, 2);
});

test("fixed-output shape is registered under a distinct key and shares the adapter", () => {
  assert.equal(tinymanSwapFixedOutputShape.key, "mainnet:tinyman:v2:swap:fixedOutput");
  assert.equal(tinymanSwapFixedOutputShape.identity.action, "swap");
  assert.deepEqual(tinymanSwapFixedOutputShape.supportedOpportunityTypes, []);
  assert.ok(tinymanSwapFixedInputShape.requiredInputs.includes("assetInId"));
});

test("router-unavailable fallback documents the reason and uses the single-pool group", async () => {
  setTinymanSwapRouterDependenciesForTests({
    resolveAssetDecimals: resolveDecimals(),
    getPoolInfo: async () => mockPool(POOL_COMPX_USDC),
    getSwapRoute: async () => {
      throw new Error("analytics down");
    },
    getDirectQuote: () => ({
      type: SwapQuoteType.Direct,
      data: {
        pool: mockPool(POOL_COMPX_USDC),
        quote: {
          assetInID: COMPX_ASSET_ID,
          assetInAmount: TWO_HOP_INPUT_AMOUNT,
          assetOutID: USDC_ASSET_ID,
          assetOutAmount: TWO_HOP_DIRECT_OUTPUT,
          swapFee: 600,
          rate: 0.2,
          priceImpact: 0.03
        }
      }
    }),
    generateTxns: async () =>
      asSignerTxns(
        buildDirectSwapGroup({
          userAddress: USER_ADDRESS,
          poolAddress: POOL_COMPX_USDC,
          assetInId: COMPX_ASSET_ID,
          inputAmount: TWO_HOP_INPUT_AMOUNT,
          minOut: 198_000n
        })
      ),
    getRouterAppId: () => TINYMAN_SWAP_ROUTER_APP_ID,
    getValidatorAppId: () => TINYMAN_V2_VALIDATOR_APP_ID
  });

  const state = await tinymanSwapFixedInputShape.resolveState(context(), {
    userAddress: USER_ADDRESS,
    assetInId: COMPX_ASSET_ID,
    assetOutId: USDC_ASSET_ID,
    amount: TWO_HOP_INPUT_AMOUNT,
    maxSlippageBps: 50
  });
  const result = await tinymanSwapFixedInputShape.build(
    context(),
    {
      userAddress: USER_ADDRESS,
      assetInId: COMPX_ASSET_ID,
      assetOutId: USDC_ASSET_ID,
      amount: TWO_HOP_INPUT_AMOUNT,
      maxSlippageBps: 50
    },
    state
  );

  assert.equal(result.metadata.path, "direct");
  assert.equal(result.metadata.fallbackReason, "router-unavailable");
  assert.ok(
    result.warnings.some((warning) => warning.includes("Swap Router quote was unavailable"))
  );
});

test("no ready single pool keeps the Swap Router group and documents no-single-pool", async () => {
  setTinymanSwapRouterDependenciesForTests({
    resolveAssetDecimals: resolveDecimals(),
    getPoolInfo: async () => {
      throw new Error("pool missing");
    },
    getSwapRoute: async () => twoHopRouterResponse(),
    generateTxns: async (params) =>
      generateSwapRouterTxns({
        client: fakeAlgod(),
        initiatorAddr: params.initiatorAddr,
        route:
          params.quote.type === SwapQuoteType.Router
            ? params.quote.data
            : twoHopRouterResponse()
      }),
    getRouterAppId: () => TINYMAN_SWAP_ROUTER_APP_ID,
    getValidatorAppId: () => TINYMAN_V2_VALIDATOR_APP_ID
  });

  const registry = new TransactionShapeRegistry();
  registry.register(tinymanSwapFixedInputShape);
  const quote = await compileExecutableQuote(
    registry,
    tinymanSwapFixedInputShape.key,
    {
      userAddress: USER_ADDRESS,
      assetInId: COMPX_ASSET_ID,
      assetOutId: USDC_ASSET_ID,
      amount: TWO_HOP_INPUT_AMOUNT.toString(),
      maxSlippageBps: 50
    },
    context()
  );

  assert.equal(quote.metadata.path, "router");
  assert.equal(quote.metadata.fallbackReason, "no-single-pool");
  assert.equal(quote.metadata.hopCount, 2);
  assert.equal(
    quote.transactions[1]?.applicationCall?.appIndex,
    String(TINYMAN_SWAP_ROUTER_APP_ID)
  );
  assert.ok(
    quote.warnings.some((warning) => warning.includes("No ready Tinyman v2 pool"))
  );
});

test("both quote paths failing raises ShapeStateError", async () => {
  setTinymanSwapRouterDependenciesForTests({
    resolveAssetDecimals: resolveDecimals(),
    getPoolInfo: async () => {
      throw new Error("pool missing");
    },
    getSwapRoute: async () => {
      throw new Error("analytics down");
    },
    getRouterAppId: () => TINYMAN_SWAP_ROUTER_APP_ID,
    getValidatorAppId: () => TINYMAN_V2_VALIDATOR_APP_ID
  });

  await assert.rejects(
    () =>
      tinymanSwapFixedInputShape.resolveState(context(), {
        userAddress: USER_ADDRESS,
        assetInId: COMPX_ASSET_ID,
        assetOutId: USDC_ASSET_ID,
        amount: TWO_HOP_INPUT_AMOUNT,
        maxSlippageBps: 50
      }),
    ShapeStateError
  );
});
