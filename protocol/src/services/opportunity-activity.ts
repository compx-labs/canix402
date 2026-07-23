import type { OpportunityMarketRecord } from "../types/opportunity.js";

/**
 * When `includeInactive` is false (default), drop opportunities that explicitly
 * report they are not accepting stake (`capacity.acceptingStake === false`).
 * Opportunities without capacity metadata are treated as active.
 */
export function filterOpportunitiesByActivity(
  opportunities: readonly OpportunityMarketRecord[],
  includeInactive: boolean
): OpportunityMarketRecord[] {
  if (includeInactive) {
    return [...opportunities];
  }
  return opportunities.filter(
    (opportunity) => opportunity.capacity?.acceptingStake !== false
  );
}
