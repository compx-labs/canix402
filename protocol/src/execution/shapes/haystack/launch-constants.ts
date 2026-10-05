/** Mainnet HayLaunch application. Verified against hay.app and app global state. */
export const HAYSTACK_LAUNCH_APP_ID = 3_452_678_093;

/** Fixed-point scale used by HayLaunch prices and the price multiplier. */
export const HAYSTACK_LAUNCH_SCALE = 1_000_000_000n;

/** Default list window when `launchedAfter` is omitted. */
export const HAYSTACK_LAUNCH_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

/** In-memory cache for one decoded launch window. */
export const HAYSTACK_LAUNCH_LIST_CACHE_MS = 30_000;

export const HAYSTACK_LAUNCH_DEFAULT_LIMIT = 25;
export const HAYSTACK_LAUNCH_MAX_LIMIT = 100;

/** Launch page cap. The contract minimum is the `bondingUsd` global (currently $2,500). */
export const HAYSTACK_LAUNCH_MAX_TARGET_MICRO_USD = 500_000_000_000n;

export const HAYSTACK_LAUNCH_MIN_MULTIPLIER = 5n * HAYSTACK_LAUNCH_SCALE;
export const HAYSTACK_LAUNCH_MAX_MULTIPLIER = 250n * HAYSTACK_LAUNCH_SCALE;

/**
 * Routed buys that would take this share of remaining real reserves are refused.
 * The completing buy has to be a direct payment in the bonding asset.
 */
export const ROUTED_BUY_RESERVE_NUMERATOR = 9n;
export const ROUTED_BUY_RESERVE_DENOMINATOR = 10n;

/** Ceiling passed to fee coverage for launch and direct-buy app calls. */
export const HAYSTACK_LAUNCH_APP_CALL_MAX_FEE = 40_000n;

/** ARC-4 return log prefix. A 12-byte log is this prefix plus a uint64. */
export const ABI_RETURN_LOG_PREFIX = "151f7c75";

export const HAYSTACK_LAUNCH_TOKEN_SHAPE_KEY = "mainnet:haystack:v1:launch:token";
export const HAYSTACK_BUY_BONDING_SHAPE_KEY = "mainnet:haystack:v1:buy:bonding";

export const LAUNCH_FIELD_BYTES = {
  symbol: 8,
  name: 32,
  assetUrl: 96,
  description: 1024,
  socialWebsite: 256,
  socialX: 64,
  socialTelegram: 64,
  socialDiscord: 64
} as const;

/** `bondingOn` values written by HayLaunch. */
export const BONDING_ON_CURVE = 0;
export const BONDING_ON_PACT_V1 = 2;
export const BONDING_ON_PACT_V2 = 3;
