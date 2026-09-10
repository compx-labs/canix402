/**
 * Recorded ASA Stats Smart Router wire shapes for adapter tests.
 * Shapes follow the open widgets contract (asastats/widgets runbook +
 * AsastatsAdapter tests). No live engine calls in CI.
 *
 * Amounts stay decimal strings so values above Number.MAX_SAFE_INTEGER survive.
 */

export const ASASTATS_FIXTURE_ADDRESS =
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";

/** Mainnet USDC ASA. */
export const ASASTATS_FIXTURE_USDC_ASSET_ID = 31_566_704; // pragma: allowlist secret

/** Current mainnet router application (Sep 2026). Redeployments change this. */
export const ASASTATS_FIXTURE_APP_ID = 3_692_588_382;

export const ASASTATS_FIXTURE_CREATED_AT_MS = 1_757_232_000_000;

/** `sell` ALGO → USDC, 1 ALGO in. `amount_out` is already net of the 5 bps skim. */
export const asaStatsSellAlgoUsdcQuotePayload = {
  amount_in: "1000000",
  amount_out: "248750",
  minimum_received: "247506",
  maximum_sent: "0",
  price_impact_pct: 0.08,
  route_label: "Tinyman v2",
  fees_total: 3000,
  value_usdc: 0.24875,
  // Opaque engine fields returned to router:group so it can rebuild the floor.
  allocation: {
    venues: ["tinyman-v2"],
    legs: [{ venue: "tinyman-v2", pool_id: 1001, weight_bps: 10000 }]
  }
};

/**
 * Multi-venue `sell` ALGO → USDC. One atomic group across Tinyman v2, Pact, and
 * STAMM (the venues the live router actually splits across).
 */
export const asaStatsMultiVenueQuotePayload = {
  amount_in: "5000000",
  amount_out: "1243125",
  minimum_received: "1236910",
  maximum_sent: "0",
  price_impact_pct: 0.19,
  route_label: "Tinyman v2, Pact, STAMM",
  fees_total: "9000",
  value_usdc: 1.243125,
  allocation: {
    venues: ["tinyman-v2", "pact", "stamm"],
    legs: [
      { venue: "tinyman-v2", pool_id: 1001, weight_bps: 4200 },
      { venue: "pact", pool_id: 2002, weight_bps: 3300 },
      { venue: "stamm", pool_id: 3003, weight_bps: 2500 }
    ]
  }
};

/** Mixed unsigned group: user legs + backend-signed quote authorization. */
export const asaStatsMixedGroupPayload = {
  transactions: ["dXNlcg==", "cHJvdG9jb2w=", "cXVvdGU="],
  quote_signer_index: 2,
  signed_transactions: { "2": "c2lnbmVkcXVvdGU=" },
  quote: asaStatsSellAlgoUsdcQuotePayload
};

export const asaStatsMultiVenueGroupPayload = {
  transactions: ["bGVnMQ==", "bGVnMg==", "bGVnMw==", "cXVvdGU="],
  quote_signer_index: 3,
  signed_transactions: { "3": "c2lnbmVkcXVvdGU=" },
  quote: asaStatsMultiVenueQuotePayload
};
