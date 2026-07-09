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
import {
  orderTinymanAssets,
  tinymanRemoveLiquidityMultipleAssetsOutShape
} from "../../src/execution/shapes/tinyman/index.js";
import {
  setTinymanRemoveLiquidityDependenciesForTests,
  type TinymanRemoveLiquidityMultipleAssetsOutInput
} from "../../src/execution/shapes/tinyman/remove-liquidity-multiple-assets-out.js";
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

interface RemoveLiquidityGroupParams {
  poolTokenAmount: bigint;
  poolTokenId: number;
  asset1Id: number;
  asset2Id: number;
  validatorAppId: number;
  appFee: number;
  minAsset1Out: bigint;
  minAsset2Out: bigint;
  appArg?: string;
}

function buildRemoveLiquidityGroup(
  params: RemoveLiquidityGroupParams
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
      new TextEncoder().encode(params.appArg ?? "remove_liquidity"),
      algosdk.encodeUint64(params.minAsset1Out),
      algosdk.encodeUint64(params.minAsset2Out)
    ],
    foreignAssets: [params.asset1Id, params.asset2Id],
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
  overrides: Partial<TinymanRemoveLiquidityMultipleAssetsOutInput> = {}
): TinymanRemoveLiquidityMultipleAssetsOutInput {
  return {
    userAddress: USER_ADDRESS,
    assetAId: USDC_ID,
    assetBId: ALGO_ID,
    poolTokenAmount: 500_000n,
    maxSlippageBps: 50,
    ...overrides
  };
}

test.afterEach(() => {
  setTinymanRemoveLiquidityDependenciesForTests(undefined);
});

test("parseInput normalizes string/number pool token amounts into bigint base units", () => {
  const parsed = tinymanRemoveLiquidityMultipleAssetsOutShape.parseInput({
    userAddress: USER_ADDRESS,
    assetAId: "31566704",
    assetBId: 0,
    poolTokenAmount: "500000",
    maxSlippageBps: 50,
    poolId: "31566704-0:lp"
  });

  assert.equal(parsed.userAddress, USER_ADDRESS);
  assert.equal(parsed.assetAId, USDC_ID);
  assert.equal(parsed.assetBId, ALGO_ID);
  assert.equal(parsed.poolTokenAmount, 500_000n);
  assert.equal(parsed.maxSlippageBps, 50);
  assert.equal(parsed.poolId, "31566704-0:lp");
});

test("parseInput rejects invalid slippage, addresses, amounts, and duplicate assets", () => {
  assert.throws(
    () =>
      tinymanRemoveLiquidityMultipleAssetsOutShape.parseInput(
        baseInput({ maxSlippageBps: 20_000 })
      ),
    InvalidShapeInputError
  );
  assert.throws(
    () =>
      tinymanRemoveLiquidityMultipleAssetsOutShape.parseInput(
        baseInput({ userAddress: "not-an-address" })
      ),
    InvalidShapeInputError
  );
  assert.throws(
    () =>
      tinymanRemoveLiquidityMultipleAssetsOutShape.parseInput(
        baseInput({ poolTokenAmount: 0n })
      ),
    InvalidShapeInputError
  );
  assert.throws(
    () =>
      tinymanRemoveLiquidityMultipleAssetsOutShape.parseInput(
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
});

test("compileExecutableQuote builds and validates the documented remove-liquidity group", async () => {
  setTinymanRemoveLiquidityDependenciesForTests({
    resolvePoolState: async () => poolState(),
    resolvePoolReserves: async () => poolReserves(),
    getRemoveLiquidityQuote: () => ({
      round: 50_000_000,
      asset1Out: { assetId: USDC_ID, amount: 250_000n },
      asset2Out: { assetId: ALGO_ID, amount: 500_000n },
      poolTokenIn: { assetId: POOL_TOKEN_ID, amount: 500_000n }
    }),
    generateRemoveLiquidityTxns: async (): Promise<SignerTransaction[]> =>
      buildRemoveLiquidityGroup({
        poolTokenAmount: 500_000n,
        poolTokenId: POOL_TOKEN_ID,
        asset1Id: USDC_ID,
        asset2Id: ALGO_ID,
        validatorAppId: VALIDATOR_APP_ID,
        appFee: 3000,
        minAsset1Out: 248_750n,
        minAsset2Out: 497_500n
      }).map((txn) => ({ txn }))
  });

  const registry = new TransactionShapeRegistry();
  registry.register(tinymanRemoveLiquidityMultipleAssetsOutShape);

  const quote = await compileExecutableQuote(
    registry,
    tinymanRemoveLiquidityMultipleAssetsOutShape.key,
    baseInput(),
    buildContext()
  );

  assert.equal(quote.shapeKey, "mainnet:tinyman:v2:removeLiquidity:multipleAssetsOut");
  assert.equal(quote.transactions.length, 2);
  assert.equal(quote.encodedTransactions.length, 2);
  assert.deepEqual(
    quote.transactions.map((txn) => txn.type),
    ["axfer", "appl"]
  );

  const [poolTokenTxn, appTxn] = quote.transactions;
  assert.equal(poolTokenTxn?.assetTransfer?.assetIndex, String(POOL_TOKEN_ID));
  assert.equal(poolTokenTxn?.assetTransfer?.amount, "500000");
  assert.equal(poolTokenTxn?.assetTransfer?.receiver, POOL_ADDRESS);
  assert.equal(appTxn?.applicationCall?.appArgsText[0], "remove_liquidity");
  assert.ok(appTxn?.applicationCall?.foreignAssets.includes(String(USDC_ID)));
  assert.ok(appTxn?.applicationCall?.foreignAssets.includes(String(ALGO_ID)));
  assert.ok(appTxn?.applicationCall?.accounts.includes(POOL_ADDRESS));

  assert.equal(quote.metadata.expectedAsset1Out, "250000");
  assert.equal(quote.metadata.expectedAsset2Out, "500000");
  assert.equal(quote.metadata.poolTokenAmountIn, "500000");
});

test("validate accepts a correctly-formed remove-liquidity group", () => {
  const group = buildRemoveLiquidityGroup({
    poolTokenAmount: 500_000n,
    poolTokenId: POOL_TOKEN_ID,
    asset1Id: USDC_ID,
    asset2Id: ALGO_ID,
    validatorAppId: VALIDATOR_APP_ID,
    appFee: 3000,
    minAsset1Out: 248_750n,
    minAsset2Out: 497_500n
  }).map(serializeTransaction);

  const result = tinymanRemoveLiquidityMultipleAssetsOutShape.validate(
    group,
    baseInput(),
    poolState()
  );

  assert.equal(result.valid, true, result.errors.join("; "));
});

test("validate rejects wrong pool token asset", () => {
  const group = buildRemoveLiquidityGroup({
    poolTokenAmount: 500_000n,
    poolTokenId: POOL_TOKEN_ID,
    asset1Id: USDC_ID,
    asset2Id: ALGO_ID,
    validatorAppId: VALIDATOR_APP_ID,
    appFee: 3000,
    minAsset1Out: 248_750n,
    minAsset2Out: 497_500n
  }).map(serializeTransaction);

  const mutated = structuredClone(group);
  mutated[0]!.assetTransfer!.assetIndex = String(USDC_ID);

  const result = tinymanRemoveLiquidityMultipleAssetsOutShape.validate(
    mutated,
    baseInput(),
    poolState()
  );

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes("pool token")));
});

test("validate rejects wrong app arg and missing foreign assets", () => {
  const wrongAppArg = buildRemoveLiquidityGroup({
    poolTokenAmount: 500_000n,
    poolTokenId: POOL_TOKEN_ID,
    asset1Id: USDC_ID,
    asset2Id: ALGO_ID,
    validatorAppId: VALIDATOR_APP_ID,
    appFee: 3000,
    minAsset1Out: 248_750n,
    minAsset2Out: 497_500n,
    appArg: "add_liquidity"
  }).map(serializeTransaction);

  const wrongAppResult = tinymanRemoveLiquidityMultipleAssetsOutShape.validate(
    wrongAppArg,
    baseInput(),
    poolState()
  );
  assert.equal(wrongAppResult.valid, false);
  assert.ok(wrongAppResult.errors.some((message) => message.includes("remove_liquidity")));

  const missingForeign = structuredClone(
    buildRemoveLiquidityGroup({
      poolTokenAmount: 500_000n,
      poolTokenId: POOL_TOKEN_ID,
      asset1Id: USDC_ID,
      asset2Id: ALGO_ID,
      validatorAppId: VALIDATOR_APP_ID,
      appFee: 3000,
      minAsset1Out: 248_750n,
      minAsset2Out: 497_500n
    }).map(serializeTransaction)
  );
  missingForeign[1]!.applicationCall!.foreignAssets = [String(USDC_ID)];

  const missingForeignResult = tinymanRemoveLiquidityMultipleAssetsOutShape.validate(
    missingForeign,
    baseInput(),
    poolState()
  );
  assert.equal(missingForeignResult.valid, false);
  assert.ok(missingForeignResult.errors.some((message) => message.includes("asset 2")));
});

test("validate rejects wrong group size, low fee, and missing group id", () => {
  const validGroup = buildRemoveLiquidityGroup({
    poolTokenAmount: 500_000n,
    poolTokenId: POOL_TOKEN_ID,
    asset1Id: USDC_ID,
    asset2Id: ALGO_ID,
    validatorAppId: VALIDATOR_APP_ID,
    appFee: 3000,
    minAsset1Out: 248_750n,
    minAsset2Out: 497_500n
  }).map(serializeTransaction);

  const wrongSize = tinymanRemoveLiquidityMultipleAssetsOutShape.validate(
    validGroup.slice(0, 1),
    baseInput(),
    poolState()
  );
  assert.equal(wrongSize.valid, false);

  const lowFee = structuredClone(validGroup);
  lowFee[1]!.fee = "1000";
  const lowFeeResult = tinymanRemoveLiquidityMultipleAssetsOutShape.validate(
    lowFee,
    baseInput(),
    poolState()
  );
  assert.equal(lowFeeResult.valid, false);
  assert.ok(lowFeeResult.errors.some((message) => message.includes("fee")));

  const ungrouped = structuredClone(validGroup).map((txn: SerializedTransaction) => ({
    ...txn,
    groupPresent: false
  }));
  const ungroupedResult = tinymanRemoveLiquidityMultipleAssetsOutShape.validate(
    ungrouped,
    baseInput(),
    poolState()
  );
  assert.equal(ungroupedResult.valid, false);
  assert.ok(ungroupedResult.errors.some((message) => message.includes("atomic group")));
});

test("single-asset-out variant is not registered yet", () => {
  const registry = new TransactionShapeRegistry();
  registry.register(tinymanRemoveLiquidityMultipleAssetsOutShape);
  assert.equal(registry.has("mainnet:tinyman:v2:removeLiquidity:singleAssetOut"), false);
});
