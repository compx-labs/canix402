import assert from "node:assert/strict";
import test from "node:test";

import algosdk, { Algodv2 } from "algosdk";
import { PactClient, type LiquidityAddition, type Pool } from "@pactfi/pactsdk";

import {
  InvalidShapeInputError,
  ShapeStateError,
  TransactionShapeRegistry,
  compileExecutableQuote,
  createExecutionRegistry,
  serializeTransaction
} from "../../src/execution/index.js";
import type { SerializedTransaction, ShapeBuildContext } from "../../src/execution/index.js";
import {
  createPactCompatibleAlgodClient,
  mapAssetsToPactAmounts,
  pactAddLiquidityTwoSidedShape,
  pactRemoveLiquidityProportionalShape,
  resolvePactPoolState,
  setPactAddLiquidityTwoSidedDependenciesForTests,
  setPactPoolStateDependenciesForTests,
  setPactRemoveLiquidityProportionalDependenciesForTests,
  type PactPoolState
} from "../../src/execution/shapes/pact/index.js";
import {
  computeBalancedPactAddAmounts,
  createAlgodClientFromEnv,
  resolvePactAlgoUsdcPool
} from "../helpers/algorandExecution.js";

const USER = algosdk.generateAccount();
const ESCROW = algosdk.generateAccount();
const USER_ADDRESS = USER.addr.toString();
const ESCROW_ADDRESS = ESCROW.addr.toString();
const POOL_APP_ID = 1072843805;
const USDC_ID = 31566704;
const ALGO_ID = 0;
const LP_TOKEN_ID = 900002;
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
    now: () => Date.UTC(2026, 6, 13, 9, 0, 0),
    quoteTtlMs: 30_000
  };
}

function mockPoolState(): PactPoolState {
  const pool = {
    appId: POOL_APP_ID,
    primaryAsset: { index: ALGO_ID },
    secondaryAsset: { index: USDC_ID },
    liquidityAsset: { index: LP_TOKEN_ID },
    poolType: "CONSTANT_PRODUCT",
    version: 1,
    feeBps: 30,
    state: {
      totalLiquidity: 1_000_000,
      totalPrimary: 5_000_000,
      totalSecondary: 2_500_000,
      primaryAssetPrice: 1,
      secondaryAssetPrice: 1
    },
    getEscrowAddress: () => ESCROW_ADDRESS
  } as unknown as Pool;

  return {
    network: "mainnet",
    poolAppId: POOL_APP_ID,
    escrowAddress: ESCROW_ADDRESS,
    primaryAssetId: ALGO_ID,
    secondaryAssetId: USDC_ID,
    liquidityAssetId: LP_TOKEN_ID,
    poolType: "CONSTANT_PRODUCT",
    contractVersion: 1,
    feeBps: 30,
    reserves: pool.state,
    pool
  };
}

function buildAddLiquidityGroup(params: {
  primaryAmount: bigint;
  secondaryAmount: bigint;
  minLpOut: bigint;
  appFee?: number;
}): algosdk.Transaction[] {
  const primaryTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: USER.addr,
    receiver: ESCROW.addr,
    amount: params.primaryAmount,
    suggestedParams: suggestedParams(1000)
  });
  const secondaryTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: USER.addr,
    receiver: ESCROW.addr,
    amount: params.secondaryAmount,
    assetIndex: USDC_ID,
    suggestedParams: suggestedParams(1000)
  });
  const appTxn = algosdk.makeApplicationCallTxnFromObject({
    sender: USER.addr,
    appIndex: BigInt(POOL_APP_ID),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [new TextEncoder().encode("ADDLIQ"), algosdk.encodeUint64(params.minLpOut)],
    foreignAssets: [ALGO_ID, USDC_ID, LP_TOKEN_ID],
    suggestedParams: suggestedParams(params.appFee ?? 3000)
  });
  const group = [primaryTxn, secondaryTxn, appTxn];
  algosdk.assignGroupID(group);
  return group;
}

function buildRemoveLiquidityGroup(poolTokenAmount: bigint): algosdk.Transaction[] {
  const lpTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: USER.addr,
    receiver: ESCROW.addr,
    amount: poolTokenAmount,
    assetIndex: LP_TOKEN_ID,
    suggestedParams: suggestedParams(1000)
  });
  const appTxn = algosdk.makeApplicationCallTxnFromObject({
    sender: USER.addr,
    appIndex: BigInt(POOL_APP_ID),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [
      new TextEncoder().encode("REMLIQ"),
      algosdk.encodeUint64(0),
      algosdk.encodeUint64(0)
    ],
    foreignAssets: [ALGO_ID, USDC_ID],
    suggestedParams: suggestedParams(3000)
  });
  const group = [lpTxn, appTxn];
  algosdk.assignGroupID(group);
  return group;
}

test.afterEach(() => {
  setPactPoolStateDependenciesForTests(undefined);
  setPactAddLiquidityTwoSidedDependenciesForTests(undefined);
  setPactRemoveLiquidityProportionalDependenciesForTests(undefined);
});

test("mapAssetsToPactAmounts maps caller assets to primary/secondary", () => {
  const mapped = mapAssetsToPactAmounts({
    assetAId: USDC_ID,
    assetAAmount: 100_000n,
    assetBId: ALGO_ID,
    assetBAmount: 50_000n,
    primaryAssetId: ALGO_ID,
    secondaryAssetId: USDC_ID
  });
  assert.equal(mapped.primaryAssetAmount, 50_000n);
  assert.equal(mapped.secondaryAssetAmount, 100_000n);
});

test("add shape parseInput rejects duplicate assets and invalid slippage", () => {
  assert.throws(
    () =>
      pactAddLiquidityTwoSidedShape.parseInput({
        userAddress: USER_ADDRESS,
        poolAppId: POOL_APP_ID,
        assetAId: USDC_ID,
        assetBId: USDC_ID,
        assetAAmount: "1",
        assetBAmount: "1",
        maxSlippageBps: 50
      }),
    InvalidShapeInputError
  );
  assert.throws(
    () =>
      pactAddLiquidityTwoSidedShape.parseInput({
        userAddress: USER_ADDRESS,
        poolAppId: POOL_APP_ID,
        assetAId: USDC_ID,
        assetBId: ALGO_ID,
        assetAAmount: "1",
        assetBAmount: "1",
        maxSlippageBps: 10_001
      }),
    InvalidShapeInputError
  );
});

test("add shape compileExecutableQuote builds 3-txn group with mocked dependencies", async () => {
  const state = mockPoolState();
  const liquidityAddition = {
    primaryAssetAmount: 50_000,
    secondaryAssetAmount: 100_000,
    slippagePct: 0.5,
    effect: {
      mintedLiquidityTokens: 70_000,
      minimumMintedLiquidityTokens: 69_650,
      amplifier: 0,
      bonusPct: 0,
      txFee: 3000
    }
  } as LiquidityAddition;

  setPactAddLiquidityTwoSidedDependenciesForTests({
    resolvePoolState: async () => state,
    prepareAddLiquidity: () => liquidityAddition,
    buildAddLiquidityTxs: () =>
      buildAddLiquidityGroup({
        primaryAmount: 50_000n,
        secondaryAmount: 100_000n,
        minLpOut: 69_650n
      }),
    getSuggestedParams: async () => suggestedParams(1000)
  });

  const registry = new TransactionShapeRegistry();
  registry.register(pactAddLiquidityTwoSidedShape);

  const quote = await compileExecutableQuote(
    registry,
    pactAddLiquidityTwoSidedShape.key,
    {
      userAddress: USER_ADDRESS,
      poolAppId: POOL_APP_ID,
      assetAId: USDC_ID,
      assetAAmount: "100000",
      assetBId: ALGO_ID,
      assetBAmount: "50000",
      maxSlippageBps: 50
    },
    buildContext()
  );

  assert.equal(quote.transactions.length, 3);
  assert.deepEqual(quote.transactions.map((txn) => txn.type), ["pay", "axfer", "appl"]);
  assert.equal(quote.transactions[2]?.applicationCall?.appArgsText[0], "ADDLIQ");
  assert.equal(quote.metadata.minimumMintedLiquidityTokens, "69650");
  assert.equal(quote.encodedTransactions.length, 3);
});

test("add shape validate rejects wrong group size and ungrouped txns", () => {
  const state = mockPoolState();
  const input = pactAddLiquidityTwoSidedShape.parseInput({
    userAddress: USER_ADDRESS,
    poolAppId: POOL_APP_ID,
    assetAId: USDC_ID,
    assetAAmount: "100000",
    assetBId: ALGO_ID,
    assetBAmount: "50000",
    maxSlippageBps: 50
  });

  const validGroup = buildAddLiquidityGroup({
    primaryAmount: 50_000n,
    secondaryAmount: 100_000n,
    minLpOut: 69_650n
  }).map((txn) => serializeTransaction(txn));

  const valid = pactAddLiquidityTwoSidedShape.validate(validGroup, input, state);
  assert.equal(valid.valid, true);

  const ungrouped = buildAddLiquidityGroup({
    primaryAmount: 50_000n,
    secondaryAmount: 100_000n,
    minLpOut: 69_650n
  });
  ungrouped[2]!.group = undefined;
  const ungroupedSerialized = ungrouped.map((txn) => serializeTransaction(txn));
  const ungroupedResult = pactAddLiquidityTwoSidedShape.validate(
    ungroupedSerialized,
    input,
    state
  );
  assert.equal(ungroupedResult.valid, false);
});

test("remove shape compileExecutableQuote builds 2-txn group with warning", async () => {
  const state = mockPoolState();

  setPactRemoveLiquidityProportionalDependenciesForTests({
    resolvePoolState: async () => state,
    buildRemoveLiquidityTxs: () => buildRemoveLiquidityGroup(25_000n),
    getSuggestedParams: async () => suggestedParams(1000)
  });

  const registry = new TransactionShapeRegistry();
  registry.register(pactRemoveLiquidityProportionalShape);

  const quote = await compileExecutableQuote(
    registry,
    pactRemoveLiquidityProportionalShape.key,
    {
      userAddress: USER_ADDRESS,
      poolAppId: POOL_APP_ID,
      poolTokenAmount: "25000"
    },
    buildContext()
  );

  assert.equal(quote.transactions.length, 2);
  assert.equal(quote.transactions[1]?.applicationCall?.appArgsText[0], "REMLIQ");
  assert.ok(
    quote.warnings.some((warning) => warning.includes("REMLIQ minimum asset outputs"))
  );
});

test("resolvePactPoolState rejects mismatched asset pair", async () => {
  setPactPoolStateDependenciesForTests({
    fetchPoolById: async () => mockPoolState().pool
  });

  await assert.rejects(
    () =>
      resolvePactPoolState({
        network: "mainnet",
        algod: new algosdk.Algodv2("", "http://localhost", ""),
        poolAppId: POOL_APP_ID,
        assetAId: 12345,
        assetBId: 67890
      }),
    ShapeStateError
  );
});

test("Pact algod compatibility adapter normalizes algosdk v3 app state for SDK parsing", async () => {
  const pact = new PactClient(
    createPactCompatibleAlgodClient(buildPactSdkV3AlgodStub()) as unknown as ConstructorParameters<
      typeof PactClient
    >[0],
    { network: "mainnet" }
  );

  const pool = await pact.fetchPoolById(POOL_APP_ID);

  assert.equal(pool.appId, POOL_APP_ID);
  assert.equal(pool.primaryAsset.index, ALGO_ID);
  assert.equal(pool.secondaryAsset.index, USDC_ID);
  assert.equal(pool.liquidityAsset.index, LP_TOKEN_ID);
  assert.equal(pool.feeBps, 30);
  assert.equal(pool.state.totalPrimary, 5_000_000);
  assert.equal(pool.state.totalSecondary, 2_500_000);
});

test("add shape builds real Pact mainnet SDK transaction group", async () => {
  const algod = createAlgodClientFromEnv();
  const pool = await resolvePactAlgoUsdcPool(algod);
  const amounts = await computeBalancedPactAddAmounts(algod, 100_000n);
  const registry = new TransactionShapeRegistry();
  registry.register(pactAddLiquidityTwoSidedShape);

  const quote = await compileExecutableQuote(
    registry,
    pactAddLiquidityTwoSidedShape.key,
    {
      userAddress: USER_ADDRESS,
      poolAppId: pool.poolAppId,
      assetAId: USDC_ID,
      assetAAmount: amounts.assetAAmount.toString(),
      assetBId: ALGO_ID,
      assetBAmount: amounts.assetBAmount.toString(),
      maxSlippageBps: 50
    },
    {
      network: "mainnet",
      algod,
      now: () => Date.UTC(2026, 6, 13, 9, 0, 0),
      quoteTtlMs: 30_000
    }
  );

  assert.equal(quote.shapeKey, pactAddLiquidityTwoSidedShape.key);
  assert.equal(quote.transactions.length, 3);
  assert.deepEqual(quote.transactions.map((txn) => txn.type), ["pay", "axfer", "appl"]);
  assert.equal(quote.transactions[0]?.payment?.amount, amounts.assetBAmount.toString());
  assert.equal(quote.transactions[1]?.assetTransfer?.assetIndex, String(USDC_ID));
  assert.equal(quote.transactions[1]?.assetTransfer?.amount, amounts.assetAAmount.toString());
  assert.equal(quote.transactions[2]?.applicationCall?.appArgsText[0], "ADDLIQ");
  assert.equal(quote.metadata.poolAppId, pool.poolAppId);
  assert.equal(quote.transactions.every((txn) => txn.groupPresent), true);
});

test("registry includes Pact liquidity and farm shapes", () => {
  const registry = createExecutionRegistry();
  assert.equal(registry.has("mainnet:pact:v1:addLiquidity:twoSided"), true);
  assert.equal(registry.has("mainnet:pact:v1:removeLiquidity:proportional"), true);
  assert.equal(registry.has("mainnet:pact:v1:farm:deployEscrow"), true);
  assert.equal(registry.has("mainnet:pact:v1:farm:stake"), true);
  assert.equal(registry.has("mainnet:pact:v1:farm:unstake"), true);
  assert.equal(registry.has("mainnet:pact:v1:farm:claimRewards"), true);
  assert.equal(registry.has("mainnet:pact:v1:addLiquidityAndFarm:twoSided"), true);
  assert.equal(registry.listForOpportunity("pact", "farm").length, 3);
});

function buildPactSdkV3AlgodStub(): Algodv2 {
  return {
    getApplicationByID: () => ({
      do: async () => ({
        id: BigInt(POOL_APP_ID),
        params: {
          globalState: [
            stateBytes("CONFIG", encodeUint64Tuple(ALGO_ID, USDC_ID, 30)),
            stateUint("A", 5_000_000n),
            stateUint("B", 2_500_000n),
            stateUint("L", 1_000_000n),
            stateUint("LTID", BigInt(LP_TOKEN_ID)),
            stateUint("VERSION", 1n),
            stateBytes("CONTRACT_NAME", new TextEncoder().encode("PACT AMM"))
          ]
        }
      })
    }),
    getAssetByID: (assetId: number | bigint) => ({
      do: async () => ({
        index: BigInt(assetId),
        params: {
          name: `asset ${assetId}`,
          unitName: `A${assetId}`,
          decimals: 6
        }
      })
    })
  } as unknown as Algodv2;
}

function stateUint(key: string, uint: bigint): unknown {
  return {
    key: new TextEncoder().encode(key),
    value: {
      bytes: new Uint8Array(),
      type: 2,
      uint
    }
  };
}

function stateBytes(key: string, bytes: Uint8Array): unknown {
  return {
    key: new TextEncoder().encode(key),
    value: {
      bytes,
      type: 1,
      uint: 0n
    }
  };
}

function encodeUint64Tuple(...values: readonly number[]): Uint8Array {
  const chunks = values.map((value) => algosdk.encodeUint64(value));
  const result = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
