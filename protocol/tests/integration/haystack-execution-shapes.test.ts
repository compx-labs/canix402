import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import {
  InvalidShapeInputError,
  ShapeStateError,
  TransactionShapeRegistry,
  compileExecutableQuote,
  createExecutionRegistry,
  serializeTransaction
} from "../../src/execution/index.js";
import type { ShapeBuildContext } from "../../src/execution/index.js";
import {
  HAYSTACK_STAKING_APP_ID,
  HAY_ASSET_ID,
  STAKER_BOX_MBR_MICROALGOS,
  USDC_ASSET_ID,
  buildMockClaimGroup,
  buildMockStakeGroup,
  buildMockUnstakeGroup,
  createStakerBoxName,
  haystackClaimRewardsShape,
  haystackStakeHayShape,
  haystackUnstakeHayShape,
  setHaystackClaimRewardsDependenciesForTests,
  setHaystackStakeHayDependenciesForTests,
  setHaystackStakingStateDependenciesForTests,
  setHaystackUnstakeHayDependenciesForTests,
  type HaystackStakingState
} from "../../src/execution/shapes/haystack/index.js";

const USER = algosdk.generateAccount();
const USER_ADDRESS = USER.addr.toString();
const APP_ADDRESS = algosdk.getApplicationAddress(HAYSTACK_STAKING_APP_ID).toString();
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
    now: () => Date.UTC(2026, 6, 16, 10, 0, 0),
    quoteTtlMs: 30_000
  };
}

function assertEncodedGroupIsValid(encodedTransactions: readonly string[]): void {
  const transactions = encodedTransactions.map((encoded) =>
    algosdk.decodeUnsignedTransaction(Buffer.from(encoded, "base64"))
  );
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

function stakingState(overrides: Partial<HaystackStakingState> = {}): HaystackStakingState {
  const hasBox = overrides.staker?.hasBox ?? true;
  return {
    network: "mainnet",
    appId: HAYSTACK_STAKING_APP_ID,
    appAddress: APP_ADDRESS,
    hayAssetId: HAY_ASSET_ID,
    usdcAssetId: USDC_ASSET_ID,
    oracleAppId: 3_016_268_320,
    paused: false,
    staker: overrides.staker ?? { hasBox, stake: hasBox ? 5_000_000n : 0n, pendingRewardsUsdc: 0n, pendingRewardsHay: 0n },
    userHayBalance: overrides.userHayBalance ?? 10_000_000n,
    userOptedIntoUsdc: overrides.userOptedIntoUsdc ?? true,
    stakerBoxName: createStakerBoxName(USER_ADDRESS),
    mbrMicroAlgos:
      overrides.mbrMicroAlgos ??
      ((overrides.staker?.hasBox ?? hasBox) ? 0n : STAKER_BOX_MBR_MICROALGOS)
  };
}

test("stake shape compiles a 3-txn group for a first-time staker", async () => {
  const state = stakingState({ staker: { hasBox: false, stake: 0n, pendingRewardsUsdc: 0n, pendingRewardsHay: 0n } });
  const amount = 1_000_000n;

  setHaystackStakeHayDependenciesForTests({
    resolveState: async () => state,
    getSuggestedParams: async () => suggestedParams(1000),
    finalizeComposerGroup: async () =>
      buildMockStakeGroup({
        user: USER,
        appId: HAYSTACK_STAKING_APP_ID,
        appAddress: APP_ADDRESS,
        hayAssetId: HAY_ASSET_ID,
        usdcAssetId: USDC_ASSET_ID,
        amount,
        mbrAmount: STAKER_BOX_MBR_MICROALGOS,
        stakerBoxName: createStakerBoxName(USER_ADDRESS),
        suggestedParams: suggestedParams(1000)
      })
  });

  const registry = new TransactionShapeRegistry();
  registry.register(haystackStakeHayShape);

  const quote = await compileExecutableQuote(
    registry,
    haystackStakeHayShape.key,
    { userAddress: USER_ADDRESS, amount: amount.toString() },
    buildContext()
  );

  assert.equal(quote.transactions.length, 3);
  assertEncodedGroupIsValid(quote.encodedTransactions);

  setHaystackStakeHayDependenciesForTests(undefined);
});

test("stake shape compiles a 2-txn group (no MBR) for a returning staker", async () => {
  const state = stakingState({ staker: { hasBox: true, stake: 1_000_000n, pendingRewardsUsdc: 0n, pendingRewardsHay: 0n } });
  const amount = 5_000_000n;

  setHaystackStakeHayDependenciesForTests({
    resolveState: async () => state,
    getSuggestedParams: async () => suggestedParams(1000),
    finalizeComposerGroup: async () =>
      buildMockStakeGroup({
        user: USER,
        appId: HAYSTACK_STAKING_APP_ID,
        appAddress: APP_ADDRESS,
        hayAssetId: HAY_ASSET_ID,
        usdcAssetId: USDC_ASSET_ID,
        amount,
        mbrAmount: 0n,
        stakerBoxName: createStakerBoxName(USER_ADDRESS),
        suggestedParams: suggestedParams(1000)
      })
  });

  const registry = new TransactionShapeRegistry();
  registry.register(haystackStakeHayShape);

  const quote = await compileExecutableQuote(
    registry,
    haystackStakeHayShape.key,
    { userAddress: USER_ADDRESS, amount: amount.toString() },
    buildContext()
  );

  assert.equal(quote.transactions.length, 2);
  assertEncodedGroupIsValid(quote.encodedTransactions);

  setHaystackStakeHayDependenciesForTests(undefined);
});

test("stake shape validates MBR payment and stakeHay selector", () => {
  const state = stakingState({ staker: { hasBox: false, stake: 0n, pendingRewardsUsdc: 0n, pendingRewardsHay: 0n } });
  const amount = 250_000_000n;
  const group = buildMockStakeGroup({
    user: USER,
    appId: HAYSTACK_STAKING_APP_ID,
    appAddress: APP_ADDRESS,
    hayAssetId: HAY_ASSET_ID,
    usdcAssetId: USDC_ASSET_ID,
    amount,
    mbrAmount: STAKER_BOX_MBR_MICROALGOS,
    stakerBoxName: createStakerBoxName(USER_ADDRESS),
    suggestedParams: suggestedParams(1000)
  }).map((txn) => serializeTransaction(txn));

  const input = haystackStakeHayShape.parseInput({
    userAddress: USER_ADDRESS,
    amount: amount.toString()
  });
  assert.equal(haystackStakeHayShape.validate(group, input, state).valid, true);

  const wrongMbrGroup = [...group];
  wrongMbrGroup[0] = {
    ...wrongMbrGroup[0]!,
    payment: { receiver: APP_ADDRESS, amount: "0" }
  };
  assert.equal(haystackStakeHayShape.validate(wrongMbrGroup, input, state).valid, false);
});

test("stake shape rejects amount above user HAY balance", async () => {
  const state = stakingState({
    staker: { hasBox: true, stake: 1_000_000n, pendingRewardsUsdc: 0n, pendingRewardsHay: 0n },
    userHayBalance: 100n
  });

  setHaystackStakeHayDependenciesForTests({
    resolveState: async () => state,
    getSuggestedParams: async () => suggestedParams(1000),
    finalizeComposerGroup: async () => {
      throw new Error("finalize should not be called when balance is insufficient");
    }
  });

  const registry = new TransactionShapeRegistry();
  registry.register(haystackStakeHayShape);

  await assert.rejects(
    () =>
      compileExecutableQuote(
        registry,
        haystackStakeHayShape.key,
        { userAddress: USER_ADDRESS, amount: "500" },
        buildContext()
      ),
    (error: unknown) => {
      assert.ok(error instanceof InvalidShapeInputError);
      assert.match(error.message, /Insufficient HAY balance/);
      assert.deepEqual(error.details, {
        have: "100",
        need: "500",
        assetId: HAY_ASSET_ID
      });
      return true;
    }
  );

  setHaystackStakeHayDependenciesForTests(undefined);
});

test("unstake shape rejects amount above staked balance at resolveState", async () => {
  setHaystackStakingStateDependenciesForTests({
    getGlobalState: async () => ({
      hayAssetId: HAY_ASSET_ID,
      usdcAssetId: USDC_ASSET_ID,
      oracleAppId: 3_016_268_320,
      paused: false
    }),
    getStakerBoxRecord: async () => ({ hasBox: true, stake: 100n, pendingRewardsUsdc: 0n, pendingRewardsHay: 0n }),
    getAccountAssetBalance: async () => 1_000_000n,
    isAssetOptedIn: async () => true,
    getApplicationAddress: () => APP_ADDRESS
  });

  await assert.rejects(
    () =>
      haystackUnstakeHayShape.resolveState(buildContext(), {
        userAddress: USER_ADDRESS,
        amount: 500n
      }),
    ShapeStateError
  );

  setHaystackStakingStateDependenciesForTests(undefined);
});

test("unstake shape validates unstakeHayAndClaim app call", () => {
  const state = stakingState({
    staker: { hasBox: true, stake: 5_000_000n, pendingRewardsUsdc: 0n, pendingRewardsHay: 0n },
    userOptedIntoUsdc: true
  });
  const group = buildMockUnstakeGroup({
    user: USER,
    appId: HAYSTACK_STAKING_APP_ID,
    hayAssetId: HAY_ASSET_ID,
    usdcAssetId: USDC_ASSET_ID,
    amount: 100_000n,
    stakerBoxName: createStakerBoxName(USER_ADDRESS),
    suggestedParams: suggestedParams(1000)
  }).map((txn) => serializeTransaction(txn));

  const input = haystackUnstakeHayShape.parseInput({
    userAddress: USER_ADDRESS,
    amount: "100000"
  });
  assert.equal(haystackUnstakeHayShape.validate(group, input, state).valid, true);
});

test("unstake shape validates optional USDC opt-in before unstakeHayAndClaim", () => {
  const state = stakingState({
    staker: { hasBox: true, stake: 5_000_000n, pendingRewardsUsdc: 0n, pendingRewardsHay: 0n },
    userOptedIntoUsdc: false
  });
  const group = buildMockUnstakeGroup({
    user: USER,
    appId: HAYSTACK_STAKING_APP_ID,
    hayAssetId: HAY_ASSET_ID,
    usdcAssetId: USDC_ASSET_ID,
    amount: 100_000n,
    stakerBoxName: createStakerBoxName(USER_ADDRESS),
    includeUsdcOptIn: true,
    suggestedParams: suggestedParams(1000)
  }).map((txn) => serializeTransaction(txn));

  const input = haystackUnstakeHayShape.parseInput({
    userAddress: USER_ADDRESS,
    amount: "100000"
  });
  assert.equal(haystackUnstakeHayShape.validate(group, input, state).valid, true);
  assert.equal(group.length, 2);
});

test("claim shape validates optional USDC opt-in placement", () => {
  const optInState = stakingState({ userOptedIntoUsdc: false });
  const optInGroup = buildMockClaimGroup({
    user: USER,
    appId: HAYSTACK_STAKING_APP_ID,
    usdcAssetId: USDC_ASSET_ID,
    hayAssetId: HAY_ASSET_ID,
    stakerBoxName: createStakerBoxName(USER_ADDRESS),
    includeUsdcOptIn: true,
    suggestedParams: suggestedParams(1000)
  }).map((txn) => serializeTransaction(txn));

  const input = haystackClaimRewardsShape.parseInput({ userAddress: USER_ADDRESS });
  assert.equal(haystackClaimRewardsShape.validate(optInGroup, input, optInState).valid, true);

  const optedInState = stakingState({ userOptedIntoUsdc: true });
  const claimGroup = buildMockClaimGroup({
    user: USER,
    appId: HAYSTACK_STAKING_APP_ID,
    usdcAssetId: USDC_ASSET_ID,
    hayAssetId: HAY_ASSET_ID,
    stakerBoxName: createStakerBoxName(USER_ADDRESS),
    includeUsdcOptIn: false,
    suggestedParams: suggestedParams(1000)
  }).map((txn) => serializeTransaction(txn));

  assert.equal(haystackClaimRewardsShape.validate(claimGroup, input, optedInState).valid, true);
});

test("claim shape compiles via mocked finalize (opted-in user)", async () => {
  const state = stakingState({ userOptedIntoUsdc: true });

  setHaystackClaimRewardsDependenciesForTests({
    resolveState: async () => state,
    getSuggestedParams: async () => suggestedParams(1000),
    finalizeComposerGroup: async () =>
      buildMockClaimGroup({
        user: USER,
        appId: HAYSTACK_STAKING_APP_ID,
        usdcAssetId: USDC_ASSET_ID,
        hayAssetId: HAY_ASSET_ID,
        stakerBoxName: createStakerBoxName(USER_ADDRESS),
        includeUsdcOptIn: false,
        suggestedParams: suggestedParams(1000)
      })
  });

  const registry = new TransactionShapeRegistry();
  registry.register(haystackClaimRewardsShape);

  const quote = await compileExecutableQuote(
    registry,
    haystackClaimRewardsShape.key,
    { userAddress: USER_ADDRESS },
    buildContext()
  );

  assert.equal(quote.transactions.length, 1);
  assertEncodedGroupIsValid(quote.encodedTransactions);

  setHaystackClaimRewardsDependenciesForTests(undefined);
});

test("ungrouped stake transactions fail validation", () => {
  const state = stakingState({ staker: { hasBox: false, stake: 0n, pendingRewardsUsdc: 0n, pendingRewardsHay: 0n } });
  const amount = 100_000n;
  const group = buildMockStakeGroup({
    user: USER,
    appId: HAYSTACK_STAKING_APP_ID,
    appAddress: APP_ADDRESS,
    hayAssetId: HAY_ASSET_ID,
    usdcAssetId: USDC_ASSET_ID,
    amount,
    mbrAmount: STAKER_BOX_MBR_MICROALGOS,
    stakerBoxName: createStakerBoxName(USER_ADDRESS),
    suggestedParams: suggestedParams(1000)
  }).map((txn) => serializeTransaction(txn));
  const ungrouped = group.map((txn) => ({ ...txn, groupPresent: false }));
  const input = haystackStakeHayShape.parseInput({
    userAddress: USER_ADDRESS,
    amount: amount.toString()
  });
  assert.equal(haystackStakeHayShape.validate(ungrouped, input, state).valid, false);
});

test("createExecutionRegistry includes all Haystack staking shapes", () => {
  const registry = createExecutionRegistry();
  assert.equal(registry.has("mainnet:haystack:v1:stake:hay"), true);
  assert.equal(registry.has("mainnet:haystack:v1:unstake:hay"), true);
  assert.equal(registry.has("mainnet:haystack:v1:claim:rewards"), true);
});
