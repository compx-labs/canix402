import type { TransactionShapeSpec } from "../../types.js";
import { haystackBuyBondingShape } from "./buy-bonding.js";
import { haystackClaimRewardsShape } from "./claim-rewards.js";
import { haystackLaunchTokenShape } from "./launch-token.js";
import { haystackStakeHayShape } from "./stake-hay.js";
import { haystackUnstakeHayShape } from "./unstake-hay.js";

export {
  haystackStakeHayShape,
  setHaystackStakeHayDependenciesForTests,
  buildMockStakeGroup
} from "./stake-hay.js";
export type { HaystackStakeHayInput, HaystackStakeHayDependencies } from "./stake-hay.js";

export {
  haystackUnstakeHayShape,
  setHaystackUnstakeHayDependenciesForTests,
  buildMockUnstakeGroup
} from "./unstake-hay.js";
export type { HaystackUnstakeHayInput, HaystackUnstakeHayDependencies } from "./unstake-hay.js";

export {
  haystackClaimRewardsShape,
  setHaystackClaimRewardsDependenciesForTests,
  buildMockClaimGroup
} from "./claim-rewards.js";
export type {
  HaystackClaimRewardsInput,
  HaystackClaimRewardsDependencies
} from "./claim-rewards.js";

export {
  resolveHaystackStakingState,
  setHaystackStakingStateDependenciesForTests
} from "./staking-state.js";
export type {
  HaystackStakingState,
  HaystackStakingGlobalState,
  HaystackStakingStateDependencies
} from "./staking-state.js";

export {
  STAKE_HAY_METHOD_SELECTOR_HEX,
  UNSTAKE_HAY_AND_CLAIM_METHOD_SELECTOR_HEX,
  CLAIM_METHOD_SELECTOR_HEX,
  createStakerBoxName
} from "./staking-spec.js";

export {
  HAYSTACK_STAKING_APP_ID,
  HAY_ASSET_ID,
  USDC_ASSET_ID,
  HAYSTACK_ORACLE_APP_ID,
  STAKER_BOX_MBR_MICROALGOS
} from "./constants.js";

export { createExecutionAlgodClient, getStakerBoxRecord } from "./shared.js";

export {
  haystackLaunchTokenShape,
  setHaystackLaunchTokenDependenciesForTests
} from "./launch-token.js";
export type { HaystackLaunchTokenInput, HaystackLaunchTokenState } from "./launch-token.js";

export {
  haystackBuyBondingShape,
  setHaystackBuyBondingDependenciesForTests
} from "./buy-bonding.js";
export type {
  HaystackBuyBondingInput,
  HaystackBuyBondingState,
  BondingSwapLeg,
  BondingSwapQuote
} from "./buy-bonding.js";

/** Verified Haystack staking and launch transaction shapes. */
export const haystackShapes: readonly TransactionShapeSpec[] = [
  haystackStakeHayShape,
  haystackUnstakeHayShape,
  haystackClaimRewardsShape,
  haystackLaunchTokenShape,
  haystackBuyBondingShape
];
