import { USDC_ASSET_ID } from "../../../src/execution/shapes/haystack/constants.js";

export const PACT_FIXTURE_FETCHED_AT = "2026-07-17T12:00:00.000Z";

export const pactAlgoUsdcLp = {
  on_chain_id: "1072843805",
  is_verified: true,
  apr_7d_all: "0.0875",
  apr_7d: "0.062",
  tvl_usd: "950000",
  primary_asset: { algoid: 0, unit_name: "ALGO", name: "ALGO" },
  secondary_asset: { algoid: USDC_ASSET_ID, unit_name: "USDC", name: "USD Coin" }
};

export const pactManagedWeightedLp = {
  on_chain_id: "3662410374",
  version: 201,
  pool_type: "MANAGED_WEIGHTED",
  is_verified: true,
  is_deprecated: false,
  apr_7d_all: "0.102641",
  apr_7d: "0.102641",
  tvl_usd: "111169.46830800",
  primary_asset: { on_chain_id: "0", unit_name: "ALGO", name: "Algorand" },
  secondary_asset: { on_chain_id: String(USDC_ASSET_ID), unit_name: "USDC", name: "USDC" }
};

export const pactDeprecatedPool = {
  on_chain_id: "2757488616",
  version: 100,
  pool_type: "CONST",
  is_verified: true,
  is_deprecated: true,
  apr_7d_all: "0.180527",
  apr_7d: "0.180527",
  tvl_usd: "57490.10313343",
  primary_asset: { on_chain_id: "0", unit_name: "ALGO" },
  secondary_asset: { on_chain_id: String(USDC_ASSET_ID), unit_name: "USDC" }
};

export const pactDeprecatedFarm = {
  on_chain_id: "legacy-farm",
  pool: "2757488616",
  apr: 0.2,
  average_apr: 0.22,
  tvl_usd: 50000
};

export const pactApr7dOnly = {
  id: 999,
  is_verified: true,
  apr_7d: 0.05,
  tvl_usd: 12000,
  primary_asset: { algoid: "0", unit_name: "ALGO" },
  secondary_asset: { algoid: String(USDC_ASSET_ID), unit_name: "USDC" }
};

export const pactMissingApy = {
  on_chain_id: "bad-1",
  apr_7d_all: null,
  tvl_usd: 100
};

export const pactMissingTvl = {
  on_chain_id: "bad-2",
  apr_7d_all: 0.1,
  tvl_usd: null
};

export const pactMissingIdentifiers = {
  apr_7d_all: 0.02,
  tvl_usd: 50
};

export const pactJoinedFarm = {
  on_chain_id: "3625283323",
  pool: "1072843805",
  apr: 0.12,
  average_apr: 0.14,
  tvl_usd: 300000
};

export const pactAverageAprOnlyFarm = {
  on_chain_id: "farm-avg-only",
  pool: "1072843805",
  apr: 0,
  average_apr: 0.08,
  tvl_usd: 1000
};

export const pactNoIncentivesFarm = {
  on_chain_id: "farm-zero",
  pool: "1072843805",
  apr: 0,
  average_apr: 0,
  tvl_usd: 1000
};

export const pactFarmTvlFallback = {
  on_chain_id: "farm-tvl-fallback",
  pool: "888",
  apr: 0.05,
  average_apr: 0.06,
  tvl_usd: 42000
};
