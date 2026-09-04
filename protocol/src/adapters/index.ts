export type AdapterName =
  | "tinyman"
  | "pact"
  | "folks-finance"
  | "compx"
  | "dorkfi"
  | "myth-finance"
  | "haystack"
  | "reti"
  | "alpha-arcade"
  | "stamm"
  | "algofi"
  | "humble";

export {
  fetchTinymanOpportunities,
  normalizeTinymanPool,
  normalizeTinymanFarm,
  normalizeTinymanTAlgoStakingOpportunity,
  normalizeTinymanStAlgoStakingOpportunity,
  parseTinymanPoolDetail,
  resolveExtraPoolAddresses,
  setTinymanAdapterDependenciesForTests,
  TINYMAN_DEFAULT_EXTRA_POOL_ADDRESSES,
  TINYMAN_LIQUID_STAKE_PROTOCOL_FEE,
  TINYMAN_TALGO_STAKING_OPPORTUNITY_ID,
  TINYMAN_STALGO_STAKING_OPPORTUNITY_ID,
  TinymanAdapterError
} from "./tinyman.js";
export {
  fetchPactOpportunities,
  normalizePactPool,
  normalizePactFarm,
  PactAdapterError
} from "./pact.js";
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
export {
  fetchMythFinanceOpportunities,
  normalizeMythStakingOpportunity,
  normalizeMythFarmOpportunity,
  setMythFinanceSdkDependenciesForTests,
  mythStakingOpportunityId,
  mythFarmOpportunityId,
  parseMythStakingAppId,
  parseMythFarmAppId,
  isMythStakingOpportunityId,
  isMythFarmOpportunityId,
  MYTH_STAKING_OPPORTUNITY_ID_PREFIX,
  MYTH_FARM_OPPORTUNITY_ID_PREFIX,
  MYTH_DS_REGISTRY_APP_ID,
  MYTH_TINYMAN_APP_ID,
  MYTH_ARC59_ROUTER_APP_ID,
  MYTH_SIMULATE_SENDER,
  MythFinanceAdapterError
} from "./mythFinance.js";
export {
  fetchHaystackOpportunities,
  normalizeHaystackStakingOpportunity,
  setHaystackAdapterDependenciesForTests,
  fixedPointAprToPercentage,
  HAYSTACK_STAKING_OPPORTUNITY_ID,
  HAYSTACK_STAKING_APP_ID,
  HAY_ASSET_ID,
  USDC_ASSET_ID,
  HaystackAdapterError
} from "./haystack.js";
export type { HaystackPoolSnapshot } from "./haystack.js";
export {
  fetchRetiOpportunities,
  normalizeRetiStakingOpportunity,
  setRetiAdapterDependenciesForTests,
  retiStakingOpportunityId,
  parseRetiValidatorId,
  isRetiStakingOpportunityId,
  buildEntryRequirements,
  buildCapacity,
  RetiAdapterError
} from "./reti.js";
export type { RetiValidatorSnapshot } from "./reti.js";
export {
  RETI_STAKING_OPPORTUNITY_ID_PREFIX,
  RETI_VALIDATOR_REGISTRY_APP_ID
} from "../reti/constants.js";
export {
  fetchAlphaArcadeOpportunities,
  normalizeAlphaArcadeStakingOpportunity,
  setAlphaArcadeAdapterDependenciesForTests,
  annualizeTrailingFeeApr,
  ALPHA_ARCADE_STAKING_OPPORTUNITY_ID,
  ALPHA_ARCADE_STAKING_APP_ID,
  ALPHA_ASSET_ID,
  TRAILING_APR_WINDOW_DAYS,
  AlphaArcadeAdapterError
} from "./alpha-arcade.js";
export type { AlphaArcadePoolSnapshot } from "./alpha-arcade.js";
