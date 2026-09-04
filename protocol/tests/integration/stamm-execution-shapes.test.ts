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
  setStammHogswapGroupDependenciesForTests,
  setStammMintLpDependenciesForTests,
  setStammRedeemLpDependenciesForTests,
  stammMintLpShape,
  stammRedeemLpShape,
  type StammHogswapLpState
} from "../../src/execution/shapes/stamm/index.js";
import {
  HogswapMissingOptInError,
  type HogswapExecuteResult,
  type HogswapQuote
} from "../../src/services/hogswap-client.js";
import {
  assertEncodedGroupIsValid,
  assertGoldenGroup
} from "../helpers/golden-group.js";
import {
  STAMM_FIXTURE_HOG_ASSET_ID,
  STAMM_FIXTURE_POOL_APP_ID,
  STAMM_FIXTURE_TIER1_LP_ASSET_ID
} from "../fixtures/adapters/stamm.js";

const USER = algosdk.generateAccount();
const USER_ADDRESS = USER.addr.toString();
const GENESIS_HASH = new Uint8Array(32).fill(11);
/** Fixture-only router id from a recorded /execute — not imported by shapes. */
const FIXTURE_ROUTER_APP_ID = 3_544_666_001;
const QUOTED_AT = Date.UTC(2026, 8, 4, 13, 0, 0);

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

function buildUnsignedLpGroup(input: {
  assetIndex: number;
  amount: bigint;
  routerAppId?: number;
}): { transactions: algosdk.Transaction[]; execute: HogswapExecuteResult } {
  const routerAppId = input.routerAppId ?? FIXTURE_ROUTER_APP_ID;
  const params = suggestedParams(1000);
  const axfer = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: USER_ADDRESS,
    receiver: algosdk.getApplicationAddress(routerAppId).toString(),
    amount: input.amount,
    assetIndex: input.assetIndex,
    suggestedParams: params
  });
  const appl = algosdk.makeApplicationNoOpTxnFromObject({
    sender: USER_ADDRESS,
    appIndex: BigInt(routerAppId),
    suggestedParams: { ...params, fee: 5000n, flatFee: true }
  });
  const transactions = [axfer, appl];
  algosdk.assignGroupID(transactions);
  return {
    transactions,
    execute: {
      quoteId: "q-fixture",
      unsignedGroup: transactions.map(encodeMember),
      routerAppId,
      groupIdB64: Buffer.from(transactions[0]?.group ?? new Uint8Array()).toString("base64"),
      assetIn: input.assetIndex,
      assetOut: STAMM_FIXTURE_TIER1_LP_ASSET_ID,
      amountIn: Number(input.amount),
      minOutAtSlippage: 314_192,
      networkFeeMicroalgo: 6000,
      notes: ["unsigned; never broadcast"],
      raw: {}
    }
  };
}

function mintQuote(overrides: Partial<HogswapQuote> = {}): HogswapQuote {
  return {
    quoteId: "q-mint-fixture",
    mode: "LP_MINT",
    assetIn: 0,
    assetOut: STAMM_FIXTURE_TIER1_LP_ASSET_ID,
    amountIn: 1_000_000,
    expectedOut: 317_366,
    expectedOutRobust: 317_000,
    minOutAtSlippage: 314_192,
    slippageBps: 100,
    networkFeeMicroalgo: 6000,
    deposits: [{ assetId: 0, amount: 1_000_000 }],
    lp: {
      mode: "LP_MINT",
      poolAppId: STAMM_FIXTURE_POOL_APP_ID,
      tierIndex: 1,
      lpAssetId: STAMM_FIXTURE_TIER1_LP_ASSET_ID,
      requiresMultiDeposit: false,
      expectedLpOut: 317_366,
      usedPoolRatio: true,
      targetAsset: 0,
      expectedAOut: 0,
      expectedBOut: 0
    },
    quotedAtMs: QUOTED_AT,
    raw: {},
    ...overrides
  };
}

function redeemQuote(overrides: Partial<HogswapQuote> = {}): HogswapQuote {
  return mintQuote({
    quoteId: "q-redeem-fixture",
    mode: "LP_REDEEM",
    assetIn: STAMM_FIXTURE_TIER1_LP_ASSET_ID,
    assetOut: 0,
    lp: {
      mode: "LP_REDEEM",
      poolAppId: STAMM_FIXTURE_POOL_APP_ID,
      tierIndex: 1,
      lpAssetId: STAMM_FIXTURE_TIER1_LP_ASSET_ID,
      requiresMultiDeposit: false,
      expectedLpOut: 0,
      usedPoolRatio: false,
      targetAsset: 0,
      expectedAOut: 1_671_162,
      expectedBOut: 0
    },
    ...overrides
  });
}

test.afterEach(() => {
  setStammMintLpDependenciesForTests(undefined);
  setStammRedeemLpDependenciesForTests(undefined);
  setStammHogswapGroupDependenciesForTests(undefined);
});

test("mint LP shape compiles an unsigned HOGSWAP group from pool assets", async () => {
  const { execute } = buildUnsignedLpGroup({
    assetIndex: 0,
    amount: 1_000_000n
  });
  setStammMintLpDependenciesForTests({
    quoteMint: async () => mintQuote()
  });
  setStammHogswapGroupDependenciesForTests({
    executeQuote: async () => execute
  });

  const registry = new TransactionShapeRegistry();
  registry.register(stammMintLpShape);
  const quote = await compileExecutableQuote(
    registry,
    stammMintLpShape.key,
    {
      userAddress: USER_ADDRESS,
      poolAppId: String(STAMM_FIXTURE_POOL_APP_ID),
      tierIndex: 1,
      amountA: "1000000",
      amountB: "0",
      maxSlippageBps: 100
    },
    buildContext()
  );

  assert.equal(quote.shapeKey, "mainnet:stamm:v1:mint:lp");
  assert.equal(quote.transactions.length, 2);
  assert.equal(quote.metadata?.signed, false);
  assert.equal(quote.metadata?.submitted, false);
  assert.equal(quote.metadata?.routerAppId, FIXTURE_ROUTER_APP_ID);
  assert.equal(quote.metadata?.mode, "LP_MINT");
  assert.match(quote.warnings.join(" "), /opted into the STAMM LP ASA/);
  assertEncodedGroupIsValid(quote.encodedTransactions);
  assertGoldenGroup(quote.transactions, {
    types: ["axfer", "appl"],
    members: [
      {
        type: "axfer",
        fee: "1000",
        appIndex: null,
        amount: "1000000",
        assetIndex: "0",
        receiver: algosdk.getApplicationAddress(FIXTURE_ROUTER_APP_ID).toString()
      },
      {
        type: "appl",
        fee: "5000",
        appIndex: String(FIXTURE_ROUTER_APP_ID),
        amount: null,
        assetIndex: null,
        receiver: null
      }
    ],
    userSignIndexes: [0, 1]
  });
});

test("mint LP shape accepts externalInputs and forwards maxLegs", async () => {
  let captured: { maxLegs?: number; externalInputs?: unknown } | undefined;
  const { execute } = buildUnsignedLpGroup({
    assetIndex: STAMM_FIXTURE_HOG_ASSET_ID,
    amount: 1_000_000n
  });
  setStammMintLpDependenciesForTests({
    quoteMint: async (request) => {
      captured = { maxLegs: request.maxLegs, externalInputs: request.externalInputs };
      return mintQuote();
    }
  });
  setStammHogswapGroupDependenciesForTests({
    executeQuote: async () => execute
  });

  const registry = new TransactionShapeRegistry();
  registry.register(stammMintLpShape);
  const quote = await compileExecutableQuote(
    registry,
    stammMintLpShape.key,
    {
      userAddress: USER_ADDRESS,
      poolAppId: STAMM_FIXTURE_POOL_APP_ID,
      tierIndex: 1,
      externalInputs: [{ assetId: STAMM_FIXTURE_HOG_ASSET_ID, amount: "1000000" }],
      maxLegs: 8
    },
    buildContext()
  );

  assert.deepEqual(captured?.externalInputs, [
    { assetId: STAMM_FIXTURE_HOG_ASSET_ID, amount: 1_000_000n }
  ]);
  assert.equal(captured?.maxLegs, 8);
  assert.equal(quote.metadata?.maxLegs, 8);
});

test("redeem LP shape compiles an unsigned HOGSWAP group", async () => {
  const { execute } = buildUnsignedLpGroup({
    assetIndex: STAMM_FIXTURE_TIER1_LP_ASSET_ID,
    amount: 1_000_000n
  });
  setStammRedeemLpDependenciesForTests({
    quoteRedeem: async () => redeemQuote()
  });
  setStammHogswapGroupDependenciesForTests({
    executeQuote: async () => execute
  });

  const registry = new TransactionShapeRegistry();
  registry.register(stammRedeemLpShape);
  const quote = await compileExecutableQuote(
    registry,
    stammRedeemLpShape.key,
    {
      userAddress: USER_ADDRESS,
      poolAppId: STAMM_FIXTURE_POOL_APP_ID,
      tierIndex: 1,
      lpAmount: "1000000",
      targetAsset: 0
    },
    buildContext()
  );

  assert.equal(quote.shapeKey, "mainnet:stamm:v1:redeem:lp");
  assert.equal(quote.metadata?.mode, "LP_REDEEM");
  assert.equal(quote.metadata?.signed, false);
  assert.equal(quote.metadata?.submitted, false);
  assert.equal(quote.transactions.length, 2);
  assertGoldenGroup(quote.transactions, {
    types: ["axfer", "appl"],
    members: [
      {
        type: "axfer",
        fee: "1000",
        appIndex: null,
        amount: "1000000",
        assetIndex: String(STAMM_FIXTURE_TIER1_LP_ASSET_ID),
        receiver: algosdk.getApplicationAddress(FIXTURE_ROUTER_APP_ID).toString()
      },
      {
        type: "appl",
        fee: "5000",
        appIndex: String(FIXTURE_ROUTER_APP_ID),
        amount: null,
        assetIndex: null,
        receiver: null
      }
    ],
    userSignIndexes: [0, 1]
  });
});

test("mint parseInput requires pool deposits or externalInputs", () => {
  assert.throws(
    () =>
      stammMintLpShape.parseInput({
        userAddress: USER_ADDRESS,
        poolAppId: STAMM_FIXTURE_POOL_APP_ID,
        tierIndex: 1
      }),
    InvalidShapeInputError
  );
});

test("mint shape maps missing LP opt-in to a shape-state error", async () => {
  setStammMintLpDependenciesForTests({
    quoteMint: async () => {
      throw new HogswapMissingOptInError("missing opt-in", [STAMM_FIXTURE_TIER1_LP_ASSET_ID], 422);
    }
  });
  const registry = new TransactionShapeRegistry();
  registry.register(stammMintLpShape);
  await assert.rejects(
    compileExecutableQuote(
      registry,
      stammMintLpShape.key,
      {
        userAddress: USER_ADDRESS,
        poolAppId: STAMM_FIXTURE_POOL_APP_ID,
        tierIndex: 1,
        amountA: "1000000"
      },
      buildContext()
    ),
    (error: unknown) => {
      assert.ok(error instanceof ShapeStateError);
      assert.match(error.message, /opt-in/);
      return true;
    }
  );
});

test("mint shape rejects a stale HOGSWAP quote before execute", async () => {
  setStammMintLpDependenciesForTests({
    quoteMint: async () => mintQuote({ quotedAtMs: QUOTED_AT - 31_000 })
  });
  setStammHogswapGroupDependenciesForTests({
    executeQuote: async () => {
      throw new Error("execute must not run for a stale quote");
    }
  });
  const registry = new TransactionShapeRegistry();
  registry.register(stammMintLpShape);
  await assert.rejects(
    compileExecutableQuote(
      registry,
      stammMintLpShape.key,
      {
        userAddress: USER_ADDRESS,
        poolAppId: STAMM_FIXTURE_POOL_APP_ID,
        tierIndex: 1,
        amountA: "1000000"
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

test("validate rejects groups that do not target the live /execute router", () => {
  const { transactions, execute } = buildUnsignedLpGroup({
    assetIndex: 0,
    amount: 1_000_000n,
    routerAppId: FIXTURE_ROUTER_APP_ID
  });
  const serialized = transactions.map((txn) => {
    const bytes = algosdk.encodeUnsignedTransaction(txn);
    return {
      type: txn.type,
      sender: USER_ADDRESS,
      fee: "1000",
      firstValid: "1000",
      lastValid: "2000",
      genesisID: "mainnet-v1.0",
      genesisHash: Buffer.from(GENESIS_HASH).toString("base64"),
      groupPresent: true,
      notePresent: false,
      leasePresent: false,
      rekeyToPresent: false,
      applicationCall:
        txn.type === "appl"
          ? { appIndex: String(FIXTURE_ROUTER_APP_ID), onComplete: "noop", appArgsCount: 0, foreignApps: [], foreignAssets: [], accounts: [] }
          : undefined,
      assetTransfer:
        txn.type === "axfer"
          ? {
              assetIndex: "0",
              amount: "1000000",
              receiver: algosdk.getApplicationAddress(FIXTURE_ROUTER_APP_ID).toString()
            }
          : undefined,
      encoded: Buffer.from(bytes).toString("base64")
    };
  });
  const state: StammHogswapLpState = {
    quote: mintQuote(),
    execute: { ...execute, routerAppId: FIXTURE_ROUTER_APP_ID + 1 },
    transactions
  };
  const result = stammMintLpShape.validate(
    serialized as never,
    {
      userAddress: USER_ADDRESS,
      poolAppId: STAMM_FIXTURE_POOL_APP_ID,
      tierIndex: 1,
      amountA: 1_000_000n,
      maxSlippageBps: 100
    },
    state
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /HOGSWAP router from \/execute/);
});

test("createExecutionRegistry registers STAMM mint and redeem keys", () => {
  const registry = createExecutionRegistry();
  assert.equal(registry.has("mainnet:stamm:v1:mint:lp"), true);
  assert.equal(registry.has("mainnet:stamm:v1:redeem:lp"), true);
});
