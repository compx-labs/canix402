import type { TransactionShapeSpec } from "../../types.js";
import { tinymanAddLiquidityFlexibleShape } from "./add-liquidity-flexible.js";

export {
  tinymanAddLiquidityFlexibleShape,
  setTinymanFlexibleAddLiquidityDependenciesForTests
} from "./add-liquidity-flexible.js";
export type {
  TinymanAddLiquidityFlexibleInput,
  TinymanFlexibleAddLiquidityDependencies
} from "./add-liquidity-flexible.js";
export {
  resolveTinymanV2PoolState,
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
  tinymanAddLiquidityFlexibleShape
];
