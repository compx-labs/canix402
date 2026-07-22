import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import {
  compileExecutableQuote,
  createExecutionRegistry
} from "../../src/execution/index.js";
import type { ShapeBuildContext } from "../../src/execution/index.js";
import {
  mythFinanceMintLstShape,
  mythFinanceRedeemLstShape,
  setMythMintLstDependenciesForTests,
  setMythRedeemLstDependenciesForTests,
  type MythDualStakeState
} from "../../src/execution/shapes/myth-finance/index.js";

const USER = algosdk.generateAccount();
const USER_ADDRESS = USER.addr.toString();
const APP_ID = 3028076093;
const APP_ADDRESS = algosdk.getApplicationAddress(APP_ID).toString();
const ASA_ID = 885835936;
const LST_ID = 3028084000;
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
    tinymanAppId: 1002541853n,
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

function payment(amount: bigint): algosdk.Transaction {
  return algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: USER_ADDRESS,
    receiver: APP_ADDRESS,
    amount,
    suggestedParams: suggestedParams()
  });
}

function axfer(assetIndex: number, amount: bigint, receiver = APP_ADDRESS): algosdk.Transaction {
  return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: USER_ADDRESS,
    receiver,
    assetIndex,
    amount,
    suggestedParams: suggestedParams()
  });
}

function appCall(): algosdk.Transaction {
  return algosdk.makeApplicationNoOpTxnFromObject({
    sender: USER_ADDRESS,
    appIndex: APP_ID,
    suggestedParams: suggestedParams(),
    appArgs: []
  });
}

test.afterEach(() => {
  setMythMintLstDependenciesForTests(undefined);
  setMythRedeemLstDependenciesForTests(undefined);
});

test("Myth mint shape builds grouped transactions", async () => {
  const state = mythState();
  setMythMintLstDependenciesForTests({
    resolveState: async () => state,
    buildMint: async () => {
      const txns = [appCall(), payment(AMOUNT), axfer(ASA_ID, 418_000n)];
      return algosdk.assignGroupID(txns);
    }
  });

  const amount = AMOUNT;
  const quote = await compileExecutableQuote(
    createExecutionRegistry(),
    mythFinanceMintLstShape.key,
    {
      userAddress: USER_ADDRESS,
      amount: amount.toString(),
      appId: APP_ID
    },
    buildContext()
  );

  assert.equal(quote.shapeKey, "mainnet:myth-finance:dualstake-v1:mint:lst");
  assert.equal(quote.transactions.length, 3);
  assert.equal(quote.metadata?.lstId, LST_ID);
});

test("Myth redeem shape builds grouped transactions", async () => {
  const state = mythState();
  setMythRedeemLstDependenciesForTests({
    resolveState: async () => state,
    buildRedeem: async () => {
      const txns = [axfer(LST_ID, AMOUNT), appCall()];
      return algosdk.assignGroupID(txns);
    }
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
});

test("registry includes Myth mint and redeem shapes", () => {
  const registry = createExecutionRegistry();
  assert.ok(registry.get("mainnet:myth-finance:dualstake-v1:mint:lst"));
  assert.ok(registry.get("mainnet:myth-finance:dualstake-v1:redeem:lst"));
});
