import {
  ALPHA_ARCADE_STAKING_APP_ID,
  ALPHA_ASSET_ID,
  USDC_ASSET_ID,
  type AlphaArcadePoolSnapshot
} from "../../../src/adapters/index.js";

export const ALPHA_ARCADE_FIXTURE_FETCHED_AT = "2026-07-30T00:00:00.000Z";
export const ALPHA_ARCADE_ALPHA_USD_PRICE = 0.02;
export const ALPHA_ARCADE_WINDOW_DAYS = 7;
const ALPHA_ARCADE_APP_ADDRESS =
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";

/** Recorded ALPHA staking pool snapshot (app 3626756314). */
export function alphaArcadePoolSnapshot(
  overrides: Partial<AlphaArcadePoolSnapshot> = {}
): AlphaArcadePoolSnapshot {
  return {
    appId: ALPHA_ARCADE_STAKING_APP_ID,
    alphaAssetId: ALPHA_ASSET_ID,
    usdcAssetId: USDC_ASSET_ID,
    totalStaked: 1_000_000_000_000n, // 1M ALPHA
    appAddress: ALPHA_ARCADE_APP_ADDRESS,
    ...overrides
  };
}

export const alphaArcadeEmptyStake = alphaArcadePoolSnapshot({
  totalStaked: 0n
});
