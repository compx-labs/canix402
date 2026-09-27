import type { TransactionShapeSpec } from "../../types.js";
import { aaveBorrowShape } from "./borrow-variable.js";
import { aaveRepayShape } from "./repay-variable.js";
import { aaveSupplyShape } from "./supply-erc20.js";
import { aaveWithdrawShape } from "./withdraw-erc20.js";

export { aaveSupplyShape } from "./supply-erc20.js";
export { aaveWithdrawShape } from "./withdraw-erc20.js";
export { aaveBorrowShape } from "./borrow-variable.js";
export { aaveRepayShape } from "./repay-variable.js";
export {
  setAaveStateDependenciesForTests,
  parseAavePoolActionInput,
  healthFactorFromAccount,
  decodeUserAccountData,
  encodeBalanceOfCall,
  encodeUserAccountDataCall,
  AAVE_SUPPLY_SHAPE_KEY,
  AAVE_WITHDRAW_SHAPE_KEY,
  AAVE_BORROW_SHAPE_KEY,
  AAVE_REPAY_SHAPE_KEY,
  AAVE_V3_BASE_POOL
} from "./shared.js";
export type { AavePoolActionInput, AavePoolActionState, AaveUserAccountData } from "./shared.js";

export const aaveShapes: readonly TransactionShapeSpec[] = [
  aaveSupplyShape,
  aaveWithdrawShape,
  aaveBorrowShape,
  aaveRepayShape
];
