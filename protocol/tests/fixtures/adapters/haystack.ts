import {
  HAYSTACK_STAKING_APP_ID,
  HAY_ASSET_ID,
  USDC_ASSET_ID,
  type HaystackPoolSnapshot
} from "../../../src/adapters/index.js";

export const HAYSTACK_FIXTURE_FETCHED_AT = "2026-07-22T00:00:00.000Z";
export const HAYSTACK_HAY_USD_PRICE = 0.02;

/** Recorded HaystackStaking global-state snapshot (app 3321763884). */
export function haystackPoolSnapshot(
  overrides: Partial<HaystackPoolSnapshot> = {}
): HaystackPoolSnapshot {
  return {
    appId: HAYSTACK_STAKING_APP_ID,
    hayAssetId: HAY_ASSET_ID,
    usdcAssetId: USDC_ASSET_ID,
    totalStaked: 1_000_000_000_000n,
    emaAprUsdc: 2_000_000n, // 2%
    emaAprHay: 50_000n, // 0.05%
    paused: false,
    ...overrides
  };
}

export const haystackPausedPool = haystackPoolSnapshot({ paused: true });
export const haystackEmptyStake = haystackPoolSnapshot({ totalStaked: 0n });
