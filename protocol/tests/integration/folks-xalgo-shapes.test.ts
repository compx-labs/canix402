import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";
import type { ConsensusState } from "@folks-finance/algorand-sdk";
import { MainnetConsensusConfig, MainnetOpUp } from "@folks-finance/algorand-sdk";

import {
  compileExecutableQuote,
  createExecutionRegistry,
  serializeTransaction
} from "../../src/execution/index.js";
import type { ShapeBuildContext } from "../../src/execution/index.js";
import {
  folksFinanceStakeImmediateShape,
  folksFinanceUnstakeImmediateShape,
  setFolksStakeImmediateDependenciesForTests,
  setFolksUnstakeImmediateDependenciesForTests
} from "../../src/execution/shapes/folks-finance/index.js";
import type { FolksXAlgoState } from "../../src/execution/shapes/folks-finance/xalgo-state.js";

const USER = algosdk.generateAccount();
const USER_ADDRESS = USER.addr.toString();
const CONSENSUS_APP_ID = MainnetConsensusConfig.consensusAppId;
const CONSENSUS_APP_ADDRESS = algosdk.getApplicationAddress(CONSENSUS_APP_ID).toString();
const XALGO_ID = MainnetConsensusConfig.xAlgoId;
const GENESIS_HASH = new Uint8Array(32).fill(17);
const STAKE_AMOUNT = 1_000_000n;
const UNSTAKE_AMOUNT = 900_000n;

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
    now: () => Date.UTC(2026, 6, 17, 12, 0, 0),
    quoteTtlMs: 30_000
  };
}

function consensusState(): ConsensusState {
  return {
    currentRound: 50_000_000,
    algoBalance: 10_000_000_000_000n,
    xAlgoCirculatingSupply: 9_500_000_000_000n,
    proposersBalances: [{ address: USER_ADDRESS, algoBalance: 1_000_000_000n }],
    adminAddress: USER_ADDRESS,
    registerAdminAddress: USER_ADDRESS,
    xGovAdminAddress: USER_ADDRESS,
    timeDelay: 0n,
    numProposers: 1n,
    maxProposerBalance: 0n,
    fee: 0n,
    premium: 0n,
    lastProposersActiveBalance: 0n,
    totalPendingStake: 0n,
    totalUnclaimedFees: 0n,
    canImmediateStake: true,
    canDelayStake: false
  };
}

function xalgoState(overrides?: Partial<FolksXAlgoState>): FolksXAlgoState {
  const state = consensusState();
  return {
    network: "mainnet",
    consensusAppId: CONSENSUS_APP_ID,
    consensusAppAddress: CONSENSUS_APP_ADDRESS,
    xAlgoId: XALGO_ID,
    stakeAndDepositAppId: MainnetConsensusConfig.stakeAndDepositAppId,
    consensusState: state,
    userAlgoBalance: 10_000_000n,
    userXAlgoBalance: 5_000_000n,
    needsXAlgoOptIn: false,
    expectedXAlgoFromAlgo: (algoAmount) => (algoAmount * 95n) / 100n,
    expectedAlgoFromXAlgo: (xAlgoAmount) => (xAlgoAmount * 100n) / 95n,
    ...overrides
  };
}

function buildStakeGroup(includeOpUp: boolean): algosdk.Transaction[] {
  const txns: algosdk.Transaction[] = [];
  if (includeOpUp) {
    txns.push(
      algosdk.makeApplicationNoOpTxnFromObject({
        sender: USER.addr,
        appIndex: BigInt(MainnetOpUp.callerAppId),
        foreignApps: [BigInt(MainnetOpUp.baseAppId)],
        appArgs: [algosdk.encodeUint64(0)],
        suggestedParams: suggestedParams(1000)
      })
    );
  }
  txns.push(
    algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: USER.addr,
      receiver: CONSENSUS_APP_ADDRESS,
      amount: STAKE_AMOUNT,
      suggestedParams: suggestedParams(0)
    }),
    algosdk.makeApplicationNoOpTxnFromObject({
      sender: USER.addr,
      appIndex: BigInt(CONSENSUS_APP_ID),
      suggestedParams: suggestedParams(4000)
    })
  );
  algosdk.assignGroupID(txns);
  return txns;
}

function buildUnstakeGroup(includeOpUp: boolean): algosdk.Transaction[] {
  const txns: algosdk.Transaction[] = [];
  if (includeOpUp) {
    txns.push(
      algosdk.makeApplicationNoOpTxnFromObject({
        sender: USER.addr,
        appIndex: BigInt(MainnetOpUp.callerAppId),
        foreignApps: [BigInt(MainnetOpUp.baseAppId)],
        appArgs: [algosdk.encodeUint64(0)],
        suggestedParams: suggestedParams(1000)
      })
    );
  }
  txns.push(
    algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: USER.addr,
      receiver: CONSENSUS_APP_ADDRESS,
      amount: UNSTAKE_AMOUNT,
      assetIndex: XALGO_ID,
      suggestedParams: suggestedParams(0)
    }),
    algosdk.makeApplicationNoOpTxnFromObject({
      sender: USER.addr,
      appIndex: BigInt(CONSENSUS_APP_ID),
      suggestedParams: suggestedParams(4000)
    })
  );
  algosdk.assignGroupID(txns);
  return txns;
}

test.afterEach(() => {
  setFolksStakeImmediateDependenciesForTests();
  setFolksUnstakeImmediateDependenciesForTests();
});

test("stake immediate shape builds OpUp + payment + consensus call", async () => {
  const group = buildStakeGroup(true);
  setFolksStakeImmediateDependenciesForTests({
    resolveState: async () => xalgoState(),
    getSuggestedParams: async () => suggestedParams(1000),
    prepareImmediateStakeTransactions: () => group.slice(1),
    prefixWithOpUp: () => group
  });

  const input = {
    userAddress: USER_ADDRESS,
    amount: STAKE_AMOUNT,
    receiverAddress: USER_ADDRESS,
    minReceivedAmount: 0n,
    includeOpUp: true
  };
  const state = xalgoState();
  const result = await folksFinanceStakeImmediateShape.build(buildContext(), input, state);

  assert.equal(result.transactions.length, 3);
  assert.equal(result.metadata.consensusAppId, CONSENSUS_APP_ID);
  assert.equal(result.metadata.xAlgoId, XALGO_ID);
  assert.equal(result.metadata.amountIn, STAKE_AMOUNT.toString());
  assert.equal(result.metadata.expectedXAlgoOut, ((STAKE_AMOUNT * 95n) / 100n).toString());

  const validation = folksFinanceStakeImmediateShape.validate(
    result.transactions.map(serializeTransaction),
    input,
    state
  );
  assert.equal(validation.valid, true, validation.errors.join("; "));
});

test("unstake immediate shape validates axfer + consensus call", () => {
  const group = buildUnstakeGroup(true).map(serializeTransaction);
  const input = {
    userAddress: USER_ADDRESS,
    amount: UNSTAKE_AMOUNT,
    receiverAddress: USER_ADDRESS,
    minReceivedAmount: 0n,
    includeOpUp: true
  };
  const result = folksFinanceUnstakeImmediateShape.validate(group, input, xalgoState());
  assert.equal(result.valid, true, result.errors.join("; "));
});

test("stake parseInput defaults receiver and minReceivedAmount", () => {
  const parsed = folksFinanceStakeImmediateShape.parseInput({
    userAddress: USER_ADDRESS,
    amount: "1000000"
  });
  assert.equal(parsed.receiverAddress, USER_ADDRESS);
  assert.equal(parsed.minReceivedAmount, 0n);
  assert.equal(parsed.includeOpUp, true);
  assert.equal(parsed.amount, 1_000_000n);
});

test("stake rejects when immediate staking is disabled", async () => {
  setFolksStakeImmediateDependenciesForTests({
    resolveState: async () =>
      xalgoState({
        consensusState: { ...consensusState(), canImmediateStake: false }
      }),
    getSuggestedParams: async () => suggestedParams(1000),
    prepareImmediateStakeTransactions: () => buildStakeGroup(false),
    prefixWithOpUp: (_opup, _user, txns) => txns as algosdk.Transaction[]
  });

  await assert.rejects(
    () =>
      folksFinanceStakeImmediateShape.build(
        buildContext(),
        {
          userAddress: USER_ADDRESS,
          amount: STAKE_AMOUNT,
          receiverAddress: USER_ADDRESS,
          minReceivedAmount: 0n,
          includeOpUp: false
        },
        xalgoState({
          consensusState: { ...consensusState(), canImmediateStake: false }
        })
      ),
    /immediate staking is currently disabled/
  );
});

test("registry includes Folks xALGO immediate shapes", async () => {
  setFolksStakeImmediateDependenciesForTests({
    resolveState: async () => xalgoState(),
    getSuggestedParams: async () => suggestedParams(1000),
    prepareImmediateStakeTransactions: () => buildStakeGroup(true).slice(1),
    prefixWithOpUp: () => buildStakeGroup(true)
  });
  setFolksUnstakeImmediateDependenciesForTests({
    resolveState: async () => xalgoState(),
    getSuggestedParams: async () => suggestedParams(1000),
    prepareUnstakeTransactions: () => buildUnstakeGroup(true).slice(1),
    prefixWithOpUp: () => buildUnstakeGroup(true)
  });

  const registry = createExecutionRegistry();
  assert.ok(registry.get("mainnet:folks-finance:xalgo-v1:stake:immediate"));
  assert.ok(registry.get("mainnet:folks-finance:xalgo-v1:unstake:immediate"));

  const stakeQuote = await compileExecutableQuote(
    registry,
    "mainnet:folks-finance:xalgo-v1:stake:immediate",
    { userAddress: USER_ADDRESS, amount: STAKE_AMOUNT.toString() },
    buildContext()
  );
  assert.equal(stakeQuote.shapeKey, "mainnet:folks-finance:xalgo-v1:stake:immediate");
  assert.ok(stakeQuote.transactions.length >= 3);

  const unstakeQuote = await compileExecutableQuote(
    registry,
    "mainnet:folks-finance:xalgo-v1:unstake:immediate",
    { userAddress: USER_ADDRESS, amount: UNSTAKE_AMOUNT.toString() },
    buildContext()
  );
  assert.equal(unstakeQuote.shapeKey, "mainnet:folks-finance:xalgo-v1:unstake:immediate");
  assert.ok(unstakeQuote.transactions.length >= 3);
});
