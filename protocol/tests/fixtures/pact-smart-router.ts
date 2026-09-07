import algosdk from "algosdk";

import { USDC_ASSET_ID } from "../../src/execution/shapes/haystack/constants.js";
import type { PactRouterHop, PactRouterPool } from "../../src/services/pact-smart-router.js";

/** Fixture-only Smart Router app id — not a live mainnet id. */
export const PACT_SMART_ROUTER_FIXTURE_APP_ID = 900_000_001;

export const PACT_SMART_ROUTER_ALGO_ID = 0;
export const PACT_SMART_ROUTER_USDC_ID = USDC_ASSET_ID;
/** Synthetic intermediate/output ASA for multi-hop fixtures. */
export const PACT_SMART_ROUTER_TOKEN_X_ID = 888_000_001;
export const PACT_SMART_ROUTER_TOKEN_Y_ID = 888_000_002;

export const PACT_FIXTURE_ALGO_USDC_POOL_APP_ID = 1_073_557_308;
export const PACT_FIXTURE_USDC_X_POOL_APP_ID = 2_000_000_001;
export const PACT_FIXTURE_X_Y_POOL_APP_ID = 2_000_000_002;
export const PACT_FIXTURE_ALGO_USDC_FEE_TIER_POOL_APP_ID = 1_073_557_399;

export const PACT_FIXTURE_ALGO_USDC_ESCROW = algosdk
  .getApplicationAddress(PACT_FIXTURE_ALGO_USDC_POOL_APP_ID)
  .toString();
export const PACT_FIXTURE_USDC_X_ESCROW = algosdk
  .getApplicationAddress(PACT_FIXTURE_USDC_X_POOL_APP_ID)
  .toString();
export const PACT_FIXTURE_X_Y_ESCROW = algosdk
  .getApplicationAddress(PACT_FIXTURE_X_Y_POOL_APP_ID)
  .toString();

export const pactSmartRouterSinglePool: PactRouterPool = {
  poolAppId: PACT_FIXTURE_ALGO_USDC_POOL_APP_ID,
  primaryAssetId: PACT_SMART_ROUTER_ALGO_ID,
  secondaryAssetId: PACT_SMART_ROUTER_USDC_ID,
  escrowAddress: PACT_FIXTURE_ALGO_USDC_ESCROW,
  feeBps: 30,
  tvlUsd: 1_000_000,
  verified: true
};

export const pactSmartRouterAlgoUsdcHighFee: PactRouterPool = {
  poolAppId: PACT_FIXTURE_ALGO_USDC_FEE_TIER_POOL_APP_ID,
  primaryAssetId: PACT_SMART_ROUTER_ALGO_ID,
  secondaryAssetId: PACT_SMART_ROUTER_USDC_ID,
  escrowAddress: PACT_FIXTURE_ALGO_USDC_ESCROW,
  feeBps: 100,
  tvlUsd: 100_000,
  verified: true
};

export const pactSmartRouterUsdcXPool: PactRouterPool = {
  poolAppId: PACT_FIXTURE_USDC_X_POOL_APP_ID,
  primaryAssetId: PACT_SMART_ROUTER_USDC_ID,
  secondaryAssetId: PACT_SMART_ROUTER_TOKEN_X_ID,
  escrowAddress: PACT_FIXTURE_USDC_X_ESCROW,
  feeBps: 30,
  tvlUsd: 400_000,
  verified: true
};

export const pactSmartRouterXYPool: PactRouterPool = {
  poolAppId: PACT_FIXTURE_X_Y_POOL_APP_ID,
  primaryAssetId: PACT_SMART_ROUTER_TOKEN_X_ID,
  secondaryAssetId: PACT_SMART_ROUTER_TOKEN_Y_ID,
  escrowAddress: PACT_FIXTURE_X_Y_ESCROW,
  feeBps: 30,
  tvlUsd: 200_000,
  verified: true
};

export const pactSmartRouterDiscoveryPools: PactRouterPool[] = [
  pactSmartRouterSinglePool,
  pactSmartRouterAlgoUsdcHighFee,
  pactSmartRouterUsdcXPool,
  pactSmartRouterXYPool
];

export function fixtureHop(params: {
  pool: PactRouterPool;
  fromAssetId: number;
  toAssetId: number;
  amountIn: bigint;
  amountOut: bigint;
}): PactRouterHop {
  return {
    poolAppId: params.pool.poolAppId,
    poolEscrowAddress: params.pool.escrowAddress ?? PACT_FIXTURE_ALGO_USDC_ESCROW,
    fromAssetId: params.fromAssetId,
    toAssetId: params.toAssetId,
    amountIn: params.amountIn,
    amountOut: params.amountOut,
    feeBps: params.pool.feeBps
  };
}
