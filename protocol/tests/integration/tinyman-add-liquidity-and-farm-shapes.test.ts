import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";
import type { SignerTransaction, V2PoolInfo } from "@tinymanorg/tinyman-js-sdk";

import {
  TransactionShapeRegistry,
  compileExecutableQuote,
  createExecutionRegistry
} from "../../src/execution/index.js";
import type { ShapeBuildContext } from "../../src/execution/index.js";
import {
  setTinymanAddLiquidityAndFarmFlexibleDependenciesForTests,
  setTinymanAddLiquidityAndFarmSingleAssetDependenciesForTests,
  tinymanAddLiquidityAndFarmFlexibleShape,
  tinymanAddLiquidityAndFarmSingleAssetShape
} from "../../src/execution/shapes/tinyman/index.js";
import { TINYMAN_STAKING_COMMIT_NOTE_PREFIX } from "../../src/execution/shapes/tinyman/farm-state.js";
import type { TinymanV2PoolState } from "../../src/execution/shapes/tinyman/pool-state.js";
import {
  assertEncodedGroupIsValid,
  assertGoldenGroup
} from "../helpers/golden-group.js";

const USER = algosdk.generateAccount();
const POOL = algosdk.generateAccount();
const FARM_PROGRAM = algosdk.generateAccount();
const USER_ADDRESS = USER.addr.toString();
const POOL_ADDRESS = POOL.addr.toString();
const FARM_PROGRAM_ACCOUNT = FARM_PROGRAM.addr.toString();
const VALIDATOR_APP_ID = 1002541853;
const STAKING_APP_ID = 649588853;
const FARM_PROGRAM_ID = 987654321;
const USDC_ID = 31566704; // pragma: allowlist secret
const ALGO_ID = 0;
const POOL_TOKEN_ID = 900001;
const GENESIS_HASH = new Uint8Array(32).fill(9);

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

function poolState(): TinymanV2PoolState {
  return {
    network: "mainnet",
    validatorAppId: VALIDATOR_APP_ID,
    poolAddress: POOL_ADDRESS,
    poolTokenId: POOL_TOKEN_ID,
    asset1Id: USDC_ID,
    asset2Id: ALGO_ID,
    asset1Decimals: 6,
    asset2Decimals: 6,
    poolInfo: {} as unknown as V2PoolInfo
  };
}

function farmCommitNote(amount: bigint): Uint8Array {
  return new Uint8Array([
    ...new TextEncoder().encode(TINYMAN_STAKING_COMMIT_NOTE_PREFIX),
    ...algosdk.encodeUint64(FARM_PROGRAM_ID),
    ...algosdk.encodeUint64(POOL_TOKEN_ID),
    ...algosdk.encodeUint64(amount)
  ]);
}

function buildFarmCommitTxns(amount: bigint): algosdk.Transaction[] {
  return [
    algosdk.makeApplicationNoOpTxnFromObject({
      sender: USER.addr,
      appIndex: BigInt(STAKING_APP_ID),
      appArgs: [new TextEncoder().encode("commit"), algosdk.encodeUint64(amount)],
      foreignAssets: [POOL_TOKEN_ID],
      accounts: [FARM_PROGRAM.addr],
      note: farmCommitNote(amount),
      suggestedParams: suggestedParams(1000)
    })
  ];
}

function buildFlexibleAddGroup(): algosdk.Transaction[] {
  const asset1Txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: USER.addr,
    receiver: POOL.addr,
    amount: 1_000_000n,
    assetIndex: USDC_ID,
    suggestedParams: suggestedParams(1000)
  });
  const asset2Txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: USER.addr,
    receiver: POOL.addr,
    amount: 2_000_000n,
    suggestedParams: suggestedParams(1000)
  });
  const appTxn = algosdk.makeApplicationCallTxnFromObject({
    sender: USER.addr,
    appIndex: BigInt(VALIDATOR_APP_ID),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [
      new TextEncoder().encode("add_liquidity"),
      new TextEncoder().encode("flexible"),
      algosdk.encodeUint64(1_407_142n)
    ],
    foreignAssets: [POOL_TOKEN_ID],
    accounts: [POOL.addr],
    suggestedParams: suggestedParams(3000)
  });
  return algosdk.assignGroupID([asset1Txn, asset2Txn, appTxn]);
}

function buildSingleAssetAddGroup(): algosdk.Transaction[] {
  const deposit = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: USER.addr,
    receiver: POOL.addr,
    amount: 1_000_000n,
    assetIndex: USDC_ID,
    suggestedParams: suggestedParams(1000)
  });
  const appTxn = algosdk.makeApplicationCallTxnFromObject({
    sender: USER.addr,
    appIndex: BigInt(VALIDATOR_APP_ID),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [
      new TextEncoder().encode("add_liquidity"),
      new TextEncoder().encode("single"),
      algosdk.encodeUint64(895_500n)
    ],
    foreignAssets: [POOL_TOKEN_ID],
    accounts: [POOL.addr],
    suggestedParams: suggestedParams(4000)
  });
  return algosdk.assignGroupID([deposit, appTxn]);
}

function regroup(...groups: SignerTransaction[][]): SignerTransaction[] {
  const txns = groups.flat().map((signer) => signer.txn);
  for (const txn of txns) {
    txn.group = undefined;
  }
  algosdk.assignGroupID(txns);
  return txns.map((txn) => ({ txn }));
}

test.afterEach(() => {
  setTinymanAddLiquidityAndFarmFlexibleDependenciesForTests(undefined);
  setTinymanAddLiquidityAndFarmSingleAssetDependenciesForTests(undefined);
});

test("flexible addLiquidityAndFarm compiles axfer+pay+appl+commit group", async () => {
  setTinymanAddLiquidityAndFarmFlexibleDependenciesForTests({
    resolvePoolState: async () => poolState(),
    getStakingAppId: () => STAKING_APP_ID,
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
    generateFlexibleTxns: async () => buildFlexibleAddGroup().map((txn) => ({ txn })),
    prepareCommitTransactions: async ({ amount }) =>
      buildFarmCommitTxns(amount).map((txn) => ({ txn })),
    combineAndRegroupSignerTxns: regroup
  });

  const registry = new TransactionShapeRegistry();
  registry.register(tinymanAddLiquidityAndFarmFlexibleShape);
  const quote = await compileExecutableQuote(
    registry,
    tinymanAddLiquidityAndFarmFlexibleShape.key,
    {
      userAddress: USER_ADDRESS,
      assetAId: USDC_ID,
      assetAAmount: "1000000",
      assetBId: ALGO_ID,
      assetBAmount: "2000000",
      maxSlippageBps: 50,
      programId: FARM_PROGRAM_ID,
      programAccount: FARM_PROGRAM_ACCOUNT
    },
    buildContext()
  );

  assert.equal(quote.shapeKey, "mainnet:tinyman:v2:addLiquidityAndFarm:flexible");
  assert.equal(quote.transactions.length, 4);
  assertEncodedGroupIsValid(quote.encodedTransactions);
  assertGoldenGroup(quote.transactions, {
    types: ["axfer", "pay", "appl", "appl"],
    members: [
      {
        type: "axfer",
        fee: "1000",
        appIndex: null,
        amount: "1000000",
        assetIndex: String(USDC_ID),
        receiver: POOL_ADDRESS
      },
      {
        type: "pay",
        fee: "1000",
        appIndex: null,
        amount: "2000000",
        assetIndex: null,
        receiver: POOL_ADDRESS
      },
      {
        type: "appl",
        fee: "3000",
        appIndex: String(VALIDATOR_APP_ID),
        amount: null,
        assetIndex: null,
        receiver: null
      },
      {
        type: "appl",
        fee: "1000",
        appIndex: String(STAKING_APP_ID),
        amount: null,
        assetIndex: null,
        receiver: null
      }
    ],
    userSignIndexes: [0, 1, 2, 3]
  });
  assert.equal(quote.metadata.commitAmountDefaulted, true);
  assert.equal(quote.metadata.committedAmount, "1407142");
});

test("single-asset addLiquidityAndFarm compiles axfer+appl+commit group", async () => {
  setTinymanAddLiquidityAndFarmSingleAssetDependenciesForTests({
    resolvePoolState: async () => poolState(),
    getStakingAppId: () => STAKING_APP_ID,
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
    generateSingleAssetTxns: async () => buildSingleAssetAddGroup().map((txn) => ({ txn })),
    prepareCommitTransactions: async ({ amount }) =>
      buildFarmCommitTxns(amount).map((txn) => ({ txn })),
    combineAndRegroupSignerTxns: regroup
  });

  const registry = new TransactionShapeRegistry();
  registry.register(tinymanAddLiquidityAndFarmSingleAssetShape);
  const quote = await compileExecutableQuote(
    registry,
    tinymanAddLiquidityAndFarmSingleAssetShape.key,
    {
      userAddress: USER_ADDRESS,
      assetAId: USDC_ID,
      assetBId: ALGO_ID,
      depositAssetId: USDC_ID,
      depositAmount: "1000000",
      maxSlippageBps: 50,
      programId: FARM_PROGRAM_ID,
      programAccount: FARM_PROGRAM_ACCOUNT,
      commitAmount: "895500"
    },
    buildContext()
  );

  assert.equal(quote.shapeKey, "mainnet:tinyman:v2:addLiquidityAndFarm:singleAsset");
  assert.equal(quote.transactions.length, 3);
  assertEncodedGroupIsValid(quote.encodedTransactions);
  assertGoldenGroup(quote.transactions, {
    types: ["axfer", "appl", "appl"],
    members: [
      {
        type: "axfer",
        fee: "1000",
        appIndex: null,
        amount: "1000000",
        assetIndex: String(USDC_ID),
        receiver: POOL_ADDRESS
      },
      {
        type: "appl",
        fee: "4000",
        appIndex: String(VALIDATOR_APP_ID),
        amount: null,
        assetIndex: null,
        receiver: null
      },
      {
        type: "appl",
        fee: "1000",
        appIndex: String(STAKING_APP_ID),
        amount: null,
        assetIndex: null,
        receiver: null
      }
    ],
    userSignIndexes: [0, 1, 2]
  });
  assert.equal(quote.metadata.committedAmount, "895500");
});

test("createExecutionRegistry includes Tinyman addLiquidityAndFarm shapes", () => {
  const registry = createExecutionRegistry();
  assert.equal(registry.has("mainnet:tinyman:v2:addLiquidityAndFarm:flexible"), true);
  assert.equal(registry.has("mainnet:tinyman:v2:addLiquidityAndFarm:singleAsset"), true);
});
