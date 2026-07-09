import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";
import type { SignerTransaction, V2PoolInfo } from "@tinymanorg/tinyman-js-sdk";

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
import {
  orderTinymanAssets,
  tinymanAddLiquiditySingleAssetShape
} from "../../src/execution/shapes/tinyman/index.js";
import {
  setTinymanSingleAssetAddLiquidityDependenciesForTests,
  type TinymanAddLiquiditySingleAssetInput
} from "../../src/execution/shapes/tinyman/add-liquidity-single-asset.js";
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

interface SingleAssetGroupParams {
  depositAssetId: number;
  depositAmount: bigint;
  poolTokenId: number;
  validatorAppId: number;
  appFee: number;
  minPoolTokenOut: bigint;
  variantArg?: string;
}

function buildSingleAssetGroup(params: SingleAssetGroupParams): algosdk.Transaction[] {
  const assetInTxn =
    params.depositAssetId === ALGO_ID
      ? algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          sender: USER.addr,
          receiver: POOL.addr,
          amount: params.depositAmount,
          suggestedParams: suggestedParams(1000)
        })
      : algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          sender: USER.addr,
          receiver: POOL.addr,
          amount: params.depositAmount,
          assetIndex: params.depositAssetId,
          suggestedParams: suggestedParams(1000)
        });

  const appTxn = algosdk.makeApplicationCallTxnFromObject({
    sender: USER.addr,
    appIndex: BigInt(params.validatorAppId),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [
      new TextEncoder().encode("add_liquidity"),
      new TextEncoder().encode(params.variantArg ?? "single"),
      algosdk.encodeUint64(params.minPoolTokenOut)
    ],
    foreignAssets: [params.poolTokenId],
    accounts: [POOL.addr],
    suggestedParams: suggestedParams(params.appFee)
  });

  const group = [assetInTxn, appTxn];
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

function baseInput(
  overrides: Partial<TinymanAddLiquiditySingleAssetInput> = {}
): TinymanAddLiquiditySingleAssetInput {
  return {
    userAddress: USER_ADDRESS,
    assetAId: USDC_ID,
    assetBId: ALGO_ID,
    depositAssetId: USDC_ID,
    depositAmount: 1_000_000n,
    maxSlippageBps: 50,
    ...overrides
  };
}

test.afterEach(() => {
  setTinymanSingleAssetAddLiquidityDependenciesForTests(undefined);
});

test("parseInput normalizes deposit fields and validates depositAssetId is in the pair", () => {
  const parsed = tinymanAddLiquiditySingleAssetShape.parseInput({
    userAddress: USER_ADDRESS,
    assetAId: "31566704",
    assetBId: 0,
    depositAssetId: USDC_ID,
    depositAmount: "1000000",
    maxSlippageBps: 50
  });

  assert.equal(parsed.depositAssetId, USDC_ID);
  assert.equal(parsed.depositAmount, 1_000_000n);
});

test("parseInput rejects depositAssetId outside the pool pair", () => {
  assert.throws(
    () =>
      tinymanAddLiquiditySingleAssetShape.parseInput(
        baseInput({ depositAssetId: 999_999 })
      ),
    InvalidShapeInputError
  );
});

test("compileExecutableQuote builds and validates the documented single-asset add group", async () => {
  setTinymanSingleAssetAddLiquidityDependenciesForTests({
    resolvePoolState: async () => poolState(),
    getSingleAssetQuote: () => ({
      assetIn: { id: USDC_ID, amount: 1_000_000n },
      poolTokenOut: { id: POOL_TOKEN_ID, amount: 900_000n },
      share: 0.01,
      slippage: 0.005,
      internalSwapQuote: {
        assetIn: { id: USDC_ID, amount: 100_000n, decimals: 6 },
        assetOut: { id: ALGO_ID, amount: 50_000n, decimals: 6 },
        swapFees: 500n,
        priceImpact: 0.001
      },
      minPoolTokenAssetAmountWithSlippage: 895_500n
    }),
    generateSingleAssetTxns: async (): Promise<SignerTransaction[]> =>
      buildSingleAssetGroup({
        depositAssetId: USDC_ID,
        depositAmount: 1_000_000n,
        poolTokenId: POOL_TOKEN_ID,
        validatorAppId: VALIDATOR_APP_ID,
        appFee: 3000,
        minPoolTokenOut: 895_500n
      }).map((txn) => ({ txn }))
  });

  const registry = new TransactionShapeRegistry();
  registry.register(tinymanAddLiquiditySingleAssetShape);

  const quote = await compileExecutableQuote(
    registry,
    tinymanAddLiquiditySingleAssetShape.key,
    baseInput(),
    buildContext()
  );

  assert.equal(quote.shapeKey, "mainnet:tinyman:v2:addLiquidity:singleAsset");
  assert.equal(quote.transactions.length, 2);
  assert.deepEqual(
    quote.transactions.map((txn) => txn.type),
    ["axfer", "appl"]
  );
  assert.equal(quote.transactions[1]?.applicationCall?.appArgsText[1], "single");
});

test("validate accepts a correctly-formed single-asset add group", () => {
  const group = buildSingleAssetGroup({
    depositAssetId: USDC_ID,
    depositAmount: 1_000_000n,
    poolTokenId: POOL_TOKEN_ID,
    validatorAppId: VALIDATOR_APP_ID,
    appFee: 3000,
    minPoolTokenOut: 895_500n
  }).map(serializeTransaction);

  const result = tinymanAddLiquiditySingleAssetShape.validate(
    group,
    baseInput(),
    poolState()
  );

  assert.equal(result.valid, true, result.errors.join("; "));
});

test("validate rejects wrong variant and low fee", () => {
  const wrongVariant = buildSingleAssetGroup({
    depositAssetId: USDC_ID,
    depositAmount: 1_000_000n,
    poolTokenId: POOL_TOKEN_ID,
    validatorAppId: VALIDATOR_APP_ID,
    appFee: 3000,
    minPoolTokenOut: 895_500n,
    variantArg: "flexible"
  }).map(serializeTransaction);

  const wrongVariantResult = tinymanAddLiquiditySingleAssetShape.validate(
    wrongVariant,
    baseInput(),
    poolState()
  );
  assert.equal(wrongVariantResult.valid, false);
  assert.ok(wrongVariantResult.errors.some((message) => message.includes("single")));

  const validGroup = buildSingleAssetGroup({
    depositAssetId: USDC_ID,
    depositAmount: 1_000_000n,
    poolTokenId: POOL_TOKEN_ID,
    validatorAppId: VALIDATOR_APP_ID,
    appFee: 3000,
    minPoolTokenOut: 895_500n
  }).map(serializeTransaction);
  const lowFee = structuredClone(validGroup);
  lowFee[1]!.fee = "1000";
  const lowFeeResult = tinymanAddLiquiditySingleAssetShape.validate(
    lowFee,
    baseInput(),
    poolState()
  );
  assert.equal(lowFeeResult.valid, false);
});

test("single-asset variant is registered in the default registry", () => {
  const registry = new TransactionShapeRegistry();
  registry.register(tinymanAddLiquiditySingleAssetShape);
  assert.equal(registry.has("mainnet:tinyman:v2:addLiquidity:singleAsset"), true);
});

test("orderTinymanAssets sorts by descending id so ALGO is always asset2", () => {
  const fromAlgoFirst = orderTinymanAssets(ALGO_ID, USDC_ID);
  assert.deepEqual(fromAlgoFirst, { asset1Id: USDC_ID, asset2Id: ALGO_ID, xIsAsset1: false });
});

test("validate rejects ungrouped transactions", () => {
  const validGroup = buildSingleAssetGroup({
    depositAssetId: USDC_ID,
    depositAmount: 1_000_000n,
    poolTokenId: POOL_TOKEN_ID,
    validatorAppId: VALIDATOR_APP_ID,
    appFee: 3000,
    minPoolTokenOut: 895_500n
  }).map(serializeTransaction);

  const ungrouped = structuredClone(validGroup).map((txn: SerializedTransaction) => ({
    ...txn,
    groupPresent: false
  }));
  const ungroupedResult = tinymanAddLiquiditySingleAssetShape.validate(
    ungrouped,
    baseInput(),
    poolState()
  );
  assert.equal(ungroupedResult.valid, false);
});
