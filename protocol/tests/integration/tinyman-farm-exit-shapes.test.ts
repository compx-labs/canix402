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
const DISTRIBUTION = "2X5655WLATREYROKXQJJMD5U4RKCHVX3LS23TTB4PEVMCGD7Q6FP7PCOYY";
const REWARD_ASSET_ID = 2_200_000_000;
const POOL = "2PIFZW53RHCSFSYMCFUBW4XOCXOMB7XOYQSQ6KGT3KVGJTL4HM6COZRNMM";

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
    poolAddress: POOL,
    ...overrides
  };
}

function buildClaimGroup(options?: {
  userFee?: number;
  farmFee?: number;
}): algosdk.Transaction[] {
  const appl = algosdk.makeApplicationNoOpTxnFromObject({
    sender: USER_ADDRESS,
    appIndex: STAKING_APP_ID,
    appArgs: [new TextEncoder().encode("claim")],
    suggestedParams: suggestedParams(options?.userFee ?? 2000)
  });
  const axfer = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: DISTRIBUTION,
    receiver: USER_ADDRESS,
    assetIndex: REWARD_ASSET_ID,
    amount: 1_000_000n,
    suggestedParams: suggestedParams(options?.farmFee ?? 0)
  });
  const group = [appl, axfer];
  algosdk.assignGroupID(group);
  return group;
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

test("compiles Tinyman farm claimRewards with user-only encodedTransactions", async () => {
  setTinymanFarmClaimRewardsDependenciesForTests({
    getStakingAppId: () => STAKING_APP_ID,
    prepareClaimTransactions: async () => buildClaimGroup(),
    claimApiBaseUrl: () => "https://mainnet.analytics.tinyman.org/api/v1"
  });

  const registry = new TransactionShapeRegistry();
  registry.register(tinymanFarmClaimRewardsShape);
  const quote = await compileExecutableQuote(
    registry,
    tinymanFarmClaimRewardsShape.key,
    {
      userAddress: USER_ADDRESS,
      programId: 258,
      poolAddress: POOL
    },
    buildContext()
  );

  assert.equal(quote.shapeKey, tinymanFarmClaimRewardsShape.key);
  assert.equal(quote.transactions.length, 2);
  assert.equal(quote.encodedTransactions.length, 1);
  assert.deepEqual(quote.userSignIndexes, [0]);
  assert.ok(quote.groupTransactions);
  assert.equal(quote.groupTransactions!.length, 2);
  assert.equal(quote.groupTransactions![0]!.signer, "user");
  assert.equal(quote.groupTransactions![1]!.signer, "protocol");
  assert.equal(quote.groupTransactions![1]!.signedTransaction, undefined);
  assert.equal(quote.transactions[1]!.sender, DISTRIBUTION);

  const userTxn = algosdk.decodeUnsignedTransaction(
    Buffer.from(quote.encodedTransactions[0]!, "base64")
  );
  assert.equal(userTxn.sender.toString(), USER_ADDRESS);

  assert.equal(quote.metadata.submitMode, "tinyman-analytics-claim");
  assert.equal(
    quote.metadata.claimUrl,
    "https://mainnet.analytics.tinyman.org/api/v1/staking/rewards/claim/"
  );
  assert.deepEqual(quote.metadata.unsignedProtocolTransactions, [
    quote.groupTransactions![1]!.encodedTransaction
  ]);
  assert.ok(
    (quote.warnings ?? []).some((warning) => warning.includes("protocol key"))
  );
});

test("compiles Tinyman farm claimRewards with fee-pooled sibling axfer (fee 0)", async () => {
  setTinymanFarmClaimRewardsDependenciesForTests({
    getStakingAppId: () => STAKING_APP_ID,
    prepareClaimTransactions: async () => buildClaimGroup({ userFee: 2000, farmFee: 0 })
  });

  const registry = new TransactionShapeRegistry();
  registry.register(tinymanFarmClaimRewardsShape);
  const quote = await compileExecutableQuote(
    registry,
    tinymanFarmClaimRewardsShape.key,
    {
      userAddress: USER_ADDRESS,
      programId: 258,
      poolAddress: POOL
    },
    buildContext()
  );

  assert.equal(quote.transactions.length, 2);
  assert.equal(quote.transactions[0]!.fee, "2000");
  assert.equal(quote.transactions[1]!.fee, "0");
  assert.ok(quote.transactions.every((txn) => txn.groupPresent));
  assert.equal(quote.encodedTransactions.length, 1);
});

test("tops up user appl fee when Analytics claim group fee pool is short", async () => {
  setTinymanFarmClaimRewardsDependenciesForTests({
    getStakingAppId: () => STAKING_APP_ID,
    prepareClaimTransactions: async () =>
      // Pool = 1000 + 0 = 1000, but 2 × 1000 is required → top up user appl to 2000.
      buildClaimGroup({ userFee: 1000, farmFee: 0 })
  });

  const registry = new TransactionShapeRegistry();
  registry.register(tinymanFarmClaimRewardsShape);
  const quote = await compileExecutableQuote(
    registry,
    tinymanFarmClaimRewardsShape.key,
    {
      userAddress: USER_ADDRESS,
      programId: 258,
      poolAddress: POOL
    },
    buildContext()
  );

  assert.equal(quote.transactions.length, 2);
  assert.equal(quote.transactions[0]!.fee, "2000");
  assert.equal(quote.transactions[1]!.fee, "0");
  assert.equal(quote.transactions[0]!.sender, USER_ADDRESS);
  assert.equal(quote.encodedTransactions.length, 1);
});

test.after(() => {
  setTinymanFarmUncommitDependenciesForTests();
  setTinymanFarmClaimRewardsDependenciesForTests();
});
