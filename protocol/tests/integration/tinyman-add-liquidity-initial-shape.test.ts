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
import { tinymanAddLiquidityInitialShape } from "../../src/execution/shapes/tinyman/index.js";
import {
  setTinymanInitialAddLiquidityDependenciesForTests,
  type TinymanAddLiquidityInitialInput
} from "../../src/execution/shapes/tinyman/add-liquidity-initial.js";
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

interface InitialGroupParams {
  asset1Id: number;
  asset2Id: number;
  asset1Amount: bigint;
  asset2Amount: bigint;
  poolTokenId: number;
  validatorAppId: number;
  appFee: number;
  appArg?: string;
}

function buildInitialGroup(params: InitialGroupParams): algosdk.Transaction[] {
  const asset1Txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: USER.addr,
    receiver: POOL.addr,
    amount: params.asset1Amount,
    assetIndex: params.asset1Id,
    suggestedParams: suggestedParams(1000)
  });

  const asset2Txn =
    params.asset2Id === ALGO_ID
      ? algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          sender: USER.addr,
          receiver: POOL.addr,
          amount: params.asset2Amount,
          suggestedParams: suggestedParams(1000)
        })
      : algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          sender: USER.addr,
          receiver: POOL.addr,
          amount: params.asset2Amount,
          assetIndex: params.asset2Id,
          suggestedParams: suggestedParams(1000)
        });

  const appTxn = algosdk.makeApplicationCallTxnFromObject({
    sender: USER.addr,
    appIndex: BigInt(params.validatorAppId),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [new TextEncoder().encode(params.appArg ?? "add_initial_liquidity")],
    foreignAssets: [params.poolTokenId],
    accounts: [POOL.addr],
    suggestedParams: suggestedParams(params.appFee)
  });

  const group = [asset1Txn, asset2Txn, appTxn];
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
  overrides: Partial<TinymanAddLiquidityInitialInput> = {}
): TinymanAddLiquidityInitialInput {
  return {
    userAddress: USER_ADDRESS,
    assetAId: USDC_ID,
    assetBId: ALGO_ID,
    assetAAmount: 1_000_000n,
    assetBAmount: 2_000_000n,
    maxSlippageBps: 50,
    ...overrides
  };
}

test.afterEach(() => {
  setTinymanInitialAddLiquidityDependenciesForTests(undefined);
});

test("parseInput requires both asset amounts", () => {
  assert.throws(
    () =>
      tinymanAddLiquidityInitialShape.parseInput({
        userAddress: USER_ADDRESS,
        assetAId: USDC_ID,
        assetBId: ALGO_ID,
        maxSlippageBps: 50
      }),
    InvalidShapeInputError
  );
});

test("compileExecutableQuote builds and validates the initial add-liquidity group", async () => {
  setTinymanInitialAddLiquidityDependenciesForTests({
    resolvePoolState: async () => poolState(),
    getInitialQuote: () => ({
      asset1In: { id: USDC_ID, amount: 1_000_000n },
      asset2In: { id: ALGO_ID, amount: 2_000_000n },
      poolTokenOut: { id: POOL_TOKEN_ID, amount: 1_414_213n },
      slippage: 0.005
    }),
    generateInitialTxns: async (): Promise<SignerTransaction[]> =>
      buildInitialGroup({
        asset1Id: USDC_ID,
        asset2Id: ALGO_ID,
        asset1Amount: 1_000_000n,
        asset2Amount: 2_000_000n,
        poolTokenId: POOL_TOKEN_ID,
        validatorAppId: VALIDATOR_APP_ID,
        appFee: 2000
      }).map((txn) => ({ txn }))
  });

  const registry = new TransactionShapeRegistry();
  registry.register(tinymanAddLiquidityInitialShape);

  const quote = await compileExecutableQuote(
    registry,
    tinymanAddLiquidityInitialShape.key,
    baseInput(),
    buildContext()
  );

  assert.equal(quote.shapeKey, "mainnet:tinyman:v2:addLiquidity:initial");
  assert.equal(quote.transactions.length, 3);
  assert.deepEqual(
    quote.transactions.map((txn) => txn.type),
    ["axfer", "pay", "appl"]
  );
  assert.equal(
    quote.transactions[2]?.applicationCall?.appArgsText[0],
    "add_initial_liquidity"
  );
});

test("validate accepts a correctly-formed initial add-liquidity group", () => {
  const group = buildInitialGroup({
    asset1Id: USDC_ID,
    asset2Id: ALGO_ID,
    asset1Amount: 1_000_000n,
    asset2Amount: 2_000_000n,
    poolTokenId: POOL_TOKEN_ID,
    validatorAppId: VALIDATOR_APP_ID,
    appFee: 2000
  }).map(serializeTransaction);

  const result = tinymanAddLiquidityInitialShape.validate(
    group,
    baseInput(),
    poolState()
  );

  assert.equal(result.valid, true, result.errors.join("; "));
});

test("validate rejects flexible app arg on initial shape", () => {
  const group = buildInitialGroup({
    asset1Id: USDC_ID,
    asset2Id: ALGO_ID,
    asset1Amount: 1_000_000n,
    asset2Amount: 2_000_000n,
    poolTokenId: POOL_TOKEN_ID,
    validatorAppId: VALIDATOR_APP_ID,
    appFee: 2000,
    appArg: "add_liquidity"
  }).map(serializeTransaction);

  const result = tinymanAddLiquidityInitialShape.validate(
    group,
    baseInput(),
    poolState()
  );

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes("add_initial_liquidity")));
});

test("validate rejects low fee on initial add app call", () => {
  const group = buildInitialGroup({
    asset1Id: USDC_ID,
    asset2Id: ALGO_ID,
    asset1Amount: 1_000_000n,
    asset2Amount: 2_000_000n,
    poolTokenId: POOL_TOKEN_ID,
    validatorAppId: VALIDATOR_APP_ID,
    appFee: 1000
  }).map(serializeTransaction);

  const result = tinymanAddLiquidityInitialShape.validate(
    group,
    baseInput(),
    poolState()
  );

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes("fee")));
});

test("initial variant is registered in the default registry", () => {
  const registry = new TransactionShapeRegistry();
  registry.register(tinymanAddLiquidityInitialShape);
  assert.equal(registry.has("mainnet:tinyman:v2:addLiquidity:initial"), true);
});

test("validate rejects ungrouped transactions", () => {
  const validGroup = buildInitialGroup({
    asset1Id: USDC_ID,
    asset2Id: ALGO_ID,
    asset1Amount: 1_000_000n,
    asset2Amount: 2_000_000n,
    poolTokenId: POOL_TOKEN_ID,
    validatorAppId: VALIDATOR_APP_ID,
    appFee: 2000
  }).map(serializeTransaction);

  const ungrouped = structuredClone(validGroup).map((txn: SerializedTransaction) => ({
    ...txn,
    groupPresent: false
  }));
  const ungroupedResult = tinymanAddLiquidityInitialShape.validate(
    ungrouped,
    baseInput(),
    poolState()
  );
  assert.equal(ungroupedResult.valid, false);
});
