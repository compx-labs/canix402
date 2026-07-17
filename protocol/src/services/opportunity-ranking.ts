import { OpportunityMarketRecord } from "../types/opportunity.js";

export function rankOpportunitiesByApy(
  data: readonly OpportunityMarketRecord[]
): OpportunityMarketRecord[] {
  return [...data].sort((left, right) => {
    const apyDelta = right.apy - left.apy;
    if (apyDelta !== 0) {
      return apyDelta;
    }

    return right.tvlUsd - left.tvlUsd;
  });
}
