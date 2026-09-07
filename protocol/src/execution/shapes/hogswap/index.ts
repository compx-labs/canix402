import type { TransactionShapeSpec } from "../../types.js";
import { hogswapSwapFixedInputShape, hogswapSwapFixedOutputShape } from "./swap.js";

export {
  hogswapSwapFixedInputShape,
  hogswapSwapFixedOutputShape,
  setHogswapSwapDependenciesForTests
} from "./swap.js";
export type { HogswapSwapInput, HogswapSwapDependencies, HogswapSwapVariant } from "./swap.js";

export {
  executeQuotedSwapGroup,
  setHogswapSwapGroupDependenciesForTests,
  validateHogswapSwapGroup
} from "./group.js";
export type { HogswapSwapState } from "./group.js";

export const hogswapShapes: readonly TransactionShapeSpec[] = [
  hogswapSwapFixedInputShape,
  hogswapSwapFixedOutputShape
];
