import type { TransactionShapeSpec } from "../../types.js";
import { pactAddLiquidityTwoSidedShape } from "./add-liquidity-two-sided.js";
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
  pactRemoveLiquidityProportionalShape,
  setPactRemoveLiquidityProportionalDependenciesForTests
} from "./remove-liquidity-proportional.js";
export type {
  PactRemoveLiquidityProportionalInput,
  PactRemoveLiquidityProportionalDependencies
} from "./remove-liquidity-proportional.js";
export {
  resolvePactPoolState,
  mapAssetsToPactAmounts,
  setPactPoolStateDependenciesForTests
} from "./pool-state.js";
export type { PactPoolState, PactPoolStateDependencies } from "./pool-state.js";

/** All verified Pact transaction shapes. */
export const pactShapes: readonly TransactionShapeSpec[] = [
  pactAddLiquidityTwoSidedShape,
  pactRemoveLiquidityProportionalShape
];
