import type { TransactionShapeSpec } from "../../types.js";
import { pactAddLiquidityAndFarmTwoSidedShape } from "./add-liquidity-and-farm-two-sided.js";
import { pactAddLiquidityTwoSidedShape } from "./add-liquidity-two-sided.js";
import { pactFarmClaimRewardsShape } from "./farm-claim-rewards.js";
import { pactFarmDeployEscrowShape } from "./farm-deploy-escrow.js";
import { pactFarmStakeShape } from "./farm-stake.js";
import { pactFarmUnstakeShape } from "./farm-unstake.js";
import { pactRemoveLiquidityProportionalShape } from "./remove-liquidity-proportional.js";

export {
  pactAddLiquidityTwoSidedShape,
  setPactAddLiquidityTwoSidedDependenciesForTests
} from "./add-liquidity-two-sided.js";
export type {
  PactAddLiquidityTwoSidedInput,
  PactAddLiquidityTwoSidedDependencies
} from "./add-liquidity-two-sided.js";
export {
  pactAddLiquidityAndFarmTwoSidedShape,
  setPactAddLiquidityAndFarmTwoSidedDependenciesForTests
} from "./add-liquidity-and-farm-two-sided.js";
export type {
  PactAddLiquidityAndFarmTwoSidedInput,
  PactAddLiquidityAndFarmTwoSidedDependencies,
  PactAddLiquidityAndFarmState
} from "./add-liquidity-and-farm-two-sided.js";
export {
  pactRemoveLiquidityProportionalShape,
  setPactRemoveLiquidityProportionalDependenciesForTests
} from "./remove-liquidity-proportional.js";
export type {
  PactRemoveLiquidityProportionalInput,
  PactRemoveLiquidityProportionalDependencies
} from "./remove-liquidity-proportional.js";
export {
  pactFarmDeployEscrowShape,
  setPactFarmDeployEscrowDependenciesForTests
} from "./farm-deploy-escrow.js";
export type {
  PactFarmDeployEscrowInput,
  PactFarmDeployEscrowDependencies
} from "./farm-deploy-escrow.js";
export {
  pactFarmStakeShape,
  setPactFarmStakeDependenciesForTests
} from "./farm-stake.js";
export type {
  PactFarmStakeInput,
  PactFarmStakeDependencies
} from "./farm-stake.js";
export {
  pactFarmUnstakeShape,
  setPactFarmUnstakeDependenciesForTests
} from "./farm-unstake.js";
export type {
  PactFarmUnstakeInput,
  PactFarmUnstakeDependencies
} from "./farm-unstake.js";
export {
  pactFarmClaimRewardsShape,
  setPactFarmClaimRewardsDependenciesForTests
} from "./farm-claim-rewards.js";
export type {
  PactFarmClaimRewardsInput,
  PactFarmClaimRewardsDependencies
} from "./farm-claim-rewards.js";
export {
  resolvePactFarmState,
  setPactFarmStateDependenciesForTests,
  requireEscrow
} from "./farm-state.js";
export type {
  PactFarmState,
  PactFarmStateDependencies
} from "./farm-state.js";
export {
  createPactCompatibleAlgodClient,
  resolvePactPoolState,
  mapAssetsToPactAmounts,
  setPactPoolStateDependenciesForTests
} from "./pool-state.js";
export type { PactPoolState, PactPoolStateDependencies } from "./pool-state.js";

/** All verified Pact transaction shapes. */
export const pactShapes: readonly TransactionShapeSpec[] = [
  pactAddLiquidityTwoSidedShape,
  pactRemoveLiquidityProportionalShape,
  pactFarmDeployEscrowShape,
  pactFarmStakeShape,
  pactFarmUnstakeShape,
  pactFarmClaimRewardsShape,
  pactAddLiquidityAndFarmTwoSidedShape
];
