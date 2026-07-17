export type AdapterName =
  | "tinyman"
  | "pact"
  | "folks-finance"
  | "compx"
  | "dorkfi";

export {
  fetchTinymanOpportunities,
  normalizeTinymanPool,
  normalizeTinymanTAlgoStakingOpportunity,
  setTinymanAdapterDependenciesForTests,
  TINYMAN_LIQUID_STAKE_PROTOCOL_FEE,
  TINYMAN_TALGO_STAKING_OPPORTUNITY_ID,
  TinymanAdapterError
} from "./tinyman.js";
export { fetchPactOpportunities, normalizePactPool, PactAdapterError } from "./pact.js";
export {
  fetchFolksFinanceOpportunities,
  normalizeFolksLendingOpportunity,
  normalizeFolksXAlgoStakingOpportunity,
  setFolksFinanceSdkDependenciesForTests,
  FOLKS_XALGO_STAKING_OPPORTUNITY_ID,
  FolksFinanceAdapterError
} from "./folksFinance.js";
export {
  fetchCompXOpportunities,
  fetchCompXTokenPrices,
  normalizeCompxLendingOpportunity,
  normalizeCompxStakingOpportunity,
  setCompXSdkDependenciesForTests,
  CompXAdapterError
} from "./compx.js";
export {
  fetchDorkFiOpportunities,
  normalizeDorkFiOpportunity,
  DorkFiAdapterError
} from "./dorkfi.js";
