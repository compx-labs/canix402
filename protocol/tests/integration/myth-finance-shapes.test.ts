import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import {
  compileExecutableQuote,
  createExecutionRegistry
} from "../../src/execution/index.js";
import type { ShapeBuildContext } from "../../src/execution/index.js";
import {
  buildMockMythMintGroup,
  buildMockMythRedeemGroup,
  expectedAsaForMint,
  mythFinanceMintLstShape,
  mythFinanceRedeemLstShape,
  setMythMintLstDependenciesForTests,
  setMythRedeemLstDependenciesForTests,
  type MythDualStakeState
} from "../../src/execution/shapes/myth-finance/index.js";
import {
  assertEncodedGroupIsValid,
  assertGoldenGroup
} from "../helpers/golden-group.js";

const USER = algosdk.generateAccount();
const USER_ADDRESS = USER.addr.toString();
const APP_ID = 3028076093;
const APP_ADDRESS = algosdk.getApplicationAddress(APP_ID).toString();
const ASA_ID = 885835936;
const LST_ID = 3028084000;
const TINYMAN_APP_ID = 1002541853n;
const GENESIS_HASH = new Uint8Array(32).fill(19);
const AMOUNT = 1_000_000n;

function suggestedParams(): algosdk.SuggestedParams {
  return {
    fee: 1000n,
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
    now: () => Date.UTC(2026, 6, 22, 12, 0, 0),
    quoteTtlMs: 30_000
  };
}

function mythState(overrides?: Partial<MythDualStakeState>): MythDualStakeState {
  return {
    network: "mainnet",
    appId: APP_ID,
    appAddress: APP_ADDRESS,
    asaId: ASA_ID,
    lstId: LST_ID,
    lstName: "memoALGO",
    asaUnitName: "MemO",
    rate: 4_171_200_652n,
    staked: 31_115_000_000n,
    isOnline: true,
    tinymanAppId: TINYMAN_APP_ID,
    lpId: USER_ADDRESS,
    userAlgoBalance: 10_000_000n,
    userAsaBalance: 10_000_000n,
    userLstBalance: 10_000_000n,
    needsLstOptIn: false,
    needsAsaOptIn: false,
    platformFeeBps: 0,
    noderunnerFeeBps: 400,
    ...overrides
  };
}

test.afterEach(() => {
  setMythMintLstDependenciesForTests(undefined);
  setMythRedeemLstDependenciesForTests(undefined);
});

test("Myth mint shape builds grouped transactions", async () => {
  const state = mythState();
  const asaAmount = expectedAsaForMint(AMOUNT, state.rate);
  setMythMintLstDependenciesForTests({
    resolveState: async () => state,
    buildMint: async () =>
      buildMockMythMintGroup({
        userAddress: USER_ADDRESS,
        appId: APP_ID,
        appAddress: APP_ADDRESS,
        asaId: ASA_ID,
        lstId: LST_ID,
        algoAmount: AMOUNT,
        asaAmount,
        tinymanAppId: TINYMAN_APP_ID,
        lpId: USER_ADDRESS,
        includeLstOptIn: false,
        suggestedParams: suggestedParams()
      })
  });

  const quote = await compileExecutableQuote(
    createExecutionRegistry(),
    mythFinanceMintLstShape.key,
    {
      userAddress: USER_ADDRESS,
      amount: AMOUNT.toString(),
      appId: APP_ID
    },
    buildContext()
  );

  assert.equal(quote.shapeKey, "mainnet:myth-finance:dualstake-v1:mint:lst");
  assert.equal(quote.transactions.length, 3);
  assert.equal(quote.metadata?.lstId, LST_ID);
  assert.equal(quote.metadata?.expectedAsaIn, asaAmount.toString());
  assertEncodedGroupIsValid(quote.encodedTransactions);
  assertGoldenGroup(quote.transactions, {
    types: ["appl", "pay", "axfer"],
    members: [
      {
        type: "appl",
        fee: "2000",
        appIndex: String(APP_ID),
        amount: null,
        assetIndex: null,
        receiver: null
      },
      {
        type: "pay",
        fee: "1000",
        appIndex: null,
        amount: AMOUNT.toString(),
        assetIndex: null,
        receiver: APP_ADDRESS
      },
      {
        type: "axfer",
        fee: "1000",
        appIndex: null,
        amount: asaAmount.toString(),
        assetIndex: String(ASA_ID),
        receiver: APP_ADDRESS
      }
    ],
    userSignIndexes: [0, 1, 2]
  });
});

test("Myth mint shape prefixes LST opt-in when needed", async () => {
  const state = mythState({ needsLstOptIn: true });
  const asaAmount = expectedAsaForMint(AMOUNT, state.rate);
  setMythMintLstDependenciesForTests({
    resolveState: async () => state,
    buildMint: async () =>
      buildMockMythMintGroup({
        userAddress: USER_ADDRESS,
        appId: APP_ID,
        appAddress: APP_ADDRESS,
        asaId: ASA_ID,
        lstId: LST_ID,
        algoAmount: AMOUNT,
        asaAmount,
        tinymanAppId: TINYMAN_APP_ID,
        lpId: USER_ADDRESS,
        includeLstOptIn: true,
        suggestedParams: suggestedParams()
      })
  });

  const quote = await compileExecutableQuote(
    createExecutionRegistry(),
    mythFinanceMintLstShape.key,
    {
      userAddress: USER_ADDRESS,
      amount: AMOUNT.toString(),
      appId: APP_ID
    },
    buildContext()
  );

  assert.equal(quote.transactions.length, 4);
  assert.equal(quote.transactions[0]?.type, "axfer");
  assert.equal(quote.transactions[0]?.assetTransfer?.assetIndex, String(LST_ID));
  assert.equal(quote.transactions[0]?.assetTransfer?.amount, "0");
  assert.equal(quote.metadata?.includesLstOptIn, true);
  assertEncodedGroupIsValid(quote.encodedTransactions);
});

test("Myth redeem shape builds grouped transactions", async () => {
  const state = mythState();
  setMythRedeemLstDependenciesForTests({
    resolveState: async () => state,
    buildRedeem: async () =>
      buildMockMythRedeemGroup({
        userAddress: USER_ADDRESS,
        appId: APP_ID,
        appAddress: APP_ADDRESS,
        asaId: ASA_ID,
        lstId: LST_ID,
        lstAmount: AMOUNT,
        tinymanAppId: TINYMAN_APP_ID,
        lpId: USER_ADDRESS,
        includeAsaOptIn: false,
        suggestedParams: suggestedParams()
      })
  });

  const quote = await compileExecutableQuote(
    createExecutionRegistry(),
    mythFinanceRedeemLstShape.key,
    {
      userAddress: USER_ADDRESS,
      amount: AMOUNT.toString(),
      appId: APP_ID
    },
    buildContext()
  );

  assert.equal(quote.shapeKey, "mainnet:myth-finance:dualstake-v1:redeem:lst");
  assert.equal(quote.transactions.length, 2);
  assertEncodedGroupIsValid(quote.encodedTransactions);
  assertGoldenGroup(quote.transactions, {
    types: ["axfer", "appl"],
    members: [
      {
        type: "axfer",
        fee: "1000",
        appIndex: null,
        amount: AMOUNT.toString(),
        assetIndex: String(LST_ID),
        receiver: APP_ADDRESS
      },
      {
        type: "appl",
        fee: "3000",
        appIndex: String(APP_ID),
        amount: null,
        assetIndex: null,
        receiver: null
      }
    ],
    userSignIndexes: [0, 1]
  });
});

test("Myth redeem shape prefixes ASA opt-in when needed", async () => {
  const state = mythState({ needsAsaOptIn: true });
  setMythRedeemLstDependenciesForTests({
    resolveState: async () => state,
    buildRedeem: async () =>
      buildMockMythRedeemGroup({
        userAddress: USER_ADDRESS,
        appId: APP_ID,
        appAddress: APP_ADDRESS,
        asaId: ASA_ID,
        lstId: LST_ID,
        lstAmount: AMOUNT,
        tinymanAppId: TINYMAN_APP_ID,
        lpId: USER_ADDRESS,
        includeAsaOptIn: true,
        suggestedParams: suggestedParams()
      })
  });

  const quote = await compileExecutableQuote(
    createExecutionRegistry(),
    mythFinanceRedeemLstShape.key,
    {
      userAddress: USER_ADDRESS,
      amount: AMOUNT.toString(),
      appId: APP_ID
    },
    buildContext()
  );

  assert.equal(quote.transactions.length, 3);
  assert.equal(quote.transactions[0]?.type, "axfer");
  assert.equal(quote.transactions[0]?.assetTransfer?.assetIndex, String(ASA_ID));
  assert.equal(quote.transactions[0]?.assetTransfer?.amount, "0");
  assertEncodedGroupIsValid(quote.encodedTransactions);
});

test("registry includes Myth mint and redeem shapes", () => {
  const registry = createExecutionRegistry();
  assert.ok(registry.get("mainnet:myth-finance:dualstake-v1:mint:lst"));
  assert.ok(registry.get("mainnet:myth-finance:dualstake-v1:redeem:lst"));
});
