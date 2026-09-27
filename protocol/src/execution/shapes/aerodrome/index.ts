import type { TransactionShapeSpec } from "../../types.js";
import { aerodromeDepositShape } from "./deposit-gauge.js";
import { aerodromeWithdrawShape } from "./withdraw-gauge.js";

export { aerodromeDepositShape } from "./deposit-gauge.js";
export { aerodromeWithdrawShape } from "./withdraw-gauge.js";
export {
  setAerodromeStateDependenciesForTests,
  AERODROME_DEPOSIT_SHAPE_KEY,
  AERODROME_WITHDRAW_SHAPE_KEY,
  encodeApproveCall
} from "./shared.js";
export type {
  AerodromeDepositInput,
  AerodromeWithdrawInput,
  AerodromeDepositState,
  AerodromeWithdrawState,
  AerodromePoolView,
  AerodromeQuote
} from "./shared.js";

export const aerodromeShapes: readonly TransactionShapeSpec[] = [
  aerodromeDepositShape,
  aerodromeWithdrawShape
];
