/** Mainnet Circle USDC. Mallow posts perps margin in this asset. */
export const MALLOW_USDC_ASSET_ID = 31566704;

/** Mallow's position-builder fee. PEX caps builder fees at 10 bps. */
export const MALLOW_BUILDER_FEE_BPS = 3n;

export const MALLOW_PDEX_PROXY_URL_DEFAULT = "https://mallow-api.kierantnelson.workers.dev/pdex";

/** Published PEX oracle and price artifacts. The proxied latest-price snapshot lags. */
export const MALLOW_PDEX_ARTIFACT_URL_DEFAULT =
  "https://pub-1e72beea87f04ebfafce248132310425.r2.dev/mainnet";

export const MALLOW_OPEN_LIMIT_SHAPE_KEY = "mainnet:mallow:v1:openLimit:attached";
export const MALLOW_USDC_OPT_IN_SHAPE_KEY = "mainnet:mallow:v1:optIn:usdc";

export const MALLOW_MARKETS = ["ALGO", "BTC"] as const;

export type MallowMarketSymbol = (typeof MALLOW_MARKETS)[number];
export type MallowSide = "long" | "short";
