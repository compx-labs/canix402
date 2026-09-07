import type { TransactionShapeSpec } from "../../types.js";
import { tinymanAddLiquidityFlexibleShape } from "./add-liquidity-flexible.js";
import { tinymanAddLiquidityInitialShape } from "./add-liquidity-initial.js";
import { tinymanAddLiquiditySingleAssetShape } from "./add-liquidity-single-asset.js";
import { tinymanRemoveLiquidityMultipleAssetsOutShape } from "./remove-liquidity-multiple-assets-out.js";
import { tinymanRemoveLiquiditySingleAssetOutShape } from "./remove-liquidity-single-asset-out.js";
import { tinymanFarmCommitShape } from "./farm-commit.js";
import { tinymanFarmUncommitShape } from "./farm-uncommit.js";
import { tinymanFarmClaimRewardsShape } from "./farm-claim-rewards.js";
import { tinymanAddLiquidityAndFarmFlexibleShape } from "./add-liquidity-and-farm-flexible.js";
import { tinymanAddLiquidityAndFarmSingleAssetShape } from "./add-liquidity-and-farm-single-asset.js";
import { tinymanMintTAlgoShape } from "./mint-talgo.js";
import { tinymanBurnTAlgoShape } from "./burn-talgo.js";
import { tinymanIncreaseStakeStAlgoShape } from "./increase-stake-stalgo.js";
import { tinymanDecreaseStakeStAlgoShape } from "./decrease-stake-stalgo.js";
import { tinymanClaimRewardsStAlgoShape } from "./claim-rewards-stalgo.js";
import {
  tinymanSwapFixedInputShape,
  tinymanSwapFixedOutputShape
} from "./swap-router.js";

export {
  tinymanAddLiquidityFlexibleShape,
  setTinymanFlexibleAddLiquidityDependenciesForTests
} from "./add-liquidity-flexible.js";
export type {
  TinymanAddLiquidityFlexibleInput,
  TinymanFlexibleAddLiquidityDependencies
} from "./add-liquidity-flexible.js";
export {
  tinymanAddLiquidityInitialShape,
  setTinymanInitialAddLiquidityDependenciesForTests
} from "./add-liquidity-initial.js";
export type {
  TinymanAddLiquidityInitialInput,
  TinymanInitialAddLiquidityDependencies
} from "./add-liquidity-initial.js";
export {
  tinymanAddLiquiditySingleAssetShape,
  setTinymanSingleAssetAddLiquidityDependenciesForTests
} from "./add-liquidity-single-asset.js";
export type {
  TinymanAddLiquiditySingleAssetInput,
  TinymanSingleAssetAddLiquidityDependencies
} from "./add-liquidity-single-asset.js";
export {
  tinymanRemoveLiquidityMultipleAssetsOutShape,
  setTinymanRemoveLiquidityDependenciesForTests
} from "./remove-liquidity-multiple-assets-out.js";
export type {
  TinymanRemoveLiquidityMultipleAssetsOutInput,
  TinymanRemoveLiquidityMultipleAssetsOutDependencies
} from "./remove-liquidity-multiple-assets-out.js";
export {
  tinymanRemoveLiquiditySingleAssetOutShape,
  setTinymanRemoveLiquiditySingleAssetOutDependenciesForTests
} from "./remove-liquidity-single-asset-out.js";
export type {
  TinymanRemoveLiquiditySingleAssetOutInput,
  TinymanRemoveLiquiditySingleAssetOutDependencies
} from "./remove-liquidity-single-asset-out.js";
export {
  resolveTinymanV2PoolState,
  resolveTinymanV2PoolStateForInitialAdd,
  resolveTinymanV2PoolReserves,
  orderTinymanAssets,
  setTinymanPoolStateDependenciesForTests,
  createExecutionAlgodClient
} from "./pool-state.js";
export type {
  TinymanV2PoolState,
  TinymanPoolStateDependencies
} from "./pool-state.js";
export {
  tinymanFarmCommitShape,
  setTinymanFarmCommitDependenciesForTests
} from "./farm-commit.js";
export type {
  TinymanFarmCommitInput,
  TinymanFarmCommitDependencies
} from "./farm-commit.js";
export {
  tinymanFarmUncommitShape,
  setTinymanFarmUncommitDependenciesForTests
} from "./farm-uncommit.js";
export type {
  TinymanFarmUncommitInput,
  TinymanFarmUncommitDependencies
} from "./farm-uncommit.js";
export {
  tinymanFarmClaimRewardsShape,
  setTinymanFarmClaimRewardsDependenciesForTests,
  classifyClaimGroupTransactions
} from "./farm-claim-rewards.js";
export type {
  TinymanFarmClaimRewardsInput,
  TinymanFarmClaimRewardsState,
  TinymanFarmClaimRewardsDependencies
} from "./farm-claim-rewards.js";
export {
  resolveTinymanFarmState,
  setTinymanFarmStateDependenciesForTests
} from "./farm-state.js";
export type {
  TinymanFarmState,
  TinymanFarmStateDependencies
} from "./farm-state.js";
export { validateFarmCommitTransactions } from "./farm-commit.js";
export {
  tinymanAddLiquidityAndFarmFlexibleShape,
  setTinymanAddLiquidityAndFarmFlexibleDependenciesForTests
} from "./add-liquidity-and-farm-flexible.js";
export type {
  TinymanAddLiquidityAndFarmFlexibleInput,
  TinymanAddLiquidityAndFarmFlexibleDependencies,
  TinymanAddLiquidityAndFarmState
} from "./add-liquidity-and-farm-flexible.js";
export {
  tinymanAddLiquidityAndFarmSingleAssetShape,
  setTinymanAddLiquidityAndFarmSingleAssetDependenciesForTests
} from "./add-liquidity-and-farm-single-asset.js";
export type {
  TinymanAddLiquidityAndFarmSingleAssetInput,
  TinymanAddLiquidityAndFarmSingleAssetDependencies
} from "./add-liquidity-and-farm-single-asset.js";
export {
  tinymanMintTAlgoShape,
  setTinymanMintTAlgoDependenciesForTests
} from "./mint-talgo.js";
export type {
  TinymanMintTAlgoInput,
  TinymanMintTAlgoDependencies
} from "./mint-talgo.js";
export {
  tinymanBurnTAlgoShape,
  setTinymanBurnTAlgoDependenciesForTests
} from "./burn-talgo.js";
export type {
  TinymanBurnTAlgoInput,
  TinymanBurnTAlgoDependencies
} from "./burn-talgo.js";
export {
  tinymanIncreaseStakeStAlgoShape,
  setTinymanIncreaseStakeStAlgoDependenciesForTests
} from "./increase-stake-stalgo.js";
export type {
  TinymanIncreaseStakeStAlgoInput,
  TinymanIncreaseStakeStAlgoDependencies
} from "./increase-stake-stalgo.js";
export {
  tinymanDecreaseStakeStAlgoShape,
  setTinymanDecreaseStakeStAlgoDependenciesForTests
} from "./decrease-stake-stalgo.js";
export type {
  TinymanDecreaseStakeStAlgoInput,
  TinymanDecreaseStakeStAlgoDependencies
} from "./decrease-stake-stalgo.js";
export {
  tinymanClaimRewardsStAlgoShape,
  setTinymanClaimRewardsStAlgoDependenciesForTests
} from "./claim-rewards-stalgo.js";
export type {
  TinymanClaimRewardsStAlgoInput,
  TinymanClaimRewardsStAlgoDependencies
} from "./claim-rewards-stalgo.js";
export {
  tinymanSwapFixedInputShape,
  tinymanSwapFixedOutputShape,
  setTinymanSwapRouterDependenciesForTests,
  quoteTinymanSwap
} from "./swap-router.js";
export type { TinymanSwapInput, TinymanSwapState, TinymanSwapRouterDependencies } from "./swap-router.js";
export {
  hopCountFromRouter,
  selectTinymanSwapWinner
} from "./swap-compare.js";
export type {
  TinymanSwapCandidate,
  TinymanSwapFallbackReason,
  TinymanSwapPath,
  TinymanSwapType
} from "./swap-compare.js";
export {
  resolveTinymanLiquidStakeState,
  setTinymanLiquidStakeStateDependenciesForTests,
  TINYMAN_STAKE_APP_ID,
  TINYMAN_RESTAKE_APP_ID,
  TINYMAN_VAULT_APP_ID,
  TALGO_ASSET_ID,
  STALGO_ASSET_ID,
  TINY_ASSET_ID
} from "./liquid-stake-state.js";
export type {
  TinymanLiquidStakeState,
  TinymanLiquidStakeStateDependencies
} from "./liquid-stake-state.js";

/** All verified Tinyman transaction shapes. */
export const tinymanShapes: readonly TransactionShapeSpec[] = [
  tinymanAddLiquidityFlexibleShape,
  tinymanAddLiquidityInitialShape,
  tinymanAddLiquiditySingleAssetShape,
  tinymanRemoveLiquidityMultipleAssetsOutShape,
  tinymanRemoveLiquiditySingleAssetOutShape,
  tinymanFarmCommitShape,
  tinymanFarmUncommitShape,
  tinymanFarmClaimRewardsShape,
  tinymanAddLiquidityAndFarmFlexibleShape,
  tinymanAddLiquidityAndFarmSingleAssetShape,
  tinymanMintTAlgoShape,
  tinymanBurnTAlgoShape,
  tinymanIncreaseStakeStAlgoShape,
  tinymanDecreaseStakeStAlgoShape,
  tinymanClaimRewardsStAlgoShape,
  tinymanSwapFixedInputShape,
  tinymanSwapFixedOutputShape
];
