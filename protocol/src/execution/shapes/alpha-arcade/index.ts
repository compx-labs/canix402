import type { TransactionShapeSpec } from "../../types.js";
import { alphaArcadeClaimRewardsShape } from "./claim-rewards.js";
import { alphaArcadeStakeAlphaShape } from "./stake-alpha.js";
import { alphaArcadeUnstakeAlphaShape } from "./unstake-alpha.js";

export {
  alphaArcadeStakeAlphaShape,
  setAlphaArcadeStakeAlphaDependenciesForTests,
  buildMockStakeGroup
} from "./stake-alpha.js";
export type {
  AlphaArcadeStakeAlphaInput,
  AlphaArcadeStakeAlphaDependencies
} from "./stake-alpha.js";

export {
  alphaArcadeUnstakeAlphaShape,
  setAlphaArcadeUnstakeAlphaDependenciesForTests,
  buildMockUnstakeGroup
} from "./unstake-alpha.js";
export type {
  AlphaArcadeUnstakeAlphaInput,
  AlphaArcadeUnstakeAlphaDependencies
} from "./unstake-alpha.js";

export {
  alphaArcadeClaimRewardsShape,
  setAlphaArcadeClaimRewardsDependenciesForTests,
  buildMockClaimGroup
} from "./claim-rewards.js";
export type {
  AlphaArcadeClaimRewardsInput,
  AlphaArcadeClaimRewardsDependencies
} from "./claim-rewards.js";

export {
  resolveAlphaArcadeStakingState,
  setAlphaArcadeStakingStateDependenciesForTests
} from "./staking-state.js";
export type {
  AlphaArcadeStakingState,
  AlphaArcadeStakingGlobalState,
  AlphaArcadeStakingStateDependencies
} from "./staking-state.js";

export {
  OPT_IN_METHOD_SELECTOR_HEX,
  STAKE_METHOD_SELECTOR_HEX,
  UNSTAKE_METHOD_SELECTOR_HEX,
  CLAIM_METHOD_SELECTOR_HEX
} from "./staking-spec.js";

export {
  ALPHA_ARCADE_STAKING_APP_ID,
  ALPHA_ASSET_ID,
  USDC_ASSET_ID,
  ALPHA_ARCADE_INNER_TXN_FLAT_FEE,
  FIRST_STAKE_ALGO_RESERVE_MICROALGOS
} from "./constants.js";

export { createExecutionAlgodClient } from "./shared.js";

/** All verified Alpha Arcade staking transaction shapes. */
export const alphaArcadeShapes: readonly TransactionShapeSpec[] = [
  alphaArcadeStakeAlphaShape,
  alphaArcadeUnstakeAlphaShape,
  alphaArcadeClaimRewardsShape
];
