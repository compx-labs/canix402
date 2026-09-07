import type { MetaRouterId, MetaSwapAlternative } from "../types/swap-schema.js";

export const META_SWAP_ROUTER_PRIORITY: Record<MetaRouterId, number> = {
  haystack: 0,
  hogswap: 1,
  "folks-router": 2,
  tinyman: 3,
  "pact-smart-router": 4,
  asastats: 5
};

export const DEFAULT_META_SWAP_SLIPPAGE_PERCENT = 1;
export const DEFAULT_META_SWAP_QUOTE_TIMEOUT_MS = 8_000;
export const DEFAULT_META_SWAP_QUOTE_TTL_MS = 30_000;

export type MetaSwapType = "fixed-input" | "fixed-output";

export interface MetaSwapScoreValues {
  expectedNetOut: bigint;
  minOut: bigint;
  expectedIn: bigint;
  maxIn: bigint;
  networkFeeMicroAlgos: bigint;
  feeAlreadyNetted: boolean;
}

export interface MetaSwapQuotedRoute {
  router: MetaRouterId;
  score: MetaSwapScoreValues;
  expiresAtMs: number;
  legs: unknown[];
  payload: unknown;
}

export function percentSlippageToBps(slippagePercent: number): number {
  if (!Number.isFinite(slippagePercent) || slippagePercent < 0) {
    return 0;
  }
  return Math.round(Math.min(slippagePercent, 100) * 100);
}

export function applyBpsHaircut(amount: bigint, bps: number): bigint {
  if (bps <= 0) {
    return amount;
  }
  if (bps >= 10_000) {
    return 0n;
  }
  return (amount * BigInt(10_000 - bps)) / 10_000n;
}

export function resolveQuoteSlippagePercent(slippage: number | undefined): number {
  if (slippage === undefined) {
    return DEFAULT_META_SWAP_SLIPPAGE_PERCENT;
  }
  if (!Number.isFinite(slippage) || slippage < 0 || slippage > 100) {
    throw new Error("Slippage must be a percentage between 0 and 100.");
  }
  return slippage;
}

/**
 * Best net return across quoted adapters.
 *
 * Fixed-input: higher expected out, then higher min-out, then lower network fee,
 * then stable router priority (Haystack first).
 * Fixed-output: lower expected in, then lower max-in, then lower network fee,
 * then the same priority list.
 */
export function selectMetaSwapWinner(
  swapType: MetaSwapType,
  routes: readonly MetaSwapQuotedRoute[]
): MetaSwapQuotedRoute {
  if (routes.length === 0) {
    throw new Error("Cannot select a swap winner without a quoted route.");
  }
  return [...routes].sort((left, right) => compareQuotedRoutes(swapType, left, right))[0]!;
}

export function compareQuotedRoutes(
  swapType: MetaSwapType,
  left: MetaSwapQuotedRoute,
  right: MetaSwapQuotedRoute
): number {
  if (swapType === "fixed-input") {
    if (left.score.expectedNetOut !== right.score.expectedNetOut) {
      return left.score.expectedNetOut > right.score.expectedNetOut ? -1 : 1;
    }
    if (left.score.minOut !== right.score.minOut) {
      return left.score.minOut > right.score.minOut ? -1 : 1;
    }
  } else {
    if (left.score.expectedIn !== right.score.expectedIn) {
      return left.score.expectedIn < right.score.expectedIn ? -1 : 1;
    }
    if (left.score.maxIn !== right.score.maxIn) {
      return left.score.maxIn < right.score.maxIn ? -1 : 1;
    }
  }
  if (left.score.networkFeeMicroAlgos !== right.score.networkFeeMicroAlgos) {
    return left.score.networkFeeMicroAlgos < right.score.networkFeeMicroAlgos ? -1 : 1;
  }
  return META_SWAP_ROUTER_PRIORITY[left.router] - META_SWAP_ROUTER_PRIORITY[right.router];
}

export function alternativeFromRoute(route: MetaSwapQuotedRoute): MetaSwapAlternative {
  return {
    router: route.router,
    status: "quoted",
    expectedNetOut: route.score.expectedNetOut.toString(),
    minOut: route.score.minOut.toString(),
    networkFeeMicroAlgos: route.score.networkFeeMicroAlgos.toString()
  };
}

export function serializeScore(score: MetaSwapScoreValues) {
  return {
    expectedNetOut: score.expectedNetOut.toString(),
    minOut: score.minOut.toString(),
    expectedIn: score.expectedIn.toString(),
    maxIn: score.maxIn.toString(),
    networkFeeMicroAlgos: score.networkFeeMicroAlgos.toString(),
    feeAlreadyNetted: score.feeAlreadyNetted
  };
}
