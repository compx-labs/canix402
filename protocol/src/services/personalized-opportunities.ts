import type { OpportunityMarketRecord } from "../types/opportunity.js";
import {
  evaluateOpportunityEligibility,
  matchesPersonalizedFromEligibility,
  type EligibilityHoldings
} from "./eligibility.js";

export type PersonalizedHoldings = EligibilityHoldings;

/**
 * Soft-match opportunities to a wallet using the same eligibility rules as
 * POST /eligibility.
 *
 * Base rule: opportunity `assetIds` intersect held assets.
 * When `entryRequirements` / `capacity` are present (Réti-first):
 * - exclude when not accepting stake (unless includeInactive)
 * - require minAmount and checkable ASA gates
 * - exclude unresolved NFD/creator gates — never guess eligibility
 * Ranking is not a substitute for POST /eligibility; quote-time checks remain
 * authoritative.
 */
export function selectPersonalizedOpportunities(
  opportunities: readonly OpportunityMarketRecord[],
  heldAssetIdsOrHoldings: ReadonlySet<number> | PersonalizedHoldings,
  limit: number,
  options: { includeInactive?: boolean } = {}
): OpportunityMarketRecord[] {
  const holdings = normalizeHoldings(heldAssetIdsOrHoldings);
  const includeInactive = options.includeInactive === true;

  const matched = opportunities.filter((opportunity) =>
    matchesPersonalizedOpportunity(opportunity, holdings, { includeInactive })
  );

  matched.sort((a, b) => {
    const aAccept = a.capacity?.acceptingStake === true ? 1 : 0;
    const bAccept = b.capacity?.acceptingStake === true ? 1 : 0;
    if (aAccept !== bAccept) {
      return bAccept - aAccept;
    }
    const aSlots = a.capacity?.stakerSlotsRemaining ?? -1;
    const bSlots = b.capacity?.stakerSlotsRemaining ?? -1;
    if (aSlots !== bSlots) {
      return bSlots - aSlots;
    }
    return b.apy - a.apy;
  });

  return matched.slice(0, Math.max(0, limit));
}

function normalizeHoldings(
  value: ReadonlySet<number> | PersonalizedHoldings
): PersonalizedHoldings {
  if (typeof value === "object" && value !== null && "heldAssetIds" in value) {
    return value;
  }
  return { heldAssetIds: value };
}

export function matchesPersonalizedOpportunity(
  opportunity: OpportunityMarketRecord,
  holdings: PersonalizedHoldings,
  options: { includeInactive?: boolean } = {}
): boolean {
  const eligibility = evaluateOpportunityEligibility(
    opportunity,
    opportunity.opportunityId,
    holdings
  );
  return matchesPersonalizedFromEligibility(
    opportunity,
    eligibility,
    holdings,
    options
  );
}
