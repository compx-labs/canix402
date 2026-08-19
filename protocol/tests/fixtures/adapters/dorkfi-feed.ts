import { USDC_ASSET_ID } from "../../../src/execution/shapes/haystack/constants.js";

/** Network label used by the Dork.fi feed for native-chain rows. */
export const DORKFI_NATIVE_NETWORK = "Algorand"; // pragma: allowlist secret

export const DORKFI_FIXTURE_FETCHED_AT = "2026-07-01T21:00:00.000Z";

export const dorkfiUsdcLending = {
  type: "lending",
  assetName: "USDC",
  apy: "6.06",
  tvl: "29846.609471",
  assetId: String(USDC_ASSET_ID),
  network: DORKFI_NATIVE_NETWORK,
  appId: "3333688282"
};

export const dorkfiForeignLending = {
  type: "lending",
  assetName: "VOI",
  apy: 1.2,
  tvl: 1000,
  assetId: 2320775407,
  network: "Voi Network",
  appId: "47139778"
};

export const dorkfiLendAlias = {
  type: "lend",
  assetName: "ALGO",
  apy: 3.1,
  tvl: 5000,
  assetId: 0,
  network: `${DORKFI_NATIVE_NETWORK.toLowerCase()}-mainnet`,
  appId: 111
};

export const dorkfiLiquidityAlias = {
  type: "liquidity-pool",
  assetName: "ALGO/USDC",
  apy: 8.2,
  tvl: 9000,
  assetId: USDC_ASSET_ID,
  network: DORKFI_NATIVE_NETWORK,
  appId: "222"
};

export const dorkfiStaking = {
  type: "staking",
  assetName: "TINY",
  apy: 2.4,
  tvl: 94.163392,
  assetId: "2200000000",
  network: DORKFI_NATIVE_NETWORK,
  appId: "3345940978"
};

export const dorkfiMissingApy = {
  type: "lending",
  assetName: "BAD",
  apy: null,
  tvl: 1000,
  assetId: 1,
  network: DORKFI_NATIVE_NETWORK,
  appId: "123"
};

export const dorkfiMissingAppId = {
  type: "lending",
  assetName: "USDC",
  apy: 1,
  tvl: 10,
  assetId: USDC_ASSET_ID,
  network: DORKFI_NATIVE_NETWORK
};

export const dorkfiUnknownType = {
  type: "vault",
  assetName: "USDC",
  apy: 1,
  tvl: 10,
  assetId: USDC_ASSET_ID,
  network: DORKFI_NATIVE_NETWORK,
  appId: "1"
};
