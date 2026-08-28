import type { FarmStateAndAPR } from "@myth-finance/dualstake-farm-sdk";
import type { DSContractListing } from "@myth-finance/dualstake-ts-sdk";

import type { ConsensusStakingAprEstimate } from "../../../src/services/consensus-staking-apr.js";

export const MYTH_FIXTURE_FETCHED_AT = "2026-07-22T00:00:00.000Z";
export const MYTH_APP_ID = 3028076093n;
export const MYTH_ASA_ID = 885835936n;
export const MYTH_LST_ID = 3028084000n;
export const MYTH_ALGO_USD_PRICE = 0.2;

/** Recorded dualSTAKE listing (memoALGO / MemO). */
export function mythListing(
  overrides: Partial<DSContractListing> = {}
): DSContractListing {
  return {
    round: 1n,
    appId: MYTH_APP_ID,
    rate: 4_171_200_652n,
    algoBalance: 31_214_992_853n,
    asaBalance: 12_978_690_830n,
    staked: 31_115_000_000n,
    lstId: MYTH_LST_ID,
    lstName: "memoALGO",
    asaId: MYTH_ASA_ID,
    asaName: "MembersOnly Token",
    asaUnitName: "MemO",
    asaDecimals: 3,
    needSwap: false,
    incentiveEligible: true,
    isOnline: true,
    upgrading: false,
    userProtestingStake: 0n,
    ...overrides
  };
}

export function mythListingSnapshot(
  overrides: {
    appId?: bigint;
    listing?: Partial<DSContractListing>;
    platformFeeBps?: number;
    noderunnerFeeBps?: number;
  } = {}
) {
  return {
    appId: overrides.appId ?? MYTH_APP_ID,
    listing: mythListing(overrides.listing),
    platformFeeBps: overrides.platformFeeBps ?? 0,
    noderunnerFeeBps: overrides.noderunnerFeeBps ?? 400
  };
}

export function mythActiveFarm(
  overrides: Partial<FarmStateAndAPR> = {}
): FarmStateAndAPR {
  return {
    appId: MYTH_APP_ID,
    appEscrow: "ESCROW",
    farmAprBps: 582n,
    baseAprBps: 477n,
    remainingDurationSec: 3_600n,
    farmAsset: MYTH_ASA_ID,
    ...overrides
  } as FarmStateAndAPR;
}

export function mythConsensusEstimate(
  overrides: Partial<ConsensusStakingAprEstimate> = {}
): ConsensusStakingAprEstimate {
  return {
    apr: 5,
    bonusMicroAlgos: 0n,
    avgFeesCollected: 0n,
    blockRewardMicroAlgos: 0,
    onlineStake: 1n,
    currentRound: 1,
    blocksPerYear: 1,
    sampleSize: 100,
    sourceTimestamp: MYTH_FIXTURE_FETCHED_AT,
    ...overrides
  };
}
