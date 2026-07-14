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
  setAccountAssetsDependenciesForTests,
  AccountAssetsError
} from "./account-assets.js";
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
export { selectPersonalizedOpportunities } from "./personalized-opportunities.js";
export {
  PRECISION_DEFAULT_DECIMALS,
  PRECISION_MAX_DECIMALS,
  formatDecimalForAgent,
  formatOpportunitiesForAgent,
  formatOpportunityForAgent
} from "./precision.js";
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
