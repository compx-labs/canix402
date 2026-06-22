export type AdapterName =
  | "tinyman"
  | "pact"
  | "folks-finance"
  | "compx"
  | "dorkfi"
  | "haystack";

export { fetchTinymanOpportunities, normalizeTinymanPool, TinymanAdapterError } from "./tinyman.js";
export { fetchPactOpportunities, normalizePactPool, PactAdapterError } from "./pact.js";
export {
  fetchFolksFinanceOpportunities,
  normalizeFolksLendingOpportunity,
  setFolksFinanceSdkDependenciesForTests,
  FolksFinanceAdapterError
} from "./folksFinance.js";
