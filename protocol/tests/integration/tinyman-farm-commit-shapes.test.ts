import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import {
  TransactionShapeRegistry,
  compileExecutableQuote,
  createExecutionRegistry
} from "../../src/execution/index.js";
import type { ShapeBuildContext } from "../../src/execution/index.js";
import {
  setTinymanFarmCommitDependenciesForTests,
  tinymanFarmCommitShape,
  type TinymanFarmState
} from "../../src/execution/shapes/tinyman/index.js";
import { TINYMAN_STAKING_COMMIT_NOTE_PREFIX } from "../../src/execution/shapes/tinyman/farm-state.js";
import {
  assertEncodedGroupIsValid,
  assertGoldenGroup
} from "../helpers/golden-group.js";

const USER = algosdk.generateAccount();
const USER_ADDRESS = USER.addr.toString();
const PROGRAM = algosdk.generateAccount();
const PROGRAM_ACCOUNT = PROGRAM.addr.toString();
const GENESIS_HASH = new Uint8Array(32).fill(3);
const STAKING_APP_ID = 649588853;
const LP_ASSET_ID = 1002590888;
const PROGRAM_ID = 258;
const COMMIT_AMOUNT = 500_000n;

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
    programId: PROGRAM_ID,
    programAccount: PROGRAM_ACCOUNT,
    liquidityAssetId: LP_ASSET_ID,
    userLpBalance: 5_000_000n,
    ...overrides
  };
}

function farmCommitNote(amount: bigint): Uint8Array {
  return new Uint8Array([
    ...new TextEncoder().encode(TINYMAN_STAKING_COMMIT_NOTE_PREFIX),
    ...algosdk.encodeUint64(PROGRAM_ID),
    ...algosdk.encodeUint64(LP_ASSET_ID),
    ...algosdk.encodeUint64(amount)
  ]);
}

function buildCommitGroup(
  amount: bigint,
  options: { requiredAssetId?: number } = {}
): algosdk.Transaction[] {
  const commitTxn = algosdk.makeApplicationNoOpTxnFromObject({
    sender: USER.addr,
    appIndex: BigInt(STAKING_APP_ID),
    appArgs: [new TextEncoder().encode("commit"), algosdk.encodeUint64(amount)],
    foreignAssets: [LP_ASSET_ID],
    accounts: [PROGRAM.addr],
    note: farmCommitNote(amount),
    suggestedParams: suggestedParams(1000)
  });
  const txns = [commitTxn];
  if (options.requiredAssetId !== undefined) {
    txns.push(
      algosdk.makeApplicationNoOpTxnFromObject({
        sender: USER.addr,
        appIndex: BigInt(STAKING_APP_ID),
        appArgs: [new TextEncoder().encode("log_balance")],
        foreignAssets: [options.requiredAssetId],
        suggestedParams: suggestedParams(1000)
      })
    );
    algosdk.assignGroupID(txns);
  }
  return txns;
}

test.afterEach(() => {
  setTinymanFarmCommitDependenciesForTests(undefined);
});

test("farm commit shape compiles a single staking app call", async () => {
  setTinymanFarmCommitDependenciesForTests({
    resolveFarmState: async () => farmState(),
    prepareCommitTransactions: async ({ amount }) =>
      buildCommitGroup(amount).map((txn) => ({ txn }))
  });

  const registry = new TransactionShapeRegistry();
  registry.register(tinymanFarmCommitShape);
  const quote = await compileExecutableQuote(
    registry,
    tinymanFarmCommitShape.key,
    {
      userAddress: USER_ADDRESS,
      liquidityAssetId: LP_ASSET_ID,
      commitAmount: COMMIT_AMOUNT.toString(),
      programId: PROGRAM_ID,
      programAccount: PROGRAM_ACCOUNT
    },
    buildContext()
  );

  assert.equal(quote.shapeKey, "mainnet:tinyman:staking-v1:farm:commit");
  assert.equal(quote.transactions.length, 1);
  assertEncodedGroupIsValid(quote.encodedTransactions);
  assertGoldenGroup(quote.transactions, {
    types: ["appl"],
    members: [
      {
        type: "appl",
        fee: "1000",
        appIndex: String(STAKING_APP_ID),
        amount: null,
        assetIndex: null,
        receiver: null
      }
    ],
    userSignIndexes: [0]
  });
  assert.equal(quote.transactions[0]?.applicationCall?.appArgsText[0], "commit");
  assert.equal(quote.metadata.commitAmount, COMMIT_AMOUNT.toString());
});

test("farm commit shape groups log_balance when a required asset is present", async () => {
  const requiredAssetId = 31566704; // pragma: allowlist secret
  setTinymanFarmCommitDependenciesForTests({
    resolveFarmState: async () => farmState({ requiredAssetId }),
    prepareCommitTransactions: async ({ amount, requiredAssetID }) =>
      buildCommitGroup(
        amount,
        requiredAssetID === undefined ? {} : { requiredAssetId: requiredAssetID }
      ).map((txn) => ({ txn }))
  });

  const registry = new TransactionShapeRegistry();
  registry.register(tinymanFarmCommitShape);
  const quote = await compileExecutableQuote(
    registry,
    tinymanFarmCommitShape.key,
    {
      userAddress: USER_ADDRESS,
      liquidityAssetId: LP_ASSET_ID,
      commitAmount: COMMIT_AMOUNT.toString(),
      programId: PROGRAM_ID,
      programAccount: PROGRAM_ACCOUNT,
      requiredAssetId
    },
    buildContext()
  );

  assert.equal(quote.transactions.length, 2);
  assertEncodedGroupIsValid(quote.encodedTransactions);
  assertGoldenGroup(quote.transactions, {
    types: ["appl", "appl"],
    members: [
      {
        type: "appl",
        fee: "1000",
        appIndex: String(STAKING_APP_ID),
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
    userSignIndexes: [0, 1]
  });
  assert.equal(quote.transactions[1]?.applicationCall?.appArgsText[0], "log_balance");
});

test("createExecutionRegistry includes Tinyman farm commit", () => {
  const registry = createExecutionRegistry();
  assert.equal(registry.has("mainnet:tinyman:staking-v1:farm:commit"), true);
});
