import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";
import type { SignerTransaction, V2PoolInfo } from "@tinymanorg/tinyman-js-sdk";

import {
  InvalidShapeInputError,
  ShapeStateError,
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
  resolveTinymanV2PoolState,
  setTinymanPoolStateDependenciesForTests,
  tinymanAddLiquidityFlexibleShape
} from "../../src/execution/shapes/tinyman/index.js";
import {
  setTinymanFlexibleAddLiquidityDependenciesForTests,
  type TinymanAddLiquidityFlexibleInput
} from "../../src/execution/shapes/tinyman/add-liquidity-flexible.js";
import type { TinymanV2PoolState } from "../../src/execution/shapes/tinyman/pool-state.js";

const USER = algosdk.generateAccount();
const POOL = algosdk.generateAccount();
const USER_ADDRESS = USER.addr.toString();
const POOL_ADDRESS = POOL.addr.toString();
const VALIDATOR_APP_ID = 1002541853;
const GENESIS_HASH = new Uint8Array(32).fill(9);

// Realistic ALGO/USDC-style pair: USDC (higher id) is asset1, ALGO (0) is asset2.
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

interface FlexibleGroupParams {
  asset1Id: number;
  asset2Id: number;
  asset1Amount: bigint;
  asset2Amount: bigint;
  poolTokenId: number;
  validatorAppId: number;
  appFee: number;
  minPoolTokenOut: bigint;
  variantArg?: string;
}

/**
 * Construct the documented Tinyman v2 flexible add-liquidity group with
 * algosdk directly. This mirrors what the SDK's `generateTxns` produces and
 * lets shape tests run deterministically without network access.
 */
function buildFlexibleGroup(params: FlexibleGroupParams): algosdk.Transaction[] {
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
    appArgs: [
      new TextEncoder().encode("add_liquidity"),
      new TextEncoder().encode(params.variantArg ?? "flexible"),
      algosdk.encodeUint64(params.minPoolTokenOut)
    ],
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
  overrides: Partial<TinymanAddLiquidityFlexibleInput> = {}
): TinymanAddLiquidityFlexibleInput {
  return {
    userAddress: USER_ADDRESS,
    assetAId: USDC_ID,
    assetAAmount: 1_000_000n,
    assetBId: ALGO_ID,
    assetBAmount: 2_000_000n,
    maxSlippageBps: 50,
    ...overrides
  };
}

test.afterEach(() => {
  setTinymanPoolStateDependenciesForTests(undefined);
  setTinymanFlexibleAddLiquidityDependenciesForTests(undefined);
});

test("parseInput normalizes string/number amounts into bigint base units", () => {
  const parsed = tinymanAddLiquidityFlexibleShape.parseInput({
    userAddress: USER_ADDRESS,
    assetAId: "31566704",
    assetAAmount: "1000000",
    assetBId: 0,
    assetBAmount: 2000000,
    maxSlippageBps: 50,
    poolId: "31566704-0:lp"
  });

  assert.equal(parsed.userAddress, USER_ADDRESS);
  assert.equal(parsed.assetAId, USDC_ID);
  assert.equal(parsed.assetAAmount, 1_000_000n);
  assert.equal(parsed.assetBId, ALGO_ID);
  assert.equal(parsed.assetBAmount, 2_000_000n);
  assert.equal(parsed.maxSlippageBps, 50);
  assert.equal(parsed.poolId, "31566704-0:lp");
});

test("parseInput rejects invalid slippage, addresses, amounts, and duplicate assets", () => {
  assert.throws(
    () => tinymanAddLiquidityFlexibleShape.parseInput(baseInput({ maxSlippageBps: 20_000 })),
    InvalidShapeInputError
  );
  assert.throws(
    () => tinymanAddLiquidityFlexibleShape.parseInput(baseInput({ maxSlippageBps: 1.5 })),
    InvalidShapeInputError
  );
  assert.throws(
    () => tinymanAddLiquidityFlexibleShape.parseInput(baseInput({ userAddress: "not-an-address" })),
    InvalidShapeInputError
  );
  assert.throws(
    () => tinymanAddLiquidityFlexibleShape.parseInput(baseInput({ assetAAmount: 0n })),
    InvalidShapeInputError
  );
  assert.throws(
    () =>
      tinymanAddLiquidityFlexibleShape.parseInput(
        baseInput({ assetAId: 5, assetBId: 5 })
      ),
    InvalidShapeInputError
  );
});

test("orderTinymanAssets sorts by descending id so ALGO is always asset2", () => {
  const fromAlgoFirst = orderTinymanAssets(ALGO_ID, USDC_ID);
  assert.deepEqual(fromAlgoFirst, { asset1Id: USDC_ID, asset2Id: ALGO_ID, xIsAsset1: false });

  const fromUsdcFirst = orderTinymanAssets(USDC_ID, ALGO_ID);
  assert.deepEqual(fromUsdcFirst, { asset1Id: USDC_ID, asset2Id: ALGO_ID, xIsAsset1: true });

  assert.throws(() => orderTinymanAssets(5, 5), ShapeStateError);
});

test("resolveTinymanV2PoolState resolves a ready pool", async () => {
  setTinymanPoolStateDependenciesForTests({
    getPoolInfo: async () =>
      ({
        status: "ready",
        account: { address: () => POOL.addr },
        poolTokenID: POOL_TOKEN_ID,
        asset1ID: USDC_ID,
        asset2ID: ALGO_ID
      }) as unknown as V2PoolInfo,
    resolveAssetDecimals: async () =>
      new Map([
        [USDC_ID, 6],
        [ALGO_ID, 6]
      ]),
    getValidatorAppId: () => VALIDATOR_APP_ID
  });

  const state = await resolveTinymanV2PoolState({
    network: "mainnet",
    algod: new algosdk.Algodv2("", "http://localhost", ""),
    asset1Id: USDC_ID,
    asset2Id: ALGO_ID
  });

  assert.equal(state.poolAddress, POOL_ADDRESS);
  assert.equal(state.poolTokenId, POOL_TOKEN_ID);
  assert.equal(state.validatorAppId, VALIDATOR_APP_ID);
  assert.equal(state.asset1Decimals, 6);
  assert.equal(state.asset2Decimals, 6);
});

test("resolveTinymanV2PoolState throws when pool token data is missing", async () => {
  setTinymanPoolStateDependenciesForTests({
    getPoolInfo: async () =>
      ({
        status: "ready",
        account: { address: () => POOL.addr },
        poolTokenID: undefined,
        asset1ID: USDC_ID,
        asset2ID: ALGO_ID
      }) as unknown as V2PoolInfo,
    resolveAssetDecimals: async () =>
      new Map([
        [USDC_ID, 6],
        [ALGO_ID, 6]
      ]),
    getValidatorAppId: () => VALIDATOR_APP_ID
  });

  await assert.rejects(
    () =>
      resolveTinymanV2PoolState({
        network: "mainnet",
        algod: new algosdk.Algodv2("", "http://localhost", ""),
        asset1Id: USDC_ID,
        asset2Id: ALGO_ID
      }),
    ShapeStateError
  );
});

test("compileExecutableQuote builds and validates the documented flexible group", async () => {
  setTinymanFlexibleAddLiquidityDependenciesForTests({
    resolvePoolState: async () => poolState(),
    getFlexibleQuote: () => ({
      asset1In: { id: USDC_ID, amount: 1_000_000n },
      asset2In: { id: ALGO_ID, amount: 2_000_000n },
      poolTokenOut: { id: POOL_TOKEN_ID, amount: 1_414_213n },
      share: 0.01,
      slippage: 0.005,
      internalSwapQuote: {
        assetIn: { id: USDC_ID, amount: 0n, decimals: 6 },
        assetOut: { id: ALGO_ID, amount: 0n, decimals: 6 },
        swapFees: 0n,
        priceImpact: 0
      },
      minPoolTokenAssetAmountWithSlippage: 1_407_142n
    }),
    generateFlexibleTxns: async (): Promise<SignerTransaction[]> =>
      buildFlexibleGroup({
        asset1Id: USDC_ID,
        asset2Id: ALGO_ID,
        asset1Amount: 1_000_000n,
        asset2Amount: 2_000_000n,
        poolTokenId: POOL_TOKEN_ID,
        validatorAppId: VALIDATOR_APP_ID,
        appFee: 3000,
        minPoolTokenOut: 1_407_142n
      }).map((txn) => ({ txn }))
  });

  const registry = new TransactionShapeRegistry();
  registry.register(tinymanAddLiquidityFlexibleShape);

  const quote = await compileExecutableQuote(
    registry,
    tinymanAddLiquidityFlexibleShape.key,
    baseInput(),
    buildContext()
  );

  assert.equal(quote.shapeKey, "mainnet:tinyman:v2:addLiquidity:flexible");
  assert.equal(quote.transactions.length, 3);
  assert.equal(quote.encodedTransactions.length, 3);
  assert.deepEqual(
    quote.transactions.map((txn) => txn.type),
    ["axfer", "pay", "appl"]
  );

  const [asset1Txn, asset2Txn, appTxn] = quote.transactions;
  assert.equal(asset1Txn?.assetTransfer?.assetIndex, String(USDC_ID));
  assert.equal(asset1Txn?.assetTransfer?.amount, "1000000");
  assert.equal(asset1Txn?.assetTransfer?.receiver, POOL_ADDRESS);
  assert.equal(asset2Txn?.payment?.amount, "2000000");
  assert.equal(asset2Txn?.payment?.receiver, POOL_ADDRESS);
  assert.deepEqual(appTxn?.applicationCall?.appArgsText.slice(0, 2), [
    "add_liquidity",
    "flexible"
  ]);
  assert.ok(appTxn?.applicationCall?.foreignAssets.includes(String(POOL_TOKEN_ID)));
  assert.ok(appTxn?.applicationCall?.accounts.includes(POOL_ADDRESS));

  assert.equal(quote.metadata.expectedPoolTokenOut, "1414213");
  assert.equal(quote.metadata.minPoolTokenOut, "1407142");
  assert.equal(quote.metadata.asset1Id, USDC_ID);
  assert.equal(quote.metadata.asset2Id, ALGO_ID);
});

test("validate accepts a correctly-formed two-ASA group", () => {
  const asset1 = 200_000;
  const asset2 = 100_000;
  const group = buildFlexibleGroup({
    asset1Id: asset1,
    asset2Id: asset2,
    asset1Amount: 5_000n,
    asset2Amount: 7_000n,
    poolTokenId: POOL_TOKEN_ID,
    validatorAppId: VALIDATOR_APP_ID,
    appFee: 3000,
    minPoolTokenOut: 100n
  }).map(serializeTransaction);

  const result = tinymanAddLiquidityFlexibleShape.validate(
    group,
    baseInput({ assetAId: asset1, assetAAmount: 5_000n, assetBId: asset2, assetBAmount: 7_000n }),
    poolState({ asset1Id: asset1, asset2Id: asset2 })
  );

  assert.equal(result.valid, true, result.errors.join("; "));
});

test("validate rejects wrong asset ordering", () => {
  const asset1 = 200_000;
  const asset2 = 100_000;
  const group = buildFlexibleGroup({
    asset1Id: asset1,
    asset2Id: asset2,
    asset1Amount: 5_000n,
    asset2Amount: 7_000n,
    poolTokenId: POOL_TOKEN_ID,
    validatorAppId: VALIDATOR_APP_ID,
    appFee: 3000,
    minPoolTokenOut: 100n
  }).map(serializeTransaction);

  // Swap asset id on transaction 1 so it no longer references asset1.
  const mutated = structuredClone(group);
  mutated[0]!.assetTransfer!.assetIndex = String(asset2);

  const result = tinymanAddLiquidityFlexibleShape.validate(
    mutated,
    baseInput({ assetAId: asset1, assetAAmount: 5_000n, assetBId: asset2, assetBAmount: 7_000n }),
    poolState({ asset1Id: asset1, asset2Id: asset2 })
  );

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes("asset1")));
});

test("validate rejects an unsupported add-liquidity variant", () => {
  const group = buildFlexibleGroup({
    asset1Id: USDC_ID,
    asset2Id: ALGO_ID,
    asset1Amount: 1_000_000n,
    asset2Amount: 2_000_000n,
    poolTokenId: POOL_TOKEN_ID,
    validatorAppId: VALIDATOR_APP_ID,
    appFee: 3000,
    minPoolTokenOut: 100n,
    variantArg: "single"
  }).map(serializeTransaction);

  const result = tinymanAddLiquidityFlexibleShape.validate(group, baseInput(), poolState());
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes("flexible")));

  // The single-asset variant is not a registered, executable shape yet.
  const registry = new TransactionShapeRegistry();
  registry.register(tinymanAddLiquidityFlexibleShape);
  assert.equal(registry.has("mainnet:tinyman:v2:addLiquidity:singleAsset"), false);
});

test("validate rejects wrong group size, low fee, and missing group id", () => {
  const validGroup = buildFlexibleGroup({
    asset1Id: USDC_ID,
    asset2Id: ALGO_ID,
    asset1Amount: 1_000_000n,
    asset2Amount: 2_000_000n,
    poolTokenId: POOL_TOKEN_ID,
    validatorAppId: VALIDATOR_APP_ID,
    appFee: 3000,
    minPoolTokenOut: 100n
  }).map(serializeTransaction);

  const wrongSize = tinymanAddLiquidityFlexibleShape.validate(
    validGroup.slice(0, 2),
    baseInput(),
    poolState()
  );
  assert.equal(wrongSize.valid, false);

  const lowFee = structuredClone(validGroup);
  lowFee[2]!.fee = "1000";
  const lowFeeResult = tinymanAddLiquidityFlexibleShape.validate(lowFee, baseInput(), poolState());
  assert.equal(lowFeeResult.valid, false);
  assert.ok(lowFeeResult.errors.some((message) => message.includes("fee")));

  const ungrouped = structuredClone(validGroup).map((txn: SerializedTransaction) => ({
    ...txn,
    groupPresent: false
  }));
  const ungroupedResult = tinymanAddLiquidityFlexibleShape.validate(
    ungrouped,
    baseInput(),
    poolState()
  );
  assert.equal(ungroupedResult.valid, false);
  assert.ok(ungroupedResult.errors.some((message) => message.includes("atomic group")));
});
