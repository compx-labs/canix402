import type { TransactionShapeSpec } from "../../types.js";
import { morphoVaultDepositShape } from "./deposit-erc4626.js";
import { morphoVaultRedeemShape } from "./redeem-erc4626.js";
import { morphoVaultWithdrawShape } from "./withdraw-erc4626.js";

export { morphoVaultDepositShape } from "./deposit-erc4626.js";
export { morphoVaultWithdrawShape } from "./withdraw-erc4626.js";
export { morphoVaultRedeemShape } from "./redeem-erc4626.js";
export {
  setMorphoVaultStateDependenciesForTests,
  parseMorphoDepositInput,
  parseMorphoWithdrawInput,
  parseMorphoRedeemInput,
  MORPHO_DEPOSIT_SHAPE_KEY,
  MORPHO_WITHDRAW_SHAPE_KEY,
  MORPHO_REDEEM_SHAPE_KEY
} from "./shared.js";
export type {
  MorphoVaultDepositInput,
  MorphoVaultWithdrawInput,
  MorphoVaultRedeemInput,
  MorphoVaultPreviewState
} from "./shared.js";

export const morphoShapes: readonly TransactionShapeSpec[] = [
  morphoVaultDepositShape,
  morphoVaultWithdrawShape,
  morphoVaultRedeemShape
];
