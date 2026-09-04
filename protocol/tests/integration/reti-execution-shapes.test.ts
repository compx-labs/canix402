import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import {
  InvalidShapeInputError,
  ShapeStateError,
  TransactionShapeRegistry,
  compileExecutableQuote,
  createExecutionRegistry
} from "../../src/execution/index.js";
import type { ShapeBuildContext } from "../../src/execution/index.js";
import {
  retiStakeAlgoShape,
  retiUnstakeAlgoShape,
  setRetiStakeAlgoDependenciesForTests,
  setRetiUnstakeAlgoDependenciesForTests,
  type RetiStakeState,
  type RetiUnstakeState
} from "../../src/execution/shapes/reti/index.js";
import {
  RETI_GATING_TYPE_ASSET_ID,
  RETI_GATING_TYPE_NONE,
  RETI_VALIDATOR_REGISTRY_APP_ID,
  RETI_ZERO_ADDRESS
} from "../../src/reti/constants.js";
import { ADD_STAKE_METHOD, REMOVE_STAKE_METHOD } from "../../src/reti/abi.js";
import type { RetiValidatorConfig } from "../../src/reti/abi.js";
import {
  assertEncodedGroupIsValid,
  assertGoldenGroup,
  dumpComposerGroup,
  type GoldenGroup
} from "../helpers/golden-group.js";

const USER = algosdk.generateAccount();
const USER_ADDRESS = USER.addr.toString();
const REGISTRY_APP_ID = RETI_VALIDATOR_REGISTRY_APP_ID;
const REGISTRY_ADDRESS = algosdk.getApplicationAddress(REGISTRY_APP_ID).toString();
const POOL_APP_ID = 2_800_000_001;
const VALIDATOR_ID = 7;
const REWARD_ASA_ID = 1_234_567_890;
const GATE_ASA_ID = 2_222_222_222;
const GENESIS_HASH = new Uint8Array(32).fill(23);
const AMOUNT = 2_000_000n;

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
    now: () => Date.UTC(2026, 8, 3, 12, 0, 0),
    quoteTtlMs: 30_000
  };
}

function validatorConfig(overrides: Partial<RetiValidatorConfig> = {}): RetiValidatorConfig {
  return {
    id: BigInt(VALIDATOR_ID),
    owner: USER_ADDRESS,
    manager: USER_ADDRESS,
    nfdForInfo: 0n,
    entryGatingType: RETI_GATING_TYPE_NONE,
    entryGatingAddress: RETI_ZERO_ADDRESS,
    entryGatingAssets: [0n, 0n, 0n, 0n],
    gatingAssetMinBalance: 0n,
    rewardTokenId: 0n,
    rewardPerPayout: 0n,
    epochRoundLength: 320_000,
    percentToValidator: 50_000,
    validatorCommissionAddress: USER_ADDRESS,
    minEntryStake: 1_000_000n,
    maxAlgoPerPool: 10_000_000_000_000n,
    poolsPerNode: 3,
    sunsettingOn: 0n,
    sunsettingTo: 0n,
    ...overrides
  };
}

function stakeState(overrides: Partial<RetiStakeState> = {}): RetiStakeState {
  const config = overrides.config ?? validatorConfig();
  const rewardTokenId = Number(config.rewardTokenId);
  return {
    network: "mainnet",
    registryAppId: REGISTRY_APP_ID,
    validatorId: VALIDATOR_ID,
    registryAddress: REGISTRY_ADDRESS,
    config,
    state: {
      numPools: 1,
      totalStakers: 10n,
      totalAlgoStaked: 50_000_000n,
      rewardTokenHeldBack: 0n
    },
    pools: [
      {
        poolAppId: BigInt(POOL_APP_ID),
        totalStakers: 10,
        totalAlgoStaked: 50_000_000n
      }
    ],
    maxStakePerPool: 10_000_000_000_000n,
    currentRound: 50_000_000n,
    userAlgoBalance: 20_000_000n,
    entryRequirements: {
      minAmount: { assetId: 0, amount: config.minEntryStake.toString() },
      eligibilityFullyCheckable: true
    },
    capacity: {
      stakerSlotsRemaining: 190,
      algoRoomMicroAlgos: "9999950000000000",
      acceptingStake: true
    },
    gateAssetIds:
      config.entryGatingType === RETI_GATING_TYPE_ASSET_ID
        ? config.entryGatingAssets.filter((id) => id > 0n).map((id) => Number(id))
        : [],
    rewardTokenId,
    userOptedIntoRewardToken: rewardTokenId === 0,
    ...overrides
  };
}

function unstakeState(overrides: Partial<RetiUnstakeState> = {}): RetiUnstakeState {
  return {
    validatorId: VALIDATOR_ID,
    poolAppId: POOL_APP_ID,
    stakedBalance: 5_000_000n,
    minEntryStake: 1_000_000n,
    rewardTokenId: 0,
    userOptedIntoRewardToken: true,
    ...overrides
  };
}

function installStakeDeps(state: RetiStakeState): void {
  setRetiStakeAlgoDependenciesForTests({
    resolveState: async () => state,
    getSuggestedParams: async () => suggestedParams(),
    finalizeComposerGroup: async ({ atc }) => dumpComposerGroup(atc)
  });
}

function installUnstakeDeps(state: RetiUnstakeState): void {
  setRetiUnstakeAlgoDependenciesForTests({
    resolveState: async () => state,
    getSuggestedParams: async () => suggestedParams(),
    finalizeComposerGroup: async ({ atc }) => dumpComposerGroup(atc)
  });
}

function applMember(appIndex: number): GoldenGroup["members"][number] {
  return {
    type: "appl",
    fee: "1000",
    appIndex: String(appIndex),
    amount: null,
    assetIndex: null,
    receiver: null
  };
}

function methodSelectorBase64(method: algosdk.ABIMethod): string {
  return Buffer.from(method.getSelector()).toString("base64");
}

test.afterEach(() => {
  setRetiStakeAlgoDependenciesForTests(undefined);
  setRetiUnstakeAlgoDependenciesForTests(undefined);
});

test("Réti stake shape compiles gas×2 + payment + addStake group", async () => {
  installStakeDeps(stakeState());
  const registry = new TransactionShapeRegistry();
  registry.register(retiStakeAlgoShape);

  const quote = await compileExecutableQuote(
    registry,
    retiStakeAlgoShape.key,
    {
      userAddress: USER_ADDRESS,
      validatorId: VALIDATOR_ID,
      amount: AMOUNT.toString()
    },
    buildContext()
  );

  assert.equal(quote.shapeKey, "mainnet:reti:v1:stake:algo");
  assert.equal(quote.transactions.length, 4);
  assertEncodedGroupIsValid(quote.encodedTransactions);
  assertGoldenGroup(quote.transactions, {
    types: ["appl", "appl", "pay", "appl"],
    members: [
      applMember(REGISTRY_APP_ID),
      applMember(REGISTRY_APP_ID),
      {
        type: "pay",
        fee: "1000",
        appIndex: null,
        amount: AMOUNT.toString(),
        assetIndex: null,
        receiver: REGISTRY_ADDRESS
      },
      applMember(REGISTRY_APP_ID)
    ],
    userSignIndexes: [0, 1, 2, 3]
  });
  assert.equal(quote.metadata.registryAppId, REGISTRY_APP_ID);
  assert.equal(quote.metadata.amount, AMOUNT.toString());
  assert.equal(
    quote.transactions[3]?.applicationCall?.appArgsBase64[0],
    methodSelectorBase64(ADD_STAKE_METHOD)
  );
});

test("Réti stake shape prefixes reward ASA opt-in when needed", async () => {
  installStakeDeps(
    stakeState({
      config: validatorConfig({ rewardTokenId: BigInt(REWARD_ASA_ID) }),
      rewardTokenId: REWARD_ASA_ID,
      userOptedIntoRewardToken: false
    })
  );
  const registry = new TransactionShapeRegistry();
  registry.register(retiStakeAlgoShape);

  const quote = await compileExecutableQuote(
    registry,
    retiStakeAlgoShape.key,
    {
      userAddress: USER_ADDRESS,
      validatorId: VALIDATOR_ID,
      amount: AMOUNT.toString()
    },
    buildContext()
  );

  assert.equal(quote.transactions.length, 5);
  assertEncodedGroupIsValid(quote.encodedTransactions);
  assert.equal(quote.transactions[4]?.type, "axfer");
  assert.equal(quote.transactions[4]?.assetTransfer?.assetIndex, String(REWARD_ASA_ID));
  assert.equal(quote.transactions[4]?.assetTransfer?.amount, "0");
  assert.ok(quote.warnings.some((warning) => /reward ASA/i.test(warning)));
});

test("Réti stake shape auto-picks the sole gate ASA as valueToVerify", async () => {
  installStakeDeps(
    stakeState({
      config: validatorConfig({
        entryGatingType: RETI_GATING_TYPE_ASSET_ID,
        entryGatingAssets: [BigInt(GATE_ASA_ID), 0n, 0n, 0n]
      }),
      gateAssetIds: [GATE_ASA_ID]
    })
  );
  const registry = new TransactionShapeRegistry();
  registry.register(retiStakeAlgoShape);

  const quote = await compileExecutableQuote(
    registry,
    retiStakeAlgoShape.key,
    {
      userAddress: USER_ADDRESS,
      validatorId: VALIDATOR_ID,
      amount: AMOUNT.toString()
    },
    buildContext()
  );

  assert.equal(quote.metadata.valueToVerify, String(GATE_ASA_ID));
  assert.equal(quote.transactions.length, 4);
});

test("Réti stake shape rejects amount below minEntryStake", async () => {
  installStakeDeps(stakeState());
  const registry = new TransactionShapeRegistry();
  registry.register(retiStakeAlgoShape);

  await assert.rejects(
    () =>
      compileExecutableQuote(
        registry,
        retiStakeAlgoShape.key,
        {
          userAddress: USER_ADDRESS,
          validatorId: VALIDATOR_ID,
          amount: "1"
        },
        buildContext()
      ),
    ShapeStateError
  );
});

test("Réti stake shape rejects invalid input", () => {
  assert.throws(
    () =>
      retiStakeAlgoShape.parseInput({
        userAddress: USER_ADDRESS,
        amount: "1000000"
      }),
    InvalidShapeInputError
  );
});

test("Réti unstake shape compiles gas×2 + removeStake group", async () => {
  installUnstakeDeps(unstakeState());
  const registry = new TransactionShapeRegistry();
  registry.register(retiUnstakeAlgoShape);

  const quote = await compileExecutableQuote(
    registry,
    retiUnstakeAlgoShape.key,
    {
      userAddress: USER_ADDRESS,
      validatorId: VALIDATOR_ID,
      poolAppId: POOL_APP_ID,
      amount: AMOUNT.toString()
    },
    buildContext()
  );

  assert.equal(quote.shapeKey, "mainnet:reti:v1:unstake:algo");
  assert.equal(quote.transactions.length, 3);
  assertEncodedGroupIsValid(quote.encodedTransactions);
  assertGoldenGroup(quote.transactions, {
    types: ["appl", "appl", "appl"],
    members: [applMember(POOL_APP_ID), applMember(POOL_APP_ID), applMember(POOL_APP_ID)],
    userSignIndexes: [0, 1, 2]
  });
  assert.equal(
    quote.transactions[2]?.applicationCall?.appArgsBase64[0],
    methodSelectorBase64(REMOVE_STAKE_METHOD)
  );
  assert.equal(quote.metadata.amount, AMOUNT.toString());
});

test("Réti unstake shape prefixes reward ASA opt-in when needed", async () => {
  installUnstakeDeps(
    unstakeState({
      rewardTokenId: REWARD_ASA_ID,
      userOptedIntoRewardToken: false
    })
  );
  const registry = new TransactionShapeRegistry();
  registry.register(retiUnstakeAlgoShape);

  const quote = await compileExecutableQuote(
    registry,
    retiUnstakeAlgoShape.key,
    {
      userAddress: USER_ADDRESS,
      validatorId: VALIDATOR_ID,
      poolAppId: POOL_APP_ID,
      amount: AMOUNT.toString()
    },
    buildContext()
  );

  assert.equal(quote.transactions.length, 4);
  assert.equal(quote.transactions[3]?.type, "axfer");
  assert.equal(quote.transactions[3]?.assetTransfer?.assetIndex, String(REWARD_ASA_ID));
  assert.equal(quote.transactions[3]?.assetTransfer?.amount, "0");
});

test("Réti unstake shape rejects amount above staked balance", async () => {
  installUnstakeDeps(unstakeState({ stakedBalance: 1_000_000n }));
  const registry = new TransactionShapeRegistry();
  registry.register(retiUnstakeAlgoShape);

  await assert.rejects(
    () =>
      compileExecutableQuote(
        registry,
        retiUnstakeAlgoShape.key,
        {
          userAddress: USER_ADDRESS,
          validatorId: VALIDATOR_ID,
          poolAppId: POOL_APP_ID,
          amount: "2000000"
        },
        buildContext()
      ),
    ShapeStateError
  );
});

test("Réti unstake shape rejects partial unstake below minEntryStake", async () => {
  installUnstakeDeps(unstakeState({ stakedBalance: 2_000_000n, minEntryStake: 1_500_000n }));
  const registry = new TransactionShapeRegistry();
  registry.register(retiUnstakeAlgoShape);

  await assert.rejects(
    () =>
      compileExecutableQuote(
        registry,
        retiUnstakeAlgoShape.key,
        {
          userAddress: USER_ADDRESS,
          validatorId: VALIDATOR_ID,
          poolAppId: POOL_APP_ID,
          amount: "1000000"
        },
        buildContext()
      ),
    (error: unknown) => error instanceof ShapeStateError && /minEntryStake/i.test(error.message)
  );
});

test("createExecutionRegistry includes Réti stake and unstake shapes", () => {
  const registry = createExecutionRegistry();
  assert.equal(registry.has("mainnet:reti:v1:stake:algo"), true);
  assert.equal(registry.has("mainnet:reti:v1:unstake:algo"), true);
});
