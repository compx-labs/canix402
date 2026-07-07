export type AdapterName =
  | "tinyman"
  | "pact"
  | "folks-finance"
  | "compx"
  | "dorkfi";

export { fetchTinymanOpportunities, normalizeTinymanPool, TinymanAdapterError } from "./tinyman.js";
export { fetchPactOpportunities, normalizePactPool, PactAdapterError } from "./pact.js";
export {
  fetchFolksFinanceOpportunities,
  normalizeFolksLendingOpportunity,
  setFolksFinanceSdkDependenciesForTests,
  FolksFinanceAdapterError
} from "./folksFinance.js";
export {
  fetchCompXOpportunities,
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
