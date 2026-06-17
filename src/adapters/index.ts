export type AdapterName =
  | "tinyman"
  | "pact"
  | "folks-finance"
  | "compx"
  | "dorkfi"
  | "haystack";

export { fetchTinymanOpportunities, normalizeTinymanPool, TinymanAdapterError } from "./tinyman.js";
