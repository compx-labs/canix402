import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import {
  TransactionShapeRegistry,
  compileExecutableQuote
} from "../../src/execution/index.js";
import type { ShapeBuildContext } from "../../src/execution/index.js";
import {
  setTinymanFarmClaimRewardsDependenciesForTests,
  setTinymanFarmUncommitDependenciesForTests,
  tinymanFarmClaimRewardsShape,
  tinymanFarmUncommitShape,
  type TinymanFarmState
} from "../../src/execution/shapes/tinyman/index.js";

const USER = algosdk.generateAccount();
const USER_ADDRESS = USER.addr.toString();
const PROGRAM = algosdk.generateAccount().addr.toString();
const GENESIS_HASH = new Uint8Array(32).fill(3);
const STAKING_APP_ID = 649588853;
const LP_ASSET_ID = 1002590888;

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
    now: () => Date.UTC(2026, 6, 16, 12, 0, 0),
    quoteTtlMs: 30_000
  };
}

function farmState(overrides: Partial<TinymanFarmState> = {}): TinymanFarmState {
  return {
    network: "mainnet",
    stakingAppId: STAKING_APP_ID,
    programId: 258,
    programAccount: PROGRAM,
    liquidityAssetId: LP_ASSET_ID,
    userLpBalance: 5_000_000n,
    poolAddress: "2PIFZW53RHCSFSYMCFUBW4XOCXOMB7XOYQSQ6KGT3KVGJTL4HM6COZRNMM",
    ...overrides
  };
}

test("compiles Tinyman farm uncommit with commitAmount 0", async () => {
  setTinymanFarmUncommitDependenciesForTests({
    resolveFarmState: async () => farmState(),
    prepareCommitTransactions: async () => {
      const params = suggestedParams(2000);
      const txn = algosdk.makeApplicationNoOpTxnFromObject({
        sender: USER_ADDRESS,
        appIndex: STAKING_APP_ID,
        appArgs: [
          new TextEncoder().encode("commit"),
          algosdk.encodeUint64(0n)
        ],
        foreignAssets: [LP_ASSET_ID],
        accounts: [PROGRAM],
        note: new TextEncoder().encode("tinymanStaking/v1:b"),
        suggestedParams: params
      });
      return [{ txn, signers: [USER_ADDRESS] }];
    }
  });

  const registry = new TransactionShapeRegistry();
  registry.register(tinymanFarmUncommitShape);
  const quote = await compileExecutableQuote(
    registry,
    tinymanFarmUncommitShape.key,
    {
      userAddress: USER_ADDRESS,
      commitAmount: "0",
      liquidityAssetId: LP_ASSET_ID,
      programId: 258,
      programAccount: PROGRAM
    },
    buildContext()
  );

  assert.equal(quote.shapeKey, tinymanFarmUncommitShape.key);
  assert.equal(quote.transactions.length, 1);
  assert.ok(
    (quote.warnings ?? []).some((warning) => warning.includes("commitAmount=0"))
  );
});

test("compiles Tinyman farm claimRewards from Analytics-prepared bytes", async () => {
  setTinymanFarmClaimRewardsDependenciesForTests({
    getStakingAppId: () => STAKING_APP_ID,
    prepareClaimTransactions: async () => {
      const params = suggestedParams(2000);
      return [
        algosdk.makeApplicationNoOpTxnFromObject({
          sender: USER_ADDRESS,
          appIndex: STAKING_APP_ID,
          appArgs: [new TextEncoder().encode("claim")],
          suggestedParams: params
        })
      ];
    }
  });

  const registry = new TransactionShapeRegistry();
  registry.register(tinymanFarmClaimRewardsShape);
  const quote = await compileExecutableQuote(
    registry,
    tinymanFarmClaimRewardsShape.key,
    {
      userAddress: USER_ADDRESS,
      programId: 258,
      poolAddress: "2PIFZW53RHCSFSYMCFUBW4XOCXOMB7XOYQSQ6KGT3KVGJTL4HM6COZRNMM"
    },
    buildContext()
  );

  assert.equal(quote.shapeKey, tinymanFarmClaimRewardsShape.key);
  assert.equal(quote.transactions.length, 1);
});

test("compiles Tinyman farm claimRewards with fee-pooled sibling axfer (fee 0)", async () => {
  const farmAccount = algosdk.generateAccount();
  const rewardAssetId = 2_200_000_000;

  setTinymanFarmClaimRewardsDependenciesForTests({
    getStakingAppId: () => STAKING_APP_ID,
    prepareClaimTransactions: async () => {
      const appl = algosdk.makeApplicationNoOpTxnFromObject({
        sender: USER_ADDRESS,
        appIndex: STAKING_APP_ID,
        appArgs: [new TextEncoder().encode("claim")],
        suggestedParams: suggestedParams(2000)
      });
      const axfer = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: farmAccount.addr,
        receiver: USER_ADDRESS,
        assetIndex: rewardAssetId,
        amount: 1_000_000n,
        suggestedParams: suggestedParams(0)
      });
      const group = [appl, axfer];
      algosdk.assignGroupID(group);
      return group;
    }
  });

  const registry = new TransactionShapeRegistry();
  registry.register(tinymanFarmClaimRewardsShape);
  const quote = await compileExecutableQuote(
    registry,
    tinymanFarmClaimRewardsShape.key,
    {
      userAddress: USER_ADDRESS,
      programId: 258,
      poolAddress: "2PIFZW53RHCSFSYMCFUBW4XOCXOMB7XOYQSQ6KGT3KVGJTL4HM6COZRNMM"
    },
    buildContext()
  );

  assert.equal(quote.transactions.length, 2);
  assert.equal(quote.transactions[0]!.fee, "2000");
  assert.equal(quote.transactions[1]!.fee, "0");
  assert.ok(quote.transactions.every((txn) => txn.groupPresent));
});

test("tops up user appl fee when Analytics claim group fee pool is short", async () => {
  const farmAccount = algosdk.generateAccount();
  const rewardAssetId = 2_200_000_000;

  setTinymanFarmClaimRewardsDependenciesForTests({
    getStakingAppId: () => STAKING_APP_ID,
    prepareClaimTransactions: async () => {
      // Pool = 1000 + 0 = 1000, but 2 × 1000 is required → top up user appl to 2000.
      const appl = algosdk.makeApplicationNoOpTxnFromObject({
        sender: USER_ADDRESS,
        appIndex: STAKING_APP_ID,
        appArgs: [new TextEncoder().encode("claim")],
        suggestedParams: suggestedParams(1000)
      });
      const axfer = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: farmAccount.addr,
        receiver: USER_ADDRESS,
        assetIndex: rewardAssetId,
        amount: 1_000_000n,
        suggestedParams: suggestedParams(0)
      });
      const group = [appl, axfer];
      algosdk.assignGroupID(group);
      return group;
    }
  });

  const registry = new TransactionShapeRegistry();
  registry.register(tinymanFarmClaimRewardsShape);
  const quote = await compileExecutableQuote(
    registry,
    tinymanFarmClaimRewardsShape.key,
    {
      userAddress: USER_ADDRESS,
      programId: 258,
      poolAddress: "2PIFZW53RHCSFSYMCFUBW4XOCXOMB7XOYQSQ6KGT3KVGJTL4HM6COZRNMM"
    },
    buildContext()
  );

  assert.equal(quote.transactions.length, 2);
  assert.equal(quote.transactions[0]!.fee, "2000");
  assert.equal(quote.transactions[1]!.fee, "0");
  assert.equal(quote.transactions[0]!.sender, USER_ADDRESS);
});

test.after(() => {
  setTinymanFarmUncommitDependenciesForTests();
  setTinymanFarmClaimRewardsDependenciesForTests();
});
