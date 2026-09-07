import type { TransactionShapeSpec } from "../../types.js";
import { stammMintLpShape } from "./mint-lp.js";
import { stammRedeemLpShape } from "./redeem-lp.js";

export {
  stammMintLpShape,
  setStammMintLpDependenciesForTests
} from "./mint-lp.js";
export type { StammMintLpInput, StammMintLpDependencies } from "./mint-lp.js";

export {
  stammRedeemLpShape,
  setStammRedeemLpDependenciesForTests
} from "./redeem-lp.js";
export type { StammRedeemLpInput, StammRedeemLpDependencies } from "./redeem-lp.js";

export {
  executeQuotedGroup,
  setStammHogswapGroupDependenciesForTests,
  validateStammHogswapGroup
} from "./hogswap-group.js";
export type { StammHogswapLpState } from "./hogswap-group.js";

export const stammShapes: readonly TransactionShapeSpec[] = [
  stammMintLpShape,
  stammRedeemLpShape
];
