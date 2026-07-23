export { retiStakeAlgoShape, setRetiStakeAlgoDependenciesForTests } from "./stake-algo.js";
export type { RetiStakeAlgoInput } from "./stake-algo.js";
export {
  retiUnstakeAlgoShape,
  setRetiUnstakeAlgoDependenciesForTests
} from "./unstake-algo.js";
export type { RetiUnstakeAlgoInput, RetiUnstakeState } from "./unstake-algo.js";
export {
  resolveRetiStakeState,
  assertStakeEligibility,
  setRetiStakeStateDependenciesForTests
} from "./stake-state.js";
export type { RetiStakeState } from "./stake-state.js";

import { retiStakeAlgoShape } from "./stake-algo.js";
import { retiUnstakeAlgoShape } from "./unstake-algo.js";

export const retiShapes = [retiStakeAlgoShape, retiUnstakeAlgoShape] as const;
