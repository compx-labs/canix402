/**
 * Recorded HOGSWAP `GET /stamm/pools` payload for adapter tests.
 * Captured from hogswap-v1.liquihog.dev (no live calls in CI).
 *
 * Live anchors (fixtures/docs only — never baked into execution shapes):
 * registry 3544666315, ALGO/HOG pool 3544790053, HOG 3178895177.
 */

export const STAMM_FIXTURE_FETCHED_AT = "2026-09-04T13:00:00.000Z";
export const STAMM_FIXTURE_POOL_APP_ID = 3544790053;
export const STAMM_FIXTURE_HOG_ASSET_ID = 3178895177;
export const STAMM_FIXTURE_TIER1_LP_ASSET_ID = 3544790059;
export const STAMM_FIXTURE_TVL_USD_MICRO = 12_999_732_079;
export const STAMM_FIXTURE_RESERVE_A_MICRO = 71_182_154_894n;
export const STAMM_FIXTURE_RESERVE_B_MICRO = 25_974_340_595n;
export const STAMM_FIXTURE_TIER1_RESERVE_A = 53_037_026_667n;

/** Recorded ALGO/HOG pool with six active fee tiers. */
export const stammAlgoHogPool = {
  pool_id: STAMM_FIXTURE_POOL_APP_ID,
  dex_kind: 1,
  dex_name: "STAMM",
  asset_a: 0,
  asset_b: STAMM_FIXTURE_HOG_ASSET_ID,
  lp_asset_id: null,
  tvl_usd_micro: STAMM_FIXTURE_TVL_USD_MICRO,
  reserve_a_micro: STAMM_FIXTURE_RESERVE_A_MICRO.toString(),
  reserve_b_micro: STAMM_FIXTURE_RESERVE_B_MICRO.toString(),
  tier_breakdown: [
    {
      index: 0,
      active: true,
      fee_bps: 3,
      lp_asset_id: 3544790057,
      lp_decimals: 6,
      lp_supply: 500169608,
      reserve_a: 881093835,
      reserve_b: 321109332
    },
    {
      index: 1,
      active: true,
      fee_bps: 10,
      lp_asset_id: STAMM_FIXTURE_TIER1_LP_ASSET_ID,
      lp_decimals: 6,
      lp_supply: 31736614915,
      reserve_a: STAMM_FIXTURE_TIER1_RESERVE_A.toString(),
      reserve_b: 19347221619
    },
    {
      index: 2,
      active: true,
      fee_bps: 30,
      lp_asset_id: 3544790061,
      lp_decimals: 6,
      lp_supply: 9401664228,
      reserve_a: 17202523217,
      reserve_b: 6283341095
    },
    {
      index: 3,
      active: true,
      fee_bps: 100,
      lp_asset_id: 3544790063,
      lp_decimals: 6,
      lp_supply: 7569583,
      reserve_a: 12709192,
      reserve_b: 4644255
    },
    {
      index: 4,
      active: true,
      fee_bps: 300,
      lp_asset_id: 3544790065,
      lp_decimals: 6,
      lp_supply: 3573702,
      reserve_a: 5828426,
      reserve_b: 2162944
    },
    {
      index: 5,
      active: true,
      fee_bps: 0,
      lp_asset_id: 3544790067,
      lp_decimals: 6,
      lp_supply: 25523224,
      reserve_a: 42973557,
      reserve_b: 15861350
    }
  ]
};

/** Synthetic pool used to assert inactive / missing-LP / empty-reserve drops. */
export const stammDropTiersPool = {
  pool_id: 3544790999,
  dex_kind: 1,
  dex_name: "STAMM",
  asset_a: 0,
  asset_b: STAMM_FIXTURE_HOG_ASSET_ID,
  lp_asset_id: null,
  tvl_usd_micro: 1_000_000_000,
  reserve_a_micro: "1000000",
  reserve_b_micro: "1000000",
  tier_breakdown: [
    {
      index: 0,
      active: false,
      fee_bps: 3,
      lp_asset_id: 3544791001,
      reserve_a: 500000,
      reserve_b: 500000
    },
    {
      index: 1,
      active: true,
      fee_bps: 10,
      lp_asset_id: null,
      reserve_a: 250000,
      reserve_b: 250000
    },
    {
      index: 2,
      active: true,
      fee_bps: 30,
      lp_asset_id: 3544791003,
      reserve_a: 0,
      reserve_b: 0
    }
  ]
};

export const stammPoolsFixture = {
  pools: [stammAlgoHogPool, stammDropTiersPool]
};

export const stammAssetsFixture = new Map([
  [
    0,
    {
      assetId: 0,
      unitName: "ALGO",
      name: "Algorand", // pragma: allowlist secret
      decimals: 6
    }
  ],
  [
    STAMM_FIXTURE_HOG_ASSET_ID,
    {
      assetId: STAMM_FIXTURE_HOG_ASSET_ID,
      unitName: "HOG",
      name: "HOG",
      decimals: 6
    }
  ]
]);
