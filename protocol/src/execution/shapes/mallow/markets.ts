import type { MallowMarketSymbol } from "./constants.js";

export interface ListedPairMarket {
  singleToken: boolean;
  symbol: string;
  baseSymbol: string;
}

/**
 * Pair markets only. Prefer the exact `BASE/USD` symbol when PEX lists more
 * than one market for the same base.
 */
export function selectMallowMarket<T extends ListedPairMarket>(
  markets: readonly T[],
  base: MallowMarketSymbol
): T | undefined {
  const upper = base.toUpperCase();
  const matches = markets.filter((market) => {
    if (market.singleToken) {
      return false;
    }
    const symbol = market.symbol.toUpperCase();
    return (
      symbol === `${upper}/USD` ||
      market.baseSymbol.toUpperCase() === upper ||
      symbol.startsWith(`${upper}/`)
    );
  });
  return matches.find((market) => market.symbol.toUpperCase() === `${upper}/USD`) ?? matches[0];
}
