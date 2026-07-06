export interface ServiceHealth {
  service: "canix402";
  status: "ok";
}

export {
  fetchHeldAssetIds,
  setAccountAssetsDependenciesForTests,
  AccountAssetsError
} from "./account-assets.js";
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
