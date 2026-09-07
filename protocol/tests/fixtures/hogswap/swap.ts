/**
 * Recorded HOGSWAP SWAP quote payloads (hogswap-v1.liquihog.dev).
 * Numbers are snapshots for fixtures — CI does not call live quote/execute.
 */

/** Mainnet USDC ASA. */
export const HOGSWAP_FIXTURE_USDC_ASSET_ID = 31_566_704; // pragma: allowlist secret

/** Mainnet Meld Gold ASA (ASA→ASA fixture pair with USDC). */
export const HOGSWAP_FIXTURE_GOLD_ASSET_ID = 246_516_580;

/**
 * Fixture-only router id from a recorded /execute.
 * Shapes must read router_app_id from the live execute response.
 */
export const HOGSWAP_FIXTURE_ROUTER_APP_ID = 3_586_571_385;

export const hogswapAlgoUsdcQuotePayload = {
  quote_id: "q-algo-usdc-fixture",
  mode: "SWAP",
  asset_in: 0,
  asset_out: HOGSWAP_FIXTURE_USDC_ASSET_ID,
  amount_in: 1_000_000,
  expected_out: 94_738,
  expected_out_robust: 94_643,
  min_out_at_slippage: 94_169,
  slippage_bps: 50,
  legs: [
    {
      pool_id: 2_757_544_466,
      dex_kind: 3,
      dex_name: "Pact CP",
      asset_in: 0,
      asset_out: 452_399_768,
      planned_in: 1_000_000,
      planned_out: 6_531_164
    },
    {
      pool_id: 1_075_409_914,
      dex_kind: 3,
      dex_name: "Pact CP",
      asset_in: 452_399_768,
      asset_out: HOGSWAP_FIXTURE_USDC_ASSET_ID,
      planned_in: 6_531_164,
      planned_out: 94_785
    }
  ],
  path_breakdown: [
    {
      assets: [0, 452_399_768, HOGSWAP_FIXTURE_USDC_ASSET_ID],
      input_amount: 1_000_000,
      output_amount: 94_785
    }
  ],
  network_fee_microalgo: 19_000,
  cover_algo_fee: false,
  cover_algo_fee_strategy: null,
  efficiency_loss_bps: 0,
  n_outers: 4,
  requested_out: null,
  max_in_at_slippage: null,
  deposits: [],
  lp: null,
  router_fee_bps_nominal: 5,
  router_fee_bps_effective: 5,
  router_fee_amount: 47,
  router_fee_amount_undiscounted: 47,
  router_fee_asset: HOGSWAP_FIXTURE_USDC_ASSET_ID,
  hog_holdings_micro: null,
  hog_discount_pct: null
};

export const hogswapGoldUsdcQuotePayload = {
  quote_id: "q-gold-usdc-fixture",
  mode: "SWAP",
  asset_in: HOGSWAP_FIXTURE_GOLD_ASSET_ID,
  asset_out: HOGSWAP_FIXTURE_USDC_ASSET_ID,
  amount_in: 1_000_000,
  expected_out: 129_668_838,
  expected_out_robust: 129_489_821,
  min_out_at_slippage: 128_842_371,
  slippage_bps: 50,
  legs: [
    {
      pool_id: 1_106_522_659,
      dex_kind: 2,
      dex_name: "Tinyman v2",
      asset_in: HOGSWAP_FIXTURE_GOLD_ASSET_ID,
      asset_out: 0,
      planned_in: 577_928,
      planned_out: 794_135_514
    },
    {
      pool_id: 605_929_989,
      dex_kind: 4,
      dex_name: "AlgoFi CP",
      asset_in: 0,
      asset_out: HOGSWAP_FIXTURE_USDC_ASSET_ID,
      planned_in: 24_816_734,
      planned_out: 2_344_107
    }
  ],
  path_breakdown: [
    {
      assets: [HOGSWAP_FIXTURE_GOLD_ASSET_ID, 0, HOGSWAP_FIXTURE_USDC_ASSET_ID],
      input_amount: 577_928,
      output_amount: 74_979_482
    }
  ],
  network_fee_microalgo: 100_000,
  cover_algo_fee: false,
  cover_algo_fee_strategy: null,
  deposits: [],
  lp: null,
  router_fee_bps_nominal: 5,
  router_fee_bps_effective: 5,
  router_fee_amount: 64_866,
  router_fee_amount_undiscounted: 64_866,
  router_fee_asset: HOGSWAP_FIXTURE_USDC_ASSET_ID,
  hog_holdings_micro: null,
  hog_discount_pct: null
};

export const hogswapAlgoUsdcExecutePayload = {
  quote_id: "q-algo-usdc-fixture",
  unsigned_group: [] as Array<{ txn_b64: string; description: string }>,
  router_app_id: HOGSWAP_FIXTURE_ROUTER_APP_ID,
  group_id_b64: "gid-algo-usdc",
  asset_in: 0,
  asset_out: HOGSWAP_FIXTURE_USDC_ASSET_ID,
  amount_in: 1_000_000,
  min_out_at_slippage: 94_169,
  network_fee_microalgo: 19_000,
  notes: ["unsigned; never broadcast"]
};
