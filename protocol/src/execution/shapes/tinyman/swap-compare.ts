/**
 * Tinyman-only swap path comparison.
 *
 * The Swap Router is Tinyman-pool only (not a cross-DEX aggregator). This
 * helper compares a router quote against the single-pool Tinyman path and
 * picks the better net return. Cross-router compare (Haystack / HOGSWAP /
 * Pact / Folks) belongs to the meta-quote ticket.
 */

export type TinymanSwapType = "fixed-input" | "fixed-output";
export type TinymanSwapPath = "router" | "direct";

export type TinymanSwapFallbackReason =
  | "single-pool-better"
  | "router-unavailable"
  | "no-single-pool"
  | "tied-prefer-single-pool";

export interface TinymanSwapCandidate {
  path: TinymanSwapPath;
  hopCount: number;
  expectedIn: bigint;
  expectedOut: bigint;
  /** Slippage floor for fixed-input; exact output for fixed-output. */
  minOut: bigint;
  /** Exact input for fixed-input; slippage ceiling for fixed-output. */
  maxIn: bigint;
  networkFeeMicroAlgos: bigint;
  priceImpact?: number;
}

export interface TinymanSwapSelection {
  winner: TinymanSwapPath;
  fallbackReason?: TinymanSwapFallbackReason;
}

/**
 * Unique Tinyman pool count from a Swap Router API payload.
 * `pool_mapping` is the canonical hop list; swap-app accounts are a fallback.
 */
export function hopCountFromRouter(route: {
  pool_mapping?: readonly (readonly string[])[];
  transactions?: readonly { type?: string; accounts?: readonly string[] }[];
}): number {
  const pools = new Set<string>();
  for (const row of route.pool_mapping ?? []) {
    for (const address of row) {
      if (typeof address === "string" && address.length > 0) {
        pools.add(address);
      }
    }
  }
  if (pools.size > 0) {
    return pools.size;
  }
  for (const txn of route.transactions ?? []) {
    if (txn.type !== "appl") continue;
    for (const account of txn.accounts ?? []) {
      if (account.length > 0) pools.add(account);
    }
  }
  return Math.max(pools.size, 1);
}

/**
 * Pick the Tinyman path with the better net return.
 *
 * Fixed-input: higher expected out, then higher min-out, then lower network fee.
 * Fixed-output: lower expected in, then lower max-in, then lower network fee.
 * Ties prefer the single-pool path (fewer outer transactions).
 */
export function selectTinymanSwapWinner(
  swapType: TinymanSwapType,
  router: TinymanSwapCandidate | undefined,
  direct: TinymanSwapCandidate | undefined
): TinymanSwapSelection {
  if (router === undefined && direct === undefined) {
    throw new Error("Cannot select a Tinyman swap path without a router or single-pool quote.");
  }
  if (router === undefined) {
    return { winner: "direct", fallbackReason: "router-unavailable" };
  }
  if (direct === undefined) {
    return { winner: "router", fallbackReason: "no-single-pool" };
  }

  const routerBetter = isRouterStrictlyBetter(swapType, router, direct);
  if (routerBetter) {
    return { winner: "router" };
  }

  const tied = isTie(swapType, router, direct);
  return {
    winner: "direct",
    fallbackReason: tied ? "tied-prefer-single-pool" : "single-pool-better"
  };
}

function isRouterStrictlyBetter(
  swapType: TinymanSwapType,
  router: TinymanSwapCandidate,
  direct: TinymanSwapCandidate
): boolean {
  if (swapType === "fixed-input") {
    if (router.expectedOut !== direct.expectedOut) {
      return router.expectedOut > direct.expectedOut;
    }
    if (router.minOut !== direct.minOut) {
      return router.minOut > direct.minOut;
    }
    return router.networkFeeMicroAlgos < direct.networkFeeMicroAlgos;
  }

  if (router.expectedIn !== direct.expectedIn) {
    return router.expectedIn < direct.expectedIn;
  }
  if (router.maxIn !== direct.maxIn) {
    return router.maxIn < direct.maxIn;
  }
  return router.networkFeeMicroAlgos < direct.networkFeeMicroAlgos;
}

function isTie(
  swapType: TinymanSwapType,
  router: TinymanSwapCandidate,
  direct: TinymanSwapCandidate
): boolean {
  if (swapType === "fixed-input") {
    return (
      router.expectedOut === direct.expectedOut &&
      router.minOut === direct.minOut &&
      router.networkFeeMicroAlgos === direct.networkFeeMicroAlgos
    );
  }
  return (
    router.expectedIn === direct.expectedIn &&
    router.maxIn === direct.maxIn &&
    router.networkFeeMicroAlgos === direct.networkFeeMicroAlgos
  );
}
