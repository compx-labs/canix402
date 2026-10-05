import assert from "node:assert/strict";
import test from "node:test";

import algosdk, { Transaction } from "algosdk";

import {
  InvalidShapeInputError,
  TransactionShapeRegistry,
  compileExecutableQuote
} from "../../src/execution/index.js";
import type { ShapeBuildContext } from "../../src/execution/index.js";
import { assertEncodedGroupIsValid, assertGoldenGroup } from "../helpers/golden-group.js";
import { HAYSTACK_LAUNCH_APP_ID } from "../../src/execution/shapes/haystack/launch-constants.js";
import {
  BUY_WITH_ALGO_LIMIT_SELECTOR_HEX,
  BUY_WITH_LIMIT_SELECTOR_HEX,
  GAS_METHOD_SELECTOR_HEX,
  LAUNCH_TOKEN_SELECTOR_HEX,
  LAUNCH_TOKEN_THEN_BUY_ALGO_SELECTOR_HEX,
  LAUNCH_TOKEN_THEN_BUY_SELECTOR_HEX
} from "../../src/execution/shapes/haystack/launch-spec.js";
import {
  haystackBuyBondingShape,
  haystackLaunchTokenShape,
  setHaystackBuyBondingDependenciesForTests,
  setHaystackLaunchTokenDependenciesForTests,
  type HaystackBuyBondingState,
  type HaystackLaunchTokenState
} from "../../src/execution/shapes/haystack/index.js";

const USER = algosdk.generateAccount();
const USER_ADDRESS = USER.addr.toString();
const APP_ADDRESS = algosdk.getApplicationAddress(HAYSTACK_LAUNCH_APP_ID).toString();
const GENESIS_HASH = new Uint8Array(32).fill(11);
const USDC = 31_566_704;

function suggestedParams(fee = 1000n): algosdk.SuggestedParams {
  return {
    fee,
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
    now: () => Date.UTC(2026, 9, 5, 12, 0, 0),
    quoteTtlMs: 30_000
  };
}

function launchState(overrides: Partial<HaystackLaunchTokenState> = {}): HaystackLaunchTokenState {
  return {
    appId: HAYSTACK_LAUNCH_APP_ID,
    appAddress: APP_ADDRESS,
    oracleAppId: 3_016_268_320,
    nextTokenNum: 176,
    bondingAssetOptedIn: true,
    mbrMicroAlgos: 227_700n,
    tokensForBonding: 800_000_000_000_000n,
    previewTokens: null,
    ...overrides
  };
}

function buyState(overrides: Partial<HaystackBuyBondingState> = {}): HaystackBuyBondingState {
  return {
    appId: HAYSTACK_LAUNCH_APP_ID,
    appAddress: APP_ADDRESS,
    oracleAppId: 3_016_268_320,
    tokenNum: 175,
    assetId: 3_729_195_158,
    bondingTokenId: 0,
    bondingOn: 0,
    realTokenReserves: 800_000_000_000_000n,
    bondingAssetOptedIn: true,
    mbrMicroAlgos: 22_500n,
    directTokensOut: 1_000_000n,
    ...overrides
  };
}

test("mainnet:haystack:v1:launch:token compiles gas calls, MBR, and launchToken", async () => {
  const state = launchState();
  const group = assign([
    appl(GAS_METHOD_SELECTOR_HEX, 1000n),
    appl(GAS_METHOD_SELECTOR_HEX, 1000n),
    pay(APP_ADDRESS, state.mbrMicroAlgos),
    appl(LAUNCH_TOKEN_SELECTOR_HEX, 40_000n)
  ]);
  setHaystackLaunchTokenDependenciesForTests({
    resolveState: async () => state,
    getSuggestedParams: async () => suggestedParams(),
    finalizeComposerGroup: async () => group
  });

  const quote = await compileExecutableQuote(
    registry(haystackLaunchTokenShape),
    "mainnet:haystack:v1:launch:token",
    {
      userAddress: USER_ADDRESS,
      symbol: "LENIN",
      name: "Lenin",
      assetUrl: "ipfs://bafyexample",
      bondingTokenId: 0
    },
    buildContext()
  );

  assert.equal(quote.transactions.length, 4);
  assertEncodedGroupIsValid(quote.encodedTransactions);
  assertGoldenGroup(quote.transactions, {
    types: ["appl", "appl", "pay", "appl"],
    members: [
      member("appl", "1000", String(HAYSTACK_LAUNCH_APP_ID), null, null, null),
      member("appl", "1000", String(HAYSTACK_LAUNCH_APP_ID), null, null, null),
      member("pay", "1000", null, state.mbrMicroAlgos.toString(), null, APP_ADDRESS),
      member("appl", "40000", String(HAYSTACK_LAUNCH_APP_ID), null, null, null)
    ],
    userSignIndexes: [0, 1, 2, 3]
  });
  setHaystackLaunchTokenDependenciesForTests(undefined);
});

test("mainnet:haystack:v1:launch:token with a first buy opts in and pays the bonding asset", async () => {
  const state = launchState({ bondingAssetOptedIn: false, previewTokens: 1_000n });
  const group = assign([
    optIn(USDC),
    appl(GAS_METHOD_SELECTOR_HEX, 1000n),
    appl(GAS_METHOD_SELECTOR_HEX, 1000n),
    pay(APP_ADDRESS, state.mbrMicroAlgos),
    axfer(APP_ADDRESS, USDC, 500_000n),
    appl(LAUNCH_TOKEN_THEN_BUY_SELECTOR_HEX, 40_000n)
  ]);
  setHaystackLaunchTokenDependenciesForTests({
    resolveState: async () => state,
    getSuggestedParams: async () => suggestedParams(),
    finalizeComposerGroup: async () => group
  });

  const quote = await compileExecutableQuote(
    registry(haystackLaunchTokenShape),
    "mainnet:haystack:v1:launch:token",
    {
      userAddress: USER_ADDRESS,
      symbol: "LENIN",
      name: "Lenin",
      assetUrl: "https://example.com/lenin.png",
      bondingTokenId: USDC,
      initialBuyAmount: "500000"
    },
    buildContext()
  );

  assert.deepEqual(quote.transactions.map((txn) => txn.type), ["axfer", "appl", "appl", "pay", "axfer", "appl"]);
  assert.equal(quote.transactions[4]?.assetTransfer?.amount, "500000");
  setHaystackLaunchTokenDependenciesForTests(undefined);
});

test("a first buy that would finish the curve is refused", async () => {
  setHaystackLaunchTokenDependenciesForTests({
    resolveState: async () => launchState({ previewTokens: 800n, tokensForBonding: 800n }),
    getSuggestedParams: async () => suggestedParams(),
    finalizeComposerGroup: async () => {
      throw new Error("finalize should not run");
    }
  });
  await assert.rejects(
    () =>
      compileExecutableQuote(
        registry(haystackLaunchTokenShape),
        "mainnet:haystack:v1:launch:token",
        {
          userAddress: USER_ADDRESS,
          symbol: "LENIN",
          name: "Lenin",
          assetUrl: "ipfs://bafyexample",
          bondingTokenId: 0,
          initialBuyAmount: "1"
        },
        buildContext()
      ),
    (error: unknown) => {
      assert.ok(error instanceof InvalidShapeInputError);
      assert.match(error.message, /finish the bonding curve/);
      return true;
    }
  );
  setHaystackLaunchTokenDependenciesForTests(undefined);
});

test("ALGO launch-and-buy selector matches the HayLaunch ARC-56 method", () => {
  assert.equal(LAUNCH_TOKEN_THEN_BUY_ALGO_SELECTOR_HEX, "2cf2d4ae");
});

test("launch input rejects a short multiplier and a non-url asset", () => {
  assert.throws(
    () =>
      haystackLaunchTokenShape.parseInput({
        userAddress: USER_ADDRESS,
        symbol: "LENIN",
        name: "Lenin",
        assetUrl: "ipfs://ok",
        bondingTokenId: 0,
        priceMultiplier: "4000000000"
      }),
    InvalidShapeInputError
  );
  assert.throws(
    () =>
      haystackLaunchTokenShape.parseInput({
        userAddress: USER_ADDRESS,
        symbol: "LENIN",
        name: "Lenin",
        assetUrl: "http://example.com/a",
        bondingTokenId: 0
      }),
    /ipfs:\/\/ or https:\/\//
  );
});

test("mainnet:haystack:v1:buy:bonding direct ALGO buy pays the requested amount", async () => {
  const state = buyState();
  const group = assign([
    pay(APP_ADDRESS, state.mbrMicroAlgos),
    pay(APP_ADDRESS, 1_000_000n),
    appl(BUY_WITH_ALGO_LIMIT_SELECTOR_HEX, 40_000n)
  ]);
  setHaystackBuyBondingDependenciesForTests({
    resolveState: async () => state,
    getSuggestedParams: async () => suggestedParams(),
    finalizeComposerGroup: async () => group
  });

  const quote = await compileExecutableQuote(
    registry(haystackBuyBondingShape),
    "mainnet:haystack:v1:buy:bonding",
    {
      userAddress: USER_ADDRESS,
      tokenNum: 175,
      fromAssetId: 0,
      amount: "1000000",
      slippageBps: 50
    },
    buildContext()
  );

  assert.equal(quote.metadata.route, "direct");
  assert.equal(quote.metadata.minTokensOut, "995000");
  assertGoldenGroup(quote.transactions, {
    types: ["pay", "pay", "appl"],
    members: [
      member("pay", "1000", null, "22500", null, APP_ADDRESS),
      member("pay", "1000", null, "1000000", null, APP_ADDRESS),
      member("appl", "40000", String(HAYSTACK_LAUNCH_APP_ID), null, null, null)
    ],
    userSignIndexes: [0, 1, 2]
  });
  setHaystackBuyBondingDependenciesForTests(undefined);
});

test("mainnet:haystack:v1:buy:bonding routed buy appends the curve tail to the router prefix", async () => {
  const state = buyState({ bondingTokenId: USDC, directTokensOut: null });
  setHaystackBuyBondingDependenciesForTests({
    resolveState: async () => state,
    getSuggestedParams: async () => suggestedParams(),
    quoteBondingSwap: async () => ({
      minOut: 40_000n,
      legs: [
        { txn: pay(algosdk.generateAccount().addr.toString(), 1_000_000n) },
        { txn: axfer(USER_ADDRESS, USDC, 1n) }
      ]
    }),
    tokensReceivedForBuy: async () => 100_000n
  });

  const quote = await compileExecutableQuote(
    registry(haystackBuyBondingShape),
    "mainnet:haystack:v1:buy:bonding",
    {
      userAddress: USER_ADDRESS,
      tokenNum: 175,
      fromAssetId: 0,
      amount: "1000000",
      slippageBps: 100
    },
    buildContext()
  );

  assert.equal(quote.metadata.route, "routed");
  assert.equal(quote.metadata.minOut, "40000");
  assert.equal(quote.transactions.at(-1)?.type, "appl");
  assert.equal(quote.transactions.at(-2)?.assetTransfer?.amount, "40000");
  assert.equal(quote.transactions.at(-2)?.assetTransfer?.assetIndex, String(USDC));
  const selector = Buffer.from(
    quote.transactions.at(-1)?.applicationCall?.appArgsBase64[0] ?? "",
    "base64"
  ).toString("hex");
  assert.equal(selector.startsWith(BUY_WITH_LIMIT_SELECTOR_HEX), true);
  assertEncodedGroupIsValid(quote.encodedTransactions);
  setHaystackBuyBondingDependenciesForTests(undefined);
});

test("a routed buy that would take 90% or more of remaining reserves is refused", async () => {
  setHaystackBuyBondingDependenciesForTests({
    resolveState: async () => buyState({ bondingTokenId: USDC, realTokenReserves: 1_000n, directTokensOut: null }),
    getSuggestedParams: async () => suggestedParams(),
    quoteBondingSwap: async () => ({ minOut: 10n, legs: [{ txn: pay(USER_ADDRESS, 1n) }] }),
    tokensReceivedForBuy: async () => 900n
  });
  await assert.rejects(
    () =>
      compileExecutableQuote(
        registry(haystackBuyBondingShape),
        "mainnet:haystack:v1:buy:bonding",
        {
          userAddress: USER_ADDRESS,
          assetId: 3_729_195_158,
          fromAssetId: 0,
          amount: "5",
          slippageBps: 0
        },
        buildContext()
      ),
    /bonding asset/
  );
  setHaystackBuyBondingDependenciesForTests(undefined);
});

test("an already graduated token refuses the bonding buy", async () => {
  setHaystackBuyBondingDependenciesForTests({
    resolveState: async () => buyState({ bondingOn: 3 }),
    getSuggestedParams: async () => suggestedParams()
  });
  await assert.rejects(
    () =>
      compileExecutableQuote(
        registry(haystackBuyBondingShape),
        "mainnet:haystack:v1:buy:bonding",
        {
          userAddress: USER_ADDRESS,
          tokenNum: 175,
          fromAssetId: 0,
          amount: "1",
          slippageBps: 0
        },
        buildContext()
      ),
    /left the bonding curve/
  );
  setHaystackBuyBondingDependenciesForTests(undefined);
});

function registry(shape: typeof haystackLaunchTokenShape | typeof haystackBuyBondingShape) {
  const value = new TransactionShapeRegistry();
  value.register(shape);
  return value;
}

function pay(receiver: string, amount: bigint): Transaction {
  return algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: USER_ADDRESS,
    receiver,
    amount,
    suggestedParams: suggestedParams()
  });
}

function axfer(receiver: string, assetIndex: number, amount: bigint): Transaction {
  return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: USER_ADDRESS,
    receiver,
    assetIndex,
    amount,
    suggestedParams: suggestedParams()
  });
}

function optIn(assetIndex: number): Transaction {
  return axfer(USER_ADDRESS, assetIndex, 0n);
}

function appl(selector: string, fee: bigint): Transaction {
  return algosdk.makeApplicationNoOpTxnFromObject({
    sender: USER_ADDRESS,
    appIndex: BigInt(HAYSTACK_LAUNCH_APP_ID),
    appArgs: [Uint8Array.from(Buffer.from(selector, "hex"))],
    suggestedParams: suggestedParams(fee)
  });
}

function assign(txns: Transaction[]): Transaction[] {
  return algosdk.assignGroupID(txns);
}

function member(
  type: string,
  fee: string,
  appIndex: string | null,
  amount: string | null,
  assetIndex: string | null,
  receiver: string | null
) {
  return { type, fee, appIndex, amount, assetIndex, receiver };
}
