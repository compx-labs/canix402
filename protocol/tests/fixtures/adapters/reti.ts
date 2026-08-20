import type { RetiValidatorSnapshot } from "../../../src/adapters/index.js";
import type {
  RetiPoolInfo,
  RetiValidatorConfig,
  RetiValidatorState
} from "../../../src/reti/abi.js";
import {
  RETI_GATING_TYPE_NONE,
  RETI_SIMULATE_SENDER,
  RETI_ZERO_ADDRESS
} from "../../../src/reti/constants.js";
import type { ConsensusStakingAprEstimate } from "../../../src/services/consensus-staking-apr.js";

export const RETI_FIXTURE_FETCHED_AT = "2026-07-23T00:00:00.000Z";
export const RETI_ALGO_USD_PRICE = 0.2;
export const RETI_CREATOR_ADDRESS = RETI_SIMULATE_SENDER;

export function retiValidatorConfig(
  overrides: Partial<RetiValidatorConfig> = {}
): RetiValidatorConfig {
  return {
    id: 1n,
    owner: RETI_ZERO_ADDRESS,
    manager: RETI_ZERO_ADDRESS,
    nfdForInfo: 0n,
    entryGatingType: RETI_GATING_TYPE_NONE,
    entryGatingAddress: RETI_ZERO_ADDRESS,
    entryGatingAssets: [0n, 0n, 0n, 0n],
    gatingAssetMinBalance: 0n,
    rewardTokenId: 0n,
    rewardPerPayout: 0n,
    epochRoundLength: 1000,
    percentToValidator: 50_000, // 5%
    validatorCommissionAddress: RETI_ZERO_ADDRESS,
    minEntryStake: 1_000_000_000n, // 1000 ALGO
    maxAlgoPerPool: 70_000_000_000_000n,
    poolsPerNode: 3,
    sunsettingOn: 0n,
    sunsettingTo: 0n,
    ...overrides
  };
}

export function retiValidatorState(
  overrides: Partial<RetiValidatorState> = {}
): RetiValidatorState {
  return {
    numPools: 1,
    totalStakers: 5n,
    totalAlgoStaked: 2_000_000_000n,
    rewardTokenHeldBack: 0n,
    ...overrides
  };
}

export function retiPool(
  overrides: Partial<RetiPoolInfo> = {}
): RetiPoolInfo {
  return {
    poolAppId: 99n,
    totalStakers: 5,
    totalAlgoStaked: 2_000_000_000n,
    ...overrides
  };
}

export function retiValidatorSnapshot(
  overrides: Partial<RetiValidatorSnapshot> = {}
): RetiValidatorSnapshot {
  return {
    validatorId: 7,
    config: retiValidatorConfig({ percentToValidator: 100_000 }),
    state: retiValidatorState(),
    pools: [retiPool()],
    maxStakePerPool: 70_000_000_000_000n,
    currentRound: 1n,
    ...overrides
  };
}

export function retiConsensusEstimate(
  overrides: Partial<ConsensusStakingAprEstimate> = {}
): ConsensusStakingAprEstimate {
  return {
    apr: 10,
    bonusMicroAlgos: 0n,
    avgFeesCollected: 0n,
    blockRewardMicroAlgos: 0,
    onlineStake: 1n,
    currentRound: 1,
    blocksPerYear: 1,
    sampleSize: 32,
    sourceTimestamp: RETI_FIXTURE_FETCHED_AT,
    ...overrides
  };
}
