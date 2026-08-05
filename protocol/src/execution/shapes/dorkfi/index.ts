import type { TransactionShapeSpec } from "../../types.js";
import { dorkfiBorrowAsaShape } from "./borrow-asa.js";
import { dorkfiDepositAsaShape } from "./deposit-asa.js";
import { dorkfiRepayAsaShape } from "./repay-asa.js";
import { dorkfiWithdrawAsaShape } from "./withdraw-asa.js";

export {
  dorkfiDepositAsaShape,
  setDorkFiDepositAsaDependenciesForTests,
  buildMockDorkFiDepositGroup
} from "./deposit-asa.js";
export type { DorkFiDepositAsaInput, DorkFiDepositAsaDependencies } from "./deposit-asa.js";

export {
  dorkfiWithdrawAsaShape,
  setDorkFiWithdrawAsaDependenciesForTests,
  buildMockDorkFiWithdrawGroup
} from "./withdraw-asa.js";
export type { DorkFiWithdrawAsaInput, DorkFiWithdrawAsaDependencies } from "./withdraw-asa.js";

export {
  dorkfiBorrowAsaShape,
  setDorkFiBorrowAsaDependenciesForTests,
  buildMockDorkFiBorrowGroup
} from "./borrow-asa.js";
export type { DorkFiBorrowAsaInput, DorkFiBorrowAsaDependencies } from "./borrow-asa.js";

export {
  dorkfiRepayAsaShape,
  setDorkFiRepayAsaDependenciesForTests,
  buildMockDorkFiRepayGroup
} from "./repay-asa.js";
export type { DorkFiRepayAsaInput, DorkFiRepayAsaDependencies } from "./repay-asa.js";

export {
  resolveDorkFiLendingMarketState,
  setDorkFiLendingMarketStateDependenciesForTests
} from "./market-state.js";
export type { DorkFiLendingMarketState, DorkFiLendingMarketStateDependencies } from "./market-state.js";

export {
  DORKFI_ALGORAND_ASA_MARKETS,
  findCatalogMarket,
  findCatalogMarketByPoolAndAsset,
  buildDorkFiLendingOpportunityId
} from "./market-catalog.js";
export {
  DORKFI_MAINNET_USDC_POOL_APP_ID,
  DORKFI_MAINNET_USDC_MARKET_APP_ID,
  DORKFI_MAINNET_USDC_ASA_ID
} from "./constants.js";

/** All verified Dork.fi transaction shapes. */
export const dorkfiShapes: readonly TransactionShapeSpec[] = [
  dorkfiDepositAsaShape,
  dorkfiWithdrawAsaShape,
  dorkfiBorrowAsaShape,
  dorkfiRepayAsaShape
];
