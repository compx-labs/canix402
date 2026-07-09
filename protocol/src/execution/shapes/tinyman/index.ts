import type { TransactionShapeSpec } from "../../types.js";
import { tinymanAddLiquidityFlexibleShape } from "./add-liquidity-flexible.js";
import { tinymanRemoveLiquidityMultipleAssetsOutShape } from "./remove-liquidity-multiple-assets-out.js";

export {
  tinymanAddLiquidityFlexibleShape,
  setTinymanFlexibleAddLiquidityDependenciesForTests
} from "./add-liquidity-flexible.js";
export type {
  TinymanAddLiquidityFlexibleInput,
  TinymanFlexibleAddLiquidityDependencies
} from "./add-liquidity-flexible.js";
export {
  tinymanRemoveLiquidityMultipleAssetsOutShape,
  setTinymanRemoveLiquidityDependenciesForTests
} from "./remove-liquidity-multiple-assets-out.js";
export type {
  TinymanRemoveLiquidityMultipleAssetsOutInput,
  TinymanRemoveLiquidityMultipleAssetsOutDependencies
} from "./remove-liquidity-multiple-assets-out.js";
export {
  resolveTinymanV2PoolState,
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
  tinymanRemoveLiquidityMultipleAssetsOutShape
];
