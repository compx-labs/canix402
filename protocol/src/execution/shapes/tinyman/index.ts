import type { TransactionShapeSpec } from "../../types.js";
import { tinymanAddLiquidityFlexibleShape } from "./add-liquidity-flexible.js";
import { tinymanAddLiquidityInitialShape } from "./add-liquidity-initial.js";
import { tinymanAddLiquiditySingleAssetShape } from "./add-liquidity-single-asset.js";
import { tinymanRemoveLiquidityMultipleAssetsOutShape } from "./remove-liquidity-multiple-assets-out.js";
import { tinymanRemoveLiquiditySingleAssetOutShape } from "./remove-liquidity-single-asset-out.js";

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

/** All verified Tinyman transaction shapes. */
export const tinymanShapes: readonly TransactionShapeSpec[] = [
  tinymanAddLiquidityFlexibleShape,
  tinymanAddLiquidityInitialShape,
  tinymanAddLiquiditySingleAssetShape,
  tinymanRemoveLiquidityMultipleAssetsOutShape,
  tinymanRemoveLiquiditySingleAssetOutShape
];
