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
  createHaystackService
} from "./haystack-router.js";
export type {
  HaystackErrorKind,
  HaystackService
} from "./haystack-router.js";
