import type { FolksSwapQuote } from "../../src/types/swap-schema.js";
import {
  FOLKS_ROUTER_FEE_DISCOUNT_TIERS,
  FOLKS_ROUTER_MAINNET_APP_ID
} from "../../src/services/folks-router.js";

export const FOLKS_ROUTER_FIXTURE_ADDRESS =
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";
export const FOLKS_ROUTER_USDC_ASSET_ID = 31_566_704;
export const FOLKS_ROUTER_GOLD_ASSET_ID = 246_516_580;
export const FOLKS_ROUTER_FIXTURE_NOW_MS = Date.UTC(2026, 8, 7, 12, 0, 0);

export const FOLKS_ROUTER_ALGO_USDC_QUOTE = {
  quoteAmount: 184_250n,
  priceImpact: 0.00041,
  microalgoTxnsFee: 5_000,
  txnPayload: "algo-usdc-fixed-input-v2-payload"
};

export const FOLKS_ROUTER_ALGO_USDC_UNSIGNED_GROUP = [
  "send-algo-to-router",
  "fi-end-swap-usdc"
];

export const FOLKS_ROUTER_MULTI_HOP_QUOTE = {
  quoteAmount: 185_400_000n,
  priceImpact: 0.0032,
  microalgoTxnsFee: 9_000,
  txnPayload: "gold-usdc-multi-hop-v2-payload"
};

export const FOLKS_ROUTER_MULTI_HOP_UNSIGNED_GROUP = [
  "send-gold-to-router",
  "swap-forward-gold-algo",
  "swap-forward-algo-usdc",
  "fi-end-swap-usdc"
];

export function folksRouterDiscountTiers() {
  return FOLKS_ROUTER_FEE_DISCOUNT_TIERS.map((tier) => ({
    minFolks: tier.minFolks,
    discountPercent: tier.discountPercent,
    ...("maxFolksExclusive" in tier ? { maxFolksExclusive: tier.maxFolksExclusive } : {})
  }));
}

export function folksRouterQuoteFixture(
  overrides: Partial<FolksSwapQuote> = {}
): FolksSwapQuote {
  const createdAt = FOLKS_ROUTER_FIXTURE_NOW_MS;
  return {
    source: "folks-router",
    apiVersion: "v2",
    routerAppId: String(FOLKS_ROUTER_MAINNET_APP_ID),
    address: FOLKS_ROUTER_FIXTURE_ADDRESS,
    fromAssetId: "0",
    toAssetId: String(FOLKS_ROUTER_USDC_ASSET_ID),
    amount: "1000000",
    type: "fixed-input",
    swapMode: "FIXED_INPUT",
    quotedAmount: FOLKS_ROUTER_ALGO_USDC_QUOTE.quoteAmount.toString(),
    createdAt: new Date(createdAt).toISOString(),
    expiresAt: new Date(createdAt + 30_000).toISOString(),
    requiredAppOptIns: [String(FOLKS_ROUTER_MAINNET_APP_ID)],
    txnPayload: FOLKS_ROUTER_ALGO_USDC_QUOTE.txnPayload,
    priceImpact: FOLKS_ROUTER_ALGO_USDC_QUOTE.priceImpact,
    microalgoTxnsFee: FOLKS_ROUTER_ALGO_USDC_QUOTE.microalgoTxnsFee,
    discount: {
      sender: FOLKS_ROUTER_FIXTURE_ADDRESS,
      userFeeDiscount: 10,
      applied: true,
      tiers: folksRouterDiscountTiers()
    },
    ...overrides
  };
}

export function folksRouterMultiHopQuoteFixture(
  overrides: Partial<FolksSwapQuote> = {}
): FolksSwapQuote {
  return folksRouterQuoteFixture({
    fromAssetId: String(FOLKS_ROUTER_GOLD_ASSET_ID),
    toAssetId: String(FOLKS_ROUTER_USDC_ASSET_ID),
    amount: "1000000000",
    quotedAmount: FOLKS_ROUTER_MULTI_HOP_QUOTE.quoteAmount.toString(),
    txnPayload: FOLKS_ROUTER_MULTI_HOP_QUOTE.txnPayload,
    priceImpact: FOLKS_ROUTER_MULTI_HOP_QUOTE.priceImpact,
    microalgoTxnsFee: FOLKS_ROUTER_MULTI_HOP_QUOTE.microalgoTxnsFee,
    ...overrides
  });
}
