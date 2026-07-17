import { OpportunityMarketRecord } from "../types/opportunity.js";
import { rankOpportunitiesByApy } from "./opportunity-ranking.js";

export function selectPersonalizedOpportunities(
  opportunities: readonly OpportunityMarketRecord[],
  heldAssetIds: ReadonlySet<number>,
  limit: number
): OpportunityMarketRecord[] {
  const matched = opportunities.filter((opportunity) =>
    (opportunity.assetIds ?? []).some((assetId) => heldAssetIds.has(assetId))
  );

  return rankOpportunitiesByApy(matched).slice(0, Math.max(0, limit));
}
