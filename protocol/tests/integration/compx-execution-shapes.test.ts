import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";
import type { MarketData, StakingPoolState } from "@compx/sdk";

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
  STAKER_BOX_MBR_MICROALGOS,
  buildMockClaimGroup,
  buildMockDepositGroup,
  buildMockStakeGroup,
  buildMockUnstakeGroup,
  buildMockWithdrawGroup,
  compxClaimRewardsShape,
  compxDepositAsaShape,
  compxStakeAsaShape,
  compxUnstakeAsaShape,
  compxWithdrawAsaShape,
  createStakerBoxName,
  setCompXClaimRewardsDependenciesForTests,
  setCompXDepositAsaDependenciesForTests,
  setCompXStakingPoolStateDependenciesForTests,
  setCompXLendingMarketStateDependenciesForTests,
  setCompXStakeAsaDependenciesForTests,
  setCompXUnstakeAsaDependenciesForTests,
  setCompXWithdrawAsaDependenciesForTests,
  type CompXLendingMarketState,
  type CompXStakingPoolState
} from "../../src/execution/shapes/compx/index.js";

const USER = algosdk.generateAccount();
const MARKET_APP = algosdk.generateAccount();
const POOL_APP = algosdk.generateAccount();
const USER_ADDRESS = USER.addr.toString();
const MARKET_APP_ADDRESS = MARKET_APP.addr.toString();
const POOL_APP_ADDRESS = POOL_APP.addr.toString();
const MARKET_APP_ID = 3491050310;
const POOL_APP_ID = 3500000001;
const USDC_ID = 31566704;
const LST_ID = 3491050538;
const STAKED_ID = 1058926737;
const REWARD_ID = 793124631;
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
    now: () => Date.UTC(2026, 6, 13, 10, 0, 0),
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

function marketData(): MarketData {
  return {
    appId: MARKET_APP_ID,
    baseTokenId: USDC_ID,
    lstTokenId: LST_ID,
    oracleAppId: 3307588794,
    buyoutTokenId: USDC_ID,
    supplyApy: 4.5,
    borrowApy: 6.2,
    utilizationRate: 35,
    totalDeposits: 1_000_000,
    totalBorrows: 350_000,
    availableToBorrow: 650_000,
    circulatingLST: 900_000,
    baseTokenPrice: 1,
    totalDepositsUSD: 1_000_000,
    totalBorrowsUSD: 350_000,
    availableToBorrowUSD: 650_000,
    ltv: 5000,
    liquidationThreshold: 5500,
    liqBonusBps: 500,
    originationFeeBps: 150,
    baseTokenDecimals: 6,
    lstTokenDecimals: 6,
    rateModel: {
      baseBps: 100,
      utilCapBps: 8000,
      kinkNormBps: 8000,
      slope1Bps: 600,
      slope2Bps: 1200,
      maxAprBps: 10000,
      rateModelType: 0
    },
    contractState: 1,
    protocolShareBps: 1000,
    borrowIndexWad: 1003201766370n,
    lastUpdateTimestamp: 1_783_450_230
  };
}

function lendingMarketState(overrides?: Partial<CompXLendingMarketState>): CompXLendingMarketState {
  return {
    network: "mainnet",
    marketAppId: MARKET_APP_ID,
    marketAppAddress: MARKET_APP_ADDRESS,
    baseTokenId: USDC_ID,
    lstTokenId: LST_ID,
    contractState: 1,
    market: marketData(),
    userBaseBalance: 5_000_000n,
    userLstBalance: 1_000_000n,
    userOptedIntoBase: true,
    userOptedIntoLst: true,
    ...overrides
  };
}

function stakingPoolData(): StakingPoolState {
  return {
    appId: POOL_APP_ID,
    stakedAssetId: STAKED_ID,
    rewardAssetId: REWARD_ID,
    totalStaked: 10_000_000n,
    rewardsRemaining: 1_000_000n,
    contractState: 1,
    initialized: true,
    rewardsFunded: true,
    endTime: 1_900_000_000,
    lastUpdateTime: 1_783_450_230
  };
}

function stakingPoolState(overrides?: Partial<CompXStakingPoolState>): CompXStakingPoolState {
  return {
    network: "mainnet",
    poolAppId: POOL_APP_ID,
    poolAppAddress: POOL_APP_ADDRESS,
    stakedAssetId: STAKED_ID,
    rewardAssetId: REWARD_ID,
    contractState: 1,
    initialized: true,
    rewardsFunded: true,
    endTime: 1_900_000_000,
    pool: stakingPoolData(),
    staker: { stake: 2_000_000n, rewardDebt: 0n, hasBox: true },
    userStakedBalance: 5_000_000n,
    userOptedIntoRewardAsset: true,
    stakerBoxName: createStakerBoxName(USER_ADDRESS),
    ...overrides
  };
}

test.afterEach(() => {
  setCompXLendingMarketStateDependenciesForTests(undefined);
  setCompXStakingPoolStateDependenciesForTests(undefined);
  setCompXDepositAsaDependenciesForTests(undefined);
  setCompXWithdrawAsaDependenciesForTests(undefined);
  setCompXStakeAsaDependenciesForTests(undefined);
  setCompXUnstakeAsaDependenciesForTests(undefined);
  setCompXClaimRewardsDependenciesForTests(undefined);
});

test("deposit shape rejects invalid input", () => {
  assert.throws(
    () =>
      compxDepositAsaShape.parseInput({
        userAddress: USER_ADDRESS,
        amount: "1000"
      }),
    InvalidShapeInputError
  );
});

test("deposit shape builds and validates 2-txn group without LST opt-in", async () => {
  const state = lendingMarketState();
  const amount = 100_000n;
  const group = buildMockDepositGroup({
    user: USER,
    marketAppId: MARKET_APP_ID,
    marketAppAddress: MARKET_APP_ADDRESS,
    baseTokenId: USDC_ID,
    lstTokenId: LST_ID,
    amount,
    includeLstOptIn: false,
    suggestedParams: suggestedParams(1000)
  });

  setCompXDepositAsaDependenciesForTests({
    resolveMarketState: async () => state,
    buildDepositTransactions: async () => ({
      transactions: group,
      signers: [{ address: USER_ADDRESS, transactionIndexes: [0, 1] }],
      metadata: { action: "deposit", optInsIncluded: [] }
    })
  });

  const registry = new TransactionShapeRegistry();
  registry.register(compxDepositAsaShape);
  const quote = await compileExecutableQuote(
    registry,
    compxDepositAsaShape.key,
    {
      userAddress: USER_ADDRESS,
      marketAppId: MARKET_APP_ID,
      amount: amount.toString()
    },
    buildContext()
  );

  assert.equal(quote.transactions.length, 2);
  assertEncodedGroupIsValid(quote.encodedTransactions);
  const input = compxDepositAsaShape.parseInput({
    userAddress: USER_ADDRESS,
    marketAppId: MARKET_APP_ID,
    amount: amount.toString()
  });
  const validation = compxDepositAsaShape.validate(
    quote.transactions,
    input,
    state
  );
  assert.equal(validation.valid, true);
});

test("deposit shape validates optional LST opt-in ordering", () => {
  const state = lendingMarketState({ userOptedIntoLst: false });
  const amount = 100_000n;
  const group = buildMockDepositGroup({
    user: USER,
    marketAppId: MARKET_APP_ID,
    marketAppAddress: MARKET_APP_ADDRESS,
    baseTokenId: USDC_ID,
    lstTokenId: LST_ID,
    amount,
    includeLstOptIn: true,
    suggestedParams: suggestedParams(1000)
  }).map((txn) => serializeTransaction(txn));

  const input = compxDepositAsaShape.parseInput({
    userAddress: USER_ADDRESS,
    marketAppId: MARKET_APP_ID,
    amount: amount.toString()
  });
  const validation = compxDepositAsaShape.validate(group, input, state);
  assert.equal(validation.valid, true);

  const malformed = [...group];
  malformed[0] = group[1]!;
  malformed[1] = group[0]!;
  const swapped = compxDepositAsaShape.validate(malformed, input, state);
  assert.equal(swapped.valid, false);
});

test("withdraw shape validates LST-denominated transfer and low fee failures", () => {
  const state = lendingMarketState();
  const amount = 50_000n;
  const validGroup = buildMockWithdrawGroup({
    user: USER,
    marketAppId: MARKET_APP_ID,
    marketAppAddress: MARKET_APP_ADDRESS,
    baseTokenId: USDC_ID,
    lstTokenId: LST_ID,
    amount,
    includeBaseOptIn: false,
    suggestedParams: suggestedParams(1000)
  }).map((txn) => serializeTransaction(txn));

  const input = compxWithdrawAsaShape.parseInput({
    userAddress: USER_ADDRESS,
    marketAppId: MARKET_APP_ID,
    amount: amount.toString()
  });
  assert.equal(compxWithdrawAsaShape.validate(validGroup, input, state).valid, true);

  const lowFeeGroup = [...validGroup];
  const appTxn = { ...lowFeeGroup[1]!, fee: "1000" };
  lowFeeGroup[1] = appTxn;
  const lowFee = compxWithdrawAsaShape.validate(lowFeeGroup, input, state);
  assert.equal(lowFee.valid, false);
  assert.ok(lowFee.errors.some((error) => error.includes("fee")));
});

test("stake shape compileExecutableQuote builds 3-txn group with mocked finalize", async () => {
  const state = stakingPoolState({ staker: { stake: 0n, rewardDebt: 0n, hasBox: false } });
  const amount = 100_000n;

  setCompXStakeAsaDependenciesForTests({
    resolvePoolState: async () => state,
    getSuggestedParams: async () => suggestedParams(1000),
    finalizeComposerGroup: async () =>
      buildMockStakeGroup({
        user: USER,
        poolAppId: POOL_APP_ID,
        poolAppAddress: POOL_APP_ADDRESS,
        stakedAssetId: STAKED_ID,
        rewardAssetId: REWARD_ID,
        amount,
        mbrAmount: STAKER_BOX_MBR_MICROALGOS,
        stakerBoxName: createStakerBoxName(USER_ADDRESS),
        suggestedParams: suggestedParams(1000)
      })
  });

  const registry = new TransactionShapeRegistry();
  registry.register(compxStakeAsaShape);

  const quote = await compileExecutableQuote(
    registry,
    compxStakeAsaShape.key,
    {
      userAddress: USER_ADDRESS,
      poolAppId: POOL_APP_ID,
      amount: amount.toString()
    },
    buildContext()
  );

  assert.equal(quote.transactions.length, 3);
  assertEncodedGroupIsValid(quote.encodedTransactions);
});

test("stake shape validates staker box MBR and ARC-4 selector", () => {
  const newStakerState = stakingPoolState({
    staker: { stake: 0n, rewardDebt: 0n, hasBox: false }
  });
  const amount = 250_000n;
  const group = buildMockStakeGroup({
    user: USER,
    poolAppId: POOL_APP_ID,
    poolAppAddress: POOL_APP_ADDRESS,
    stakedAssetId: STAKED_ID,
    rewardAssetId: REWARD_ID,
    amount,
    mbrAmount: STAKER_BOX_MBR_MICROALGOS,
    stakerBoxName: createStakerBoxName(USER_ADDRESS),
    suggestedParams: suggestedParams(1000)
  }).map((txn) => serializeTransaction(txn));

  const input = compxStakeAsaShape.parseInput({
    userAddress: USER_ADDRESS,
    poolAppId: POOL_APP_ID,
    amount: amount.toString()
  });
  const validation = compxStakeAsaShape.validate(group, input, newStakerState);
  assert.equal(validation.valid, true);

  const zeroMbrGroup = [...group];
  zeroMbrGroup[1] = {
    ...zeroMbrGroup[1]!,
    payment: { receiver: POOL_APP_ADDRESS, amount: "0" }
  };
  assert.equal(
    compxStakeAsaShape.validate(zeroMbrGroup, input, newStakerState).valid,
    false
  );
});

test("unstake shape rejects amount above staker balance at resolveState", async () => {
  setCompXStakingPoolStateDependenciesForTests({
    createStakingClient: () =>
      ({
        getPool: async () => stakingPoolData(),
        getStakerInfo: async () => ({ stake: 100n, rewardDebt: 0n })
      }) as never,
    getAccountAssetBalance: async () => 1_000_000n,
    isAssetOptedIn: async () => true,
    getApplicationAddress: () => POOL_APP_ADDRESS,
    nowSeconds: () => 1_800_000_000
  });

  await assert.rejects(
    () =>
      compxUnstakeAsaShape.resolveState(buildContext(), {
        userAddress: USER_ADDRESS,
        poolAppId: POOL_APP_ID,
        amount: 500n
      }),
    ShapeStateError
  );
});

test("unstake and claim shapes validate optional reward opt-in placement", () => {
  const unstakeState = stakingPoolState({ userOptedIntoRewardAsset: false });
  const unstakeGroup = buildMockUnstakeGroup({
    user: USER,
    poolAppId: POOL_APP_ID,
    stakedAssetId: STAKED_ID,
    rewardAssetId: REWARD_ID,
    amount: 100_000n,
    stakerBoxName: createStakerBoxName(USER_ADDRESS),
    includeRewardOptIn: true,
    suggestedParams: suggestedParams(1000)
  }).map((txn) => serializeTransaction(txn));

  const unstakeInput = compxUnstakeAsaShape.parseInput({
    userAddress: USER_ADDRESS,
    poolAppId: POOL_APP_ID,
    amount: "100000"
  });
  assert.equal(
    compxUnstakeAsaShape.validate(unstakeGroup, unstakeInput, unstakeState).valid,
    true
  );

  const claimState = stakingPoolState({ userOptedIntoRewardAsset: false });
  const claimGroup = buildMockClaimGroup({
    user: USER,
    poolAppId: POOL_APP_ID,
    rewardAssetId: REWARD_ID,
    stakerBoxName: createStakerBoxName(USER_ADDRESS),
    includeRewardOptIn: true,
    suggestedParams: suggestedParams(1000)
  }).map((txn) => serializeTransaction(txn));

  const claimInput = compxClaimRewardsShape.parseInput({
    userAddress: USER_ADDRESS,
    poolAppId: POOL_APP_ID
  });
  assert.equal(
    compxClaimRewardsShape.validate(claimGroup, claimInput, claimState).valid,
    true
  );
});

test("ungrouped transactions fail validation", () => {
  const state = lendingMarketState();
  const group = buildMockDepositGroup({
    user: USER,
    marketAppId: MARKET_APP_ID,
    marketAppAddress: MARKET_APP_ADDRESS,
    baseTokenId: USDC_ID,
    lstTokenId: LST_ID,
    amount: 1000n,
    includeLstOptIn: false,
    suggestedParams: suggestedParams(1000)
  }).map((txn) => serializeTransaction(txn));
  const ungrouped = group.map((txn) => ({ ...txn, groupPresent: false }));
  const input = compxDepositAsaShape.parseInput({
    userAddress: USER_ADDRESS,
    marketAppId: MARKET_APP_ID,
    amount: "1000"
  });
  const validation = compxDepositAsaShape.validate(ungrouped, input, state);
  assert.equal(validation.valid, false);
});

test("createExecutionRegistry includes all CompX shapes", () => {
  const registry = createExecutionRegistry();
  assert.equal(registry.has("mainnet:compx:v1:deposit:asa"), true);
  assert.equal(registry.has("mainnet:compx:v1:withdraw:asa"), true);
  assert.equal(registry.has("mainnet:compx:v1:stake:asa"), true);
  assert.equal(registry.has("mainnet:compx:v1:unstake:asa"), true);
  assert.equal(registry.has("mainnet:compx:v1:claim:rewards"), true);
});
