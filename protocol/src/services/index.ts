export interface ServiceHealth {
  service: "canix402";
  status: "ok";
}

export {
  AllPositionSourcesUnavailableError,
  SUPPORTED_POSITION_PROTOCOLS,
  fetchWalletPositions,
  setPositionCollectorsForTests
} from "./aggregate-positions.js";
export {
  collectCompXPositions,
  collectDorkFiPositions,
  collectFolksFinancePositions,
  collectPactPositions,
  collectTinymanPositions,
  normalizeDorkFiHealthRecords
} from "./protocol-positions.js";
export {
  collectAlgofiPositions,
  collectHumblePositions,
  collectStammPositions,
  normalizeHogswapLpPosition
} from "./hogswap-lp-positions.js";
export {
  executeHogswapQuote,
  fetchHogswapAnalyticsPrices,
  fetchHogswapLpCatalog,
  fetchHogswapLpValuation,
  fetchStammAssets,
  fetchStammPools,
  mapHogswapDexToProtocol,
  parseHogswapExecute,
  parseHogswapQuote,
  quoteHogswapLpMint,
  quoteHogswapLpRedeem,
  resetHogswapClientCacheForTests,
  setHogswapClientDependenciesForTests,
  HogswapClientError,
  HogswapMissingOptInError,
  HogswapQuoteExpiredError,
  HOGSWAP_DEFAULT_HTTP_TIMEOUT_MS,
  HOGSWAP_LP_DEFAULT_SLIPPAGE_BPS,
  HOGSWAP_LP_POSITION_PROTOCOLS,
  HOGSWAP_QUOTE_TTL_MS
} from "./hogswap-client.js";
export type {
  HogswapExecuteResult,
  HogswapLpMintQuoteRequest,
  HogswapLpQuoteExtras,
  HogswapLpRedeemQuoteRequest,
  HogswapQuote,
  HogswapStammAssetMeta
} from "./hogswap-client.js";
export type {
  PositionCollector,
  ProtocolPositionsCollection
} from "./protocol-positions.js";
export {
  fetchHeldAssetIds,
  fetchAccountHoldings,
  setAccountAssetsDependenciesForTests,
  AccountAssetsError
} from "./account-assets.js";
export type { AccountHoldings } from "./account-assets.js";
export {
  emptyWalletSnapshot,
  fetchWalletSnapshot,
  getHeldWalletAssetIds,
  getWalletAssetBalance,
  getWalletLocalAppIds,
  WalletSnapshotError
} from "./wallet-snapshot.js";
export type {
  WalletAppLocalState,
  WalletAssetHolding,
  WalletSnapshot
} from "./wallet-snapshot.js";
export {
  ALGO_ASSET_ID,
  ALGO_DECIMALS,
  resolveAssetDecimals,
  setAssetDecimalsDependenciesForTests
} from "./asset-decimals.js";
export {
  selectPersonalizedOpportunities,
  matchesPersonalizedOpportunity
} from "./personalized-opportunities.js";
export type { PersonalizedHoldings } from "./personalized-opportunities.js";
export {
  eligibilityBlockedOnlyByCapacity,
  evaluateOpportunityEligibility,
  fetchEligibility,
  matchesPersonalizedFromEligibility
} from "./eligibility.js";
export type { EligibilityHoldings } from "./eligibility.js";
export {
  compilePlan,
  PlanValidationError,
  resolvePlanPriceUsdc,
  setPlanCompilerDependenciesForTests
} from "./plans.js";
export type { PlanCompilerDependencies } from "./plans.js";
export {
  compileRebalance,
  RebalanceValidationError,
  resolveRebalancePriceUsdc,
  setRebalanceCompilerDependenciesForTests
} from "./rebalance.js";
export type { RebalanceCompilerDependencies } from "./rebalance.js";
export {
  computeRebalanceDeltas,
  resolveIdleAlgoMicro
} from "./rebalance-graph.js";
export {
  COMPOSE_MISSING_OPTIN_CAVEAT,
  COMPOSE_SIGNER_CAVEAT,
  COMPOSE_SLIPPAGE_CAVEAT,
  COMPOSE_STALE_QUOTE_CAVEAT,
  HAYSTACK_OPTIN_SHAPE_KEY,
  HAYSTACK_SWAP_SHAPE_KEY,
  applySlippageHaircut,
  compileCompose,
  composeCanUnblockEligibility,
  composeEnterSteps,
  ComposeValidationError,
  resolveComposePriceUsdc,
  selectComposeTargetAsset,
  setComposeDependenciesForTests
} from "./compose.js";
export type { ComposeEnterResult, ComposeServiceDependencies } from "./compose.js";
export {
  executableQuoteToSimulateGroup,
  resolveSimulatePriceUsdc,
  setSimulateDependenciesForTests,
  simulateCompiledGroups,
  simulateQuotesForPlan,
  SimulateValidationError
} from "./simulate.js";
export type { SimulateServiceDependencies } from "./simulate.js";
export {
  resolvePolicyValidatePriceUsdc,
  setPolicyDependenciesForTests,
  validatePolicy,
  PolicyValidationError
} from "./policy.js";
export type { PolicyServiceDependencies } from "./policy.js";
export {
  PRECISION_DEFAULT_DECIMALS,
  PRECISION_MAX_DECIMALS,
  formatDecimalForAgent,
  formatOpportunitiesForAgent,
  formatOpportunityForAgent
} from "./precision.js";
export {
  attachExecutionShapesToOpportunities,
  attachExecutionShapesToOpportunity
} from "./opportunity-execution-shapes.js";
export {
  attachHistoryStability,
  computeHistoryStability,
  historySnapshotsFromOpportunities,
  loadOpportunityHistory,
  recordOpportunitySnapshots,
  resetOpportunityHistoryForTests,
  setOpportunityHistoryPointsForTests,
  setOpportunityHistoryStoreForTests,
  shouldSnapshotOpportunityYield,
  stabilityConstraintPenalty,
  useMemoryOpportunityHistoryForTests
} from "./opportunity-history.js";
export type { HistorySnapshotInput, OpportunityHistoryStore } from "./opportunity-history.js";
export {
  attachOpportunityRisk,
  compareOpportunitiesByRiskThenYield,
  confidenceFromAgeMs,
  emptyWalletHealthFactorIndex,
  finalizeOpportunityRisk,
  indexHealthFactorsFromPositions,
  loadWalletHealthFactors,
  resolveWalletHealthFactor,
  riskConstraintPenalty,
  setWalletHealthFactorLoaderForTests,
  tinymanVolatilityRisk,
  utilizationFromBalances
} from "./opportunity-risk.js";
export {
  rankOpportunities,
  rankOpportunitiesByApy
} from "./opportunity-ranking.js";
export {
  attachExecutionShapesToPositions,
  attachExecutionShapesToPosition
} from "./position-execution-shapes.js";
export type { PositionMarketRecord } from "./position-execution-shapes.js";
export {
  FALLBACK_IDENTIFIERS_NOTE,
  SOURCE_TIMESTAMP_FETCH_PROXY_NOTE,
  buildSourceMetadata,
  resolveSourceTimestamp,
  unixSecondsToIsoTimestamp
} from "./source-metadata.js";
export type {
  BuildSourceMetadataInput,
  SourceMetadataFields,
  SourceTimestampOrigin
} from "./source-metadata.js";
export {
  CONSENSUS_BLOCKS_PER_YEAR,
  CONSENSUS_BONUS_BASE_MICRO_ALGOS,
  CONSENSUS_BONUS_DECAY_INTERVAL,
  CONSENSUS_PAYOUT_FEE_PERCENT,
  DEFAULT_BLOCK_SAMPLE_SIZE,
  ConsensusStakingAprError,
  computeConsensusApr,
  computeDecayedBonusMicroAlgos,
  estimateConsensusStakingApr,
  setConsensusStakingAprDependenciesForTests
} from "./consensus-staking-apr.js";
export type {
  ConsensusStakingAprDependencies,
  ConsensusStakingAprEstimate
} from "./consensus-staking-apr.js";
export {
  HaystackRouterError,
  createHaystackService,
  DEFAULT_DISABLED_HAYSTACK_PROTOCOLS
} from "./haystack-router.js";
export type {
  HaystackErrorKind,
  HaystackService
} from "./haystack-router.js";
export {
  DEFAULT_FOLKS_QUOTE_TTL_MS,
  FOLKS_ROUTER_DEFAULT_FEE_BPS,
  FOLKS_ROUTER_FEE_DISCOUNT_TIERS,
  FOLKS_ROUTER_MAINNET_APP_ID,
  FOLKS_ROUTER_TESTNET_APP_ID,
  FOLKS_ROUTER_V2_MAINNET_API_BASE,
  FOLKS_ROUTER_V2_TESTNET_API_BASE,
  FolksRouterError,
  assertFolksRouterV2BaseUrl,
  createFolksRouterService,
  folksRouterAppId,
  folksRouterV2ApiBase,
  inferFolksRouteKind,
  percentSlippageToFolksBps
} from "./folks-router.js";
export type {
  FolksRouterAlgod,
  FolksRouterErrorKind,
  FolksRouterSdk,
  FolksRouterService
} from "./folks-router.js";
export {
  FEE_HARVEST_RECIPIENT_A,
  FEE_HARVEST_RECIPIENT_B,
  FEE_HARVEST_RECIPIENT_C,
  FEE_HARVEST_RECIPIENTS,
  buildFeeHarvestNote,
  floorToWholeUsdcMicro,
  formatUsdcFromMicro,
  runFeeHarvest,
  splitFeeHarvestWholeUsdc
} from "./fee-harvest.js";
export type {
  FeeHarvestOptions,
  FeeHarvestResult,
  FeeHarvestSplit,
  FeeHarvestStatus,
  FeeHarvestTransferResult
} from "./fee-harvest.js";
