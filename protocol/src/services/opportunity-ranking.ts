import { OpportunityMarketRecord } from "../types/opportunity.js";
import { compareOpportunitiesByRiskThenYield } from "./opportunity-risk.js";

/**
 * Rank opportunities with designed risk constraints before raw APY.
 * Equal-risk rows still sort by APY descending, then TVL descending.
 */
export function rankOpportunities(
  data: readonly OpportunityMarketRecord[],
  now: Date = new Date()
): OpportunityMarketRecord[] {
  return [...data].sort((left, right) =>
    compareOpportunitiesByRiskThenYield(left, right, now)
  );
}

/** @deprecated Use {@link rankOpportunities}. Kept as the historical export name. */
export function rankOpportunitiesByApy(
  data: readonly OpportunityMarketRecord[],
  now: Date = new Date()
): OpportunityMarketRecord[] {
  return rankOpportunities(data, now);
}
