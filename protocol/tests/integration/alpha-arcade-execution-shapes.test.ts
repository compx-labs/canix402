import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import {
  ShapeStateError,
  TransactionShapeRegistry,
  compileExecutableQuote
} from "../../src/execution/index.js";
import type { ShapeBuildContext } from "../../src/execution/index.js";
import {
  ALPHA_ARCADE_STAKING_APP_ID,
  ALPHA_ASSET_ID,
  USDC_ASSET_ID,
  alphaArcadeClaimRewardsShape,
  alphaArcadeStakeAlphaShape,
  alphaArcadeUnstakeAlphaShape,
  buildMockClaimGroup,
  buildMockStakeGroup,
  buildMockUnstakeGroup,
  setAlphaArcadeClaimRewardsDependenciesForTests,
  setAlphaArcadeStakeAlphaDependenciesForTests,
  setAlphaArcadeUnstakeAlphaDependenciesForTests,
  type AlphaArcadeStakingState
} from "../../src/execution/shapes/alpha-arcade/index.js";

const USER = algosdk.generateAccount();
const USER_ADDRESS = USER.addr.toString();
const APP_ADDRESS = algosdk.getApplicationAddress(ALPHA_ARCADE_STAKING_APP_ID).toString();
const GENESIS_HASH = new Uint8Array(32).fill(11);

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
    now: () => Date.UTC(2026, 6, 30, 10, 0, 0),
    quoteTtlMs: 30_000
  };
}

function assertEncodedGroupIsValid(encodedTransactions: readonly string[]): void {
  const transactions = encodedTransactions.map((encoded) =>
    algosdk.decodeUnsignedTransaction(Buffer.from(encoded, "base64"))
  );
  if (transactions.length === 1) {
    return;
  }
  const groupIds = transactions.map((txn) => Buffer.from(txn.group ?? []).toString("base64"));
  assert.ok(groupIds.every((groupId) => groupId.length > 0));

  const ungroupedTransactions = transactions.map((txn) =>
    algosdk.decodeUnsignedTransaction(algosdk.encodeUnsignedTransaction(txn))
  );
  ungroupedTransactions.forEach((txn) => {
    txn.group = undefined;
  });

  const computedGroupId = Buffer.from(algosdk.computeGroupID(ungroupedTransactions)).toString(
    "base64"
  );
  assert.deepEqual(groupIds, new Array(groupIds.length).fill(computedGroupId));
}

function stakingState(overrides: Partial<AlphaArcadeStakingState> = {}): AlphaArcadeStakingState {
  return {
    network: "mainnet",
    appId: ALPHA_ARCADE_STAKING_APP_ID,
    appAddress: APP_ADDRESS,
    alphaAssetId: ALPHA_ASSET_ID,
    usdcAssetId: USDC_ASSET_ID,
    totalStaked: 1_000_000_000n,
    local: overrides.local ?? { optedIn: true, staked: 5_000_000n },
    userAlphaBalance: overrides.userAlphaBalance ?? 10_000_000n,
    userOptedIntoUsdc: overrides.userOptedIntoUsdc ?? true,
    ...overrides
  };
}

test.afterEach(() => {
  setAlphaArcadeStakeAlphaDependenciesForTests(undefined);
  setAlphaArcadeUnstakeAlphaDependenciesForTests(undefined);
  setAlphaArcadeClaimRewardsDependenciesForTests(undefined);
});

test("stake shape compiles a 3-txn group for a first-time staker", async () => {
  const state = stakingState({ local: { optedIn: false, staked: 0n } });
  const amount = 1_000_000n;

  setAlphaArcadeStakeAlphaDependenciesForTests({
    resolveState: async () => state,
    getSuggestedParams: async () => suggestedParams(1000),
    buildComposerGroup: () =>
      buildMockStakeGroup({
        user: USER,
        appId: ALPHA_ARCADE_STAKING_APP_ID,
        appAddress: APP_ADDRESS,
        alphaAssetId: ALPHA_ASSET_ID,
        usdcAssetId: USDC_ASSET_ID,
        amount,
        includeOptIn: true,
        suggestedParams: suggestedParams(1000)
      })
  });

  const registry = new TransactionShapeRegistry();
  registry.register(alphaArcadeStakeAlphaShape);
  const quote = await compileExecutableQuote(
    registry,
    alphaArcadeStakeAlphaShape.key,
    { userAddress: USER_ADDRESS, amount: amount.toString() },
    buildContext()
  );

  assert.equal(quote.transactions.length, 3);
  assertEncodedGroupIsValid(quote.encodedTransactions);
  assert.equal(quote.transactions[0]?.type, "appl");
  assert.equal(quote.transactions[1]?.type, "axfer");
  assert.equal(quote.transactions[2]?.type, "appl");
});

test("stake shape compiles a 2-txn group for a returning staker", async () => {
  const state = stakingState({ local: { optedIn: true, staked: 5_000_000n } });
  const amount = 1_000_000n;

  setAlphaArcadeStakeAlphaDependenciesForTests({
    resolveState: async () => state,
    getSuggestedParams: async () => suggestedParams(1000),
    buildComposerGroup: () =>
      buildMockStakeGroup({
        user: USER,
        appId: ALPHA_ARCADE_STAKING_APP_ID,
        appAddress: APP_ADDRESS,
        alphaAssetId: ALPHA_ASSET_ID,
        usdcAssetId: USDC_ASSET_ID,
        amount,
        includeOptIn: false,
        suggestedParams: suggestedParams(1000)
      })
  });

  const registry = new TransactionShapeRegistry();
  registry.register(alphaArcadeStakeAlphaShape);
  const quote = await compileExecutableQuote(
    registry,
    alphaArcadeStakeAlphaShape.key,
    { userAddress: USER_ADDRESS, amount: amount.toString() },
    buildContext()
  );

  assert.equal(quote.transactions.length, 2);
  assertEncodedGroupIsValid(quote.encodedTransactions);
});

test("unstake shape rejects when not opted in", async () => {
  setAlphaArcadeUnstakeAlphaDependenciesForTests({
    resolveState: async () => {
      throw new ShapeStateError("User is not opted into the Alpha Arcade staking pool.");
    }
  });

  const registry = new TransactionShapeRegistry();
  registry.register(alphaArcadeUnstakeAlphaShape);
  await assert.rejects(
    () =>
      compileExecutableQuote(
        registry,
        alphaArcadeUnstakeAlphaShape.key,
        {
          userAddress: USER_ADDRESS,
          amount: "1000000"
        },
        buildContext()
      ),
    (error: unknown) => error instanceof ShapeStateError
  );
});

test("unstake shape compiles a single app call", async () => {
  const state = stakingState();
  const amount = 1_000_000n;

  setAlphaArcadeUnstakeAlphaDependenciesForTests({
    resolveState: async () => state,
    getSuggestedParams: async () => suggestedParams(1000),
    buildComposerGroup: () =>
      buildMockUnstakeGroup({
        user: USER,
        appId: ALPHA_ARCADE_STAKING_APP_ID,
        alphaAssetId: ALPHA_ASSET_ID,
        usdcAssetId: USDC_ASSET_ID,
        amount,
        suggestedParams: suggestedParams(1000)
      })
  });

  const registry = new TransactionShapeRegistry();
  registry.register(alphaArcadeUnstakeAlphaShape);
  const quote = await compileExecutableQuote(
    registry,
    alphaArcadeUnstakeAlphaShape.key,
    { userAddress: USER_ADDRESS, amount: amount.toString() },
    buildContext()
  );

  assert.equal(quote.transactions.length, 1);
  assert.equal(quote.transactions[0]?.type, "appl");
});

test("claim shape prefixes USDC opt-in when needed", async () => {
  const state = stakingState({ userOptedIntoUsdc: false });

  setAlphaArcadeClaimRewardsDependenciesForTests({
    resolveState: async () => state,
    getSuggestedParams: async () => suggestedParams(1000),
    buildComposerGroup: () =>
      buildMockClaimGroup({
        user: USER,
        appId: ALPHA_ARCADE_STAKING_APP_ID,
        usdcAssetId: USDC_ASSET_ID,
        includeUsdcOptIn: true,
        suggestedParams: suggestedParams(1000)
      })
  });

  const registry = new TransactionShapeRegistry();
  registry.register(alphaArcadeClaimRewardsShape);
  const quote = await compileExecutableQuote(
    registry,
    alphaArcadeClaimRewardsShape.key,
    { userAddress: USER_ADDRESS },
    buildContext()
  );

  assert.equal(quote.transactions.length, 2);
  assert.equal(quote.transactions[0]?.type, "axfer");
  assert.equal(quote.transactions[1]?.type, "appl");
  assertEncodedGroupIsValid(quote.encodedTransactions);
});
