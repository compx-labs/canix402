/**
 * Recorded HOGSWAP payloads for LP valuation tests.
 * Captured from hogswap-v1.liquihog.dev (no live calls in CI).
 */

export const HOGSWAP_FIXTURE_STAMM_LP_ASSET_ID = 3544790059;
export const HOGSWAP_FIXTURE_ALGOFI_LP_ASSET_ID = 605975979;
export const HOGSWAP_FIXTURE_HUMBLE_LP_ASSET_ID = 1090000001;
export const HOGSWAP_FIXTURE_TINYMAN_LP_ASSET_ID = 1001;
export const HOGSWAP_FIXTURE_PACT_LP_ASSET_ID = 620996279;
export const HOGSWAP_FIXTURE_NULL_LP_ASSET_ID = 3544790999;

export const hogswapStammLpValuation = {
  asset_id: HOGSWAP_FIXTURE_STAMM_LP_ASSET_ID,
  pool_id: 3544790053,
  dex_kind: 1,
  dex_name: "STAMM",
  tier_index: 1,
  asset_a: 0,
  asset_b: 3178895177,
  pool_tvl_usd_micro: 12918306607,
  tvl_confidence_bps: 8801,
  as_of_round: 64722055,
  lp_supply: 31736614915,
  lp_decimals: 6,
  reserve_a_micro: 53037026667,
  reserve_b_micro: 19347221619,
  per_lp_asset_a_micro: 1671162,
  per_lp_asset_b_micro: 609618,
  value_per_lp_usd_micro: 303238,
  amount: 1000000,
  value_usd_micro: 303238,
  redeemable_asset_a_micro: 1671162,
  redeemable_asset_b_micro: 609618
};

export const hogswapAlgofiLpValuation = {
  asset_id: HOGSWAP_FIXTURE_ALGOFI_LP_ASSET_ID,
  pool_id: 605929989,
  dex_kind: 4,
  dex_name: "AlgoFi CP",
  tier_index: null,
  asset_a: 0,
  asset_b: 312769,
  pool_tvl_usd_micro: 7773573167,
  tvl_confidence_bps: 9770,
  as_of_round: 64722055,
  lp_supply: 7342962938,
  lp_decimals: 6,
  reserve_a_micro: 42958910336,
  reserve_b_micro: 3882623849,
  per_lp_asset_a_micro: 5850350,
  per_lp_asset_b_micro: 528754,
  value_per_lp_usd_micro: 1058638,
  amount: 1000000,
  value_usd_micro: 1058638,
  redeemable_asset_a_micro: 5850350,
  redeemable_asset_b_micro: 528754
};

export const hogswapHumbleLpValuation = {
  asset_id: HOGSWAP_FIXTURE_HUMBLE_LP_ASSET_ID,
  pool_id: 1090000000,
  dex_kind: 5,
  dex_name: "Humble",
  tier_index: null,
  asset_a: 0,
  asset_b: 312769,
  pool_tvl_usd_micro: 2500000000,
  tvl_confidence_bps: 8000,
  as_of_round: 64722055,
  lp_supply: 5000000000,
  lp_decimals: 6,
  reserve_a_micro: 1200000000,
  reserve_b_micro: 800000000,
  per_lp_asset_a_micro: 240000,
  per_lp_asset_b_micro: 160000,
  value_per_lp_usd_micro: 500000,
  amount: 2000000,
  value_usd_micro: 1000000,
  redeemable_asset_a_micro: 480000,
  redeemable_asset_b_micro: 320000
};

export const hogswapNullSupplyLpValuation = {
  asset_id: HOGSWAP_FIXTURE_NULL_LP_ASSET_ID,
  pool_id: 3544790053,
  dex_kind: 1,
  dex_name: "STAMM",
  tier_index: 0,
  asset_a: 0,
  asset_b: 3178895177,
  pool_tvl_usd_micro: null,
  tvl_confidence_bps: 0,
  as_of_round: 64722055,
  lp_supply: null,
  lp_decimals: 6,
  reserve_a_micro: null,
  reserve_b_micro: null,
  per_lp_asset_a_micro: null,
  per_lp_asset_b_micro: null,
  value_per_lp_usd_micro: null,
  amount: 1000000,
  value_usd_micro: null,
  redeemable_asset_a_micro: null,
  redeemable_asset_b_micro: null
};

export const hogswapStammPoolsFixture = {
  pools: [
    {
      pool_id: 3544790053,
      dex_kind: 1,
      dex_name: "STAMM",
      asset_a: 0,
      asset_b: 3178895177,
      lp_asset_id: null,
      tier_breakdown: [
        {
          index: 0,
          lp_asset_id: HOGSWAP_FIXTURE_NULL_LP_ASSET_ID,
          lp_decimals: 6,
          lp_supply: null
        },
        {
          index: 1,
          lp_asset_id: HOGSWAP_FIXTURE_STAMM_LP_ASSET_ID,
          lp_decimals: 6,
          lp_supply: 31736614915
        }
      ]
    }
  ]
};

export const hogswapPoolsPage1 = {
  pools: [
    {
      pool_id: 605929989,
      dex_kind: 4,
      dex_name: "AlgoFi CP",
      asset_a: 0,
      asset_b: 312769,
      lp_asset_id: HOGSWAP_FIXTURE_ALGOFI_LP_ASSET_ID
    },
    {
      pool_id: 1070000001,
      dex_kind: 2,
      dex_name: "Tinyman v2",
      asset_a: 0,
      asset_b: 312769,
      lp_asset_id: HOGSWAP_FIXTURE_TINYMAN_LP_ASSET_ID
    }
  ],
  next_cursor: "page2"
};

export const hogswapPoolsPage2 = {
  pools: [
    {
      pool_id: 620995314,
      dex_kind: 3,
      dex_name: "Pact CP",
      asset_a: 0,
      asset_b: 312769,
      lp_asset_id: HOGSWAP_FIXTURE_PACT_LP_ASSET_ID
    },
    {
      pool_id: 1090000000,
      dex_kind: 5,
      dex_name: "Humble",
      asset_a: 0,
      asset_b: 312769,
      lp_asset_id: HOGSWAP_FIXTURE_HUMBLE_LP_ASSET_ID
    }
  ],
  next_cursor: null
};

export const hogswapAnalyticsPricesFixture = {
  algo_usd: 0.09,
  as_of_round: 64722055,
  as_of_ts: 1756980000,
  prices: {
    "0": { price_algo: 1, price_usd: 0.09, confidence_bps: 9900 },
    "3178895177": { price_algo: 0.36, price_usd: 0.032, confidence_bps: 8800 }
  }
};
