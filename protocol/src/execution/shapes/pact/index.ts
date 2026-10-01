import type { TransactionShapeSpec } from "../../types.js";
import { pactAddLiquidityAndFarmTwoSidedShape } from "./add-liquidity-and-farm-two-sided.js";
import { pactManagedWeightedAddLiquidityShape } from "./add-liquidity-managed-weighted.js";
import { pactAddLiquidityTwoSidedShape } from "./add-liquidity-two-sided.js";
import { pactFarmClaimRewardsShape } from "./farm-claim-rewards.js";
import { pactFarmDeployEscrowShape } from "./farm-deploy-escrow.js";
import { pactFarmStakeShape } from "./farm-stake.js";
import { pactFarmUnstakeShape } from "./farm-unstake.js";
import { pactManagedWeightedRemoveLiquidityShape } from "./remove-liquidity-managed-weighted.js";
import { pactRemoveLiquidityProportionalShape } from "./remove-liquidity-proportional.js";
import { pactSmartRouterSwapShape } from "./smart-router-swap.js";

export {
  pactManagedWeightedAddLiquidityShape,
  setPactManagedWeightedAddLiquidityDependenciesForTests
} from "./add-liquidity-managed-weighted.js";
export type {
  PactManagedWeightedAddLiquidityInput,
  PactManagedWeightedAddLiquidityDependencies
} from "./add-liquidity-managed-weighted.js";
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
  pactManagedWeightedRemoveLiquidityShape,
  setPactManagedWeightedRemoveLiquidityDependenciesForTests
} from "./remove-liquidity-managed-weighted.js";
export type {
  PactManagedWeightedRemoveLiquidityInput,
  PactManagedWeightedRemoveLiquidityDependencies
} from "./remove-liquidity-managed-weighted.js";
export {
  resolvePactManagedWeightedPoolState,
  setPactManagedWeightedStateDependenciesForTests,
  assertDepositMatchesReserves,
  assetIdBoxName,
  expectedProportionalMint,
  proportionalMinimumOuts,
  PACT_V201_ADD_LIQUIDITY_SELECTOR,
  PACT_V201_REMOVE_LIQUIDITY_SELECTOR
} from "./managed-weighted-state.js";
export type { PactManagedWeightedPoolState } from "./managed-weighted-state.js";
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
  pactSmartRouterSwapShape,
  setPactSmartRouterSwapDependenciesForTests
} from "./smart-router-swap.js";
export type {
  PactSmartRouterSwapInput,
  PactSmartRouterSwapState,
  PactSmartRouterSwapDependencies
} from "./smart-router-swap.js";
export {
  SWAP_ONE_HOP_METHOD,
  SWAP_TWO_HOP_METHOD,
  SWAP_ONE_HOP_SELECTOR_HEX,
  SWAP_TWO_HOP_SELECTOR_HEX,
  packRouterSwaps,
  buildPactSmartRouterGroup,
  pactSwapInterfaceName
} from "./router-abi.js";
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
  addressToStringForPact,
  createPactBuilderAlgodClient,
  createPactCompatibleAlgodClient,
  getPactBuilderAlgodSdk,
  resolvePactPoolState,
  mapAssetsToPactAmounts,
  setPactPoolStateDependenciesForTests
} from "./pool-state.js";
export type { PactPoolState, PactPoolStateDependencies } from "./pool-state.js";

/** All verified Pact transaction shapes. */
export const pactShapes: readonly TransactionShapeSpec[] = [
  pactManagedWeightedAddLiquidityShape,
  pactManagedWeightedRemoveLiquidityShape,
  pactAddLiquidityTwoSidedShape,
  pactRemoveLiquidityProportionalShape,
  pactFarmDeployEscrowShape,
  pactFarmStakeShape,
  pactFarmUnstakeShape,
  pactFarmClaimRewardsShape,
  pactAddLiquidityAndFarmTwoSidedShape,
  pactSmartRouterSwapShape
];
