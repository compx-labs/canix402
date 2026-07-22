import type { TransactionShapeSpec } from "../../types.js";
import { dorkfiDepositAsaShape } from "./deposit-asa.js";
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
  dorkfiWithdrawAsaShape
];
