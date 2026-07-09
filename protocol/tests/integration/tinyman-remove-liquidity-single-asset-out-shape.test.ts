import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";
import type { PoolReserves, SignerTransaction, V2PoolInfo } from "@tinymanorg/tinyman-js-sdk";

import {
  InvalidShapeInputError,
  TransactionShapeRegistry,
  compileExecutableQuote,
  serializeTransaction
} from "../../src/execution/index.js";
import type {
  SerializedTransaction,
  ShapeBuildContext
} from "../../src/execution/index.js";
import { tinymanRemoveLiquiditySingleAssetOutShape } from "../../src/execution/shapes/tinyman/index.js";
import {
  setTinymanRemoveLiquiditySingleAssetOutDependenciesForTests,
  type TinymanRemoveLiquiditySingleAssetOutInput
} from "../../src/execution/shapes/tinyman/remove-liquidity-single-asset-out.js";
import type { TinymanV2PoolState } from "../../src/execution/shapes/tinyman/pool-state.js";

const USER = algosdk.generateAccount();
const POOL = algosdk.generateAccount();
const USER_ADDRESS = USER.addr.toString();
const POOL_ADDRESS = POOL.addr.toString();
const VALIDATOR_APP_ID = 1002541853;
const GENESIS_HASH = new Uint8Array(32).fill(9);

const USDC_ID = 31566704;
const ALGO_ID = 0;
const POOL_TOKEN_ID = 900001;

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

function buildContext(): ShapeBuildContext {
  return {
    network: "mainnet",
    algod: new algosdk.Algodv2("", "http://localhost", ""),
    now: () => Date.UTC(2026, 6, 8, 20, 0, 0),
    quoteTtlMs: 30_000
  };
}

interface SingleAssetOutGroupParams {
  poolTokenAmount: bigint;
  poolTokenId: number;
  outputAssetId: number;
  validatorAppId: number;
  appFee: number;
  minAsset1Out: bigint;
  minAsset2Out: bigint;
}

function buildSingleAssetOutGroup(
  params: SingleAssetOutGroupParams
): algosdk.Transaction[] {
  const poolTokenTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: USER.addr,
    receiver: POOL.addr,
    amount: params.poolTokenAmount,
    assetIndex: params.poolTokenId,
    suggestedParams: suggestedParams(1000)
  });

  const appTxn = algosdk.makeApplicationCallTxnFromObject({
    sender: USER.addr,
    appIndex: BigInt(params.validatorAppId),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [
      new TextEncoder().encode("remove_liquidity"),
      algosdk.encodeUint64(params.minAsset1Out),
      algosdk.encodeUint64(params.minAsset2Out)
    ],
    foreignAssets: [params.outputAssetId],
    accounts: [POOL.addr],
    suggestedParams: suggestedParams(params.appFee)
  });

  const group = [poolTokenTxn, appTxn];
  algosdk.assignGroupID(group);
  return group;
}

function poolState(overrides: Partial<TinymanV2PoolState> = {}): TinymanV2PoolState {
  return {
    network: "mainnet",
    validatorAppId: VALIDATOR_APP_ID,
    poolAddress: POOL_ADDRESS,
    poolTokenId: POOL_TOKEN_ID,
    asset1Id: USDC_ID,
    asset2Id: ALGO_ID,
    asset1Decimals: 6,
    asset2Decimals: 6,
    poolInfo: {} as unknown as V2PoolInfo,
    ...overrides
  };
}

function poolReserves(): PoolReserves {
  return {
    asset1: 10_000_000_000n,
    asset2: 20_000_000_000n,
    issuedLiquidity: 1_000_000_000n,
    round: 50_000_000n
  };
}

function baseInput(
  overrides: Partial<TinymanRemoveLiquiditySingleAssetOutInput> = {}
): TinymanRemoveLiquiditySingleAssetOutInput {
  return {
    userAddress: USER_ADDRESS,
    assetAId: USDC_ID,
    assetBId: ALGO_ID,
    outputAssetId: USDC_ID,
    poolTokenAmount: 500_000n,
    maxSlippageBps: 50,
    ...overrides
  };
}

test.afterEach(() => {
  setTinymanRemoveLiquiditySingleAssetOutDependenciesForTests(undefined);
});

test("parseInput rejects outputAssetId outside the pool pair", () => {
  assert.throws(
    () =>
      tinymanRemoveLiquiditySingleAssetOutShape.parseInput(
        baseInput({ outputAssetId: 999_999 })
      ),
    InvalidShapeInputError
  );
});

test("compileExecutableQuote builds and validates the single-asset-out remove group", async () => {
  setTinymanRemoveLiquiditySingleAssetOutDependenciesForTests({
    resolvePoolState: async () => poolState(),
    resolvePoolReserves: async () => poolReserves(),
    getSingleAssetRemoveLiquidityQuote: () => ({
      round: 50_000_000,
      assetOut: { assetId: USDC_ID, amount: 400_000n },
      poolTokenIn: { assetId: POOL_TOKEN_ID, amount: 500_000n },
      internalSwapQuote: {
        amountIn: { assetId: ALGO_ID, amount: 100_000n },
        amountOut: { assetId: USDC_ID, amount: 50_000n },
        swapFees: { assetId: ALGO_ID, amount: 500n },
        priceImpact: 0.001
      }
    }),
    generateSingleAssetOutTxns: async (): Promise<SignerTransaction[]> =>
      buildSingleAssetOutGroup({
        poolTokenAmount: 500_000n,
        poolTokenId: POOL_TOKEN_ID,
        outputAssetId: USDC_ID,
        validatorAppId: VALIDATOR_APP_ID,
        appFee: 3000,
        minAsset1Out: 398_000n,
        minAsset2Out: 0n
      }).map((txn) => ({ txn }))
  });

  const registry = new TransactionShapeRegistry();
  registry.register(tinymanRemoveLiquiditySingleAssetOutShape);

  const quote = await compileExecutableQuote(
    registry,
    tinymanRemoveLiquiditySingleAssetOutShape.key,
    baseInput(),
    buildContext()
  );

  assert.equal(quote.shapeKey, "mainnet:tinyman:v2:removeLiquidity:singleAssetOut");
  assert.equal(quote.transactions.length, 2);
  assert.deepEqual(quote.transactions[1]?.applicationCall?.foreignAssets, [String(USDC_ID)]);
  assert.equal(quote.metadata.expectedAssetOut, "400000");
});

test("validate accepts a correctly-formed single-asset-out remove group", () => {
  const group = buildSingleAssetOutGroup({
    poolTokenAmount: 500_000n,
    poolTokenId: POOL_TOKEN_ID,
    outputAssetId: USDC_ID,
    validatorAppId: VALIDATOR_APP_ID,
    appFee: 3000,
    minAsset1Out: 398_000n,
    minAsset2Out: 0n
  }).map(serializeTransaction);

  const result = tinymanRemoveLiquiditySingleAssetOutShape.validate(
    group,
    baseInput(),
    poolState()
  );

  assert.equal(result.valid, true, result.errors.join("; "));
});

test("validate rejects multiple foreign assets", () => {
  const group = buildSingleAssetOutGroup({
    poolTokenAmount: 500_000n,
    poolTokenId: POOL_TOKEN_ID,
    outputAssetId: USDC_ID,
    validatorAppId: VALIDATOR_APP_ID,
    appFee: 3000,
    minAsset1Out: 398_000n,
    minAsset2Out: 0n
  }).map(serializeTransaction);

  const mutated = structuredClone(group);
  mutated[1]!.applicationCall!.foreignAssets = [String(USDC_ID), String(ALGO_ID)];

  const result = tinymanRemoveLiquiditySingleAssetOutShape.validate(
    mutated,
    baseInput(),
    poolState()
  );

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes("only the output asset")));
});

test("single-asset-out variant is registered in the default registry", () => {
  const registry = new TransactionShapeRegistry();
  registry.register(tinymanRemoveLiquiditySingleAssetOutShape);
  assert.equal(registry.has("mainnet:tinyman:v2:removeLiquidity:singleAssetOut"), true);
});

test("validate rejects ungrouped transactions", () => {
  const validGroup = buildSingleAssetOutGroup({
    poolTokenAmount: 500_000n,
    poolTokenId: POOL_TOKEN_ID,
    outputAssetId: USDC_ID,
    validatorAppId: VALIDATOR_APP_ID,
    appFee: 3000,
    minAsset1Out: 398_000n,
    minAsset2Out: 0n
  }).map(serializeTransaction);

  const ungrouped = structuredClone(validGroup).map((txn: SerializedTransaction) => ({
    ...txn,
    groupPresent: false
  }));
  const ungroupedResult = tinymanRemoveLiquiditySingleAssetOutShape.validate(
    ungrouped,
    baseInput(),
    poolState()
  );
  assert.equal(ungroupedResult.valid, false);
});
