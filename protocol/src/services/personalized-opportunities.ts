import type {
  OpportunityEntryGate,
  OpportunityMarketRecord
} from "../types/opportunity.js";

export interface PersonalizedHoldings {
  heldAssetIds: ReadonlySet<number>;
  /** Base-unit balances keyed by asset id (0 = ALGO). */
  balances?: ReadonlyMap<number, bigint>;
}

/**
 * Soft-match opportunities to a wallet.
 *
 * Base rule: opportunity `assetIds` intersect held assets.
 * When `entryRequirements` / `capacity` are present (Réti-first):
 * - exclude when not accepting stake
 * - require ALGO (or other) balance >= minAmount when balances are known
 * - for ASA gates with gateMatch any/all, require checkable ASA balances
 * - exclude when gates are only uncheckable (NFD/creator) — never guess eligibility
 */
export function selectPersonalizedOpportunities(
  opportunities: readonly OpportunityMarketRecord[],
  heldAssetIdsOrHoldings: ReadonlySet<number> | PersonalizedHoldings,
  limit: number
): OpportunityMarketRecord[] {
  const holdings = normalizeHoldings(heldAssetIdsOrHoldings);

  const matched = opportunities.filter((opportunity) =>
    matchesPersonalizedOpportunity(opportunity, holdings)
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
  holdings: PersonalizedHoldings
): boolean {
  const assetMatch = (opportunity.assetIds ?? []).some((assetId) =>
    holdings.heldAssetIds.has(assetId)
  );
  if (!assetMatch) {
    return false;
  }

  const capacity = opportunity.capacity;
  if (capacity !== undefined && capacity.acceptingStake === false) {
    return false;
  }

  const requirements = opportunity.entryRequirements;
  if (requirements === undefined) {
    return true;
  }

  if (requirements.minAmount !== undefined && holdings.balances !== undefined) {
    const balance = holdings.balances.get(requirements.minAmount.assetId) ?? 0n;
    let minAmount: bigint;
    try {
      minAmount = BigInt(requirements.minAmount.amount);
    } catch {
      return false;
    }
    if (balance < minAmount) {
      return false;
    }
  }

  const gates = requirements.gates ?? [];
  if (gates.length === 0) {
    return true;
  }

  const asaGates = gates.filter(
    (gate): gate is Extract<OpportunityEntryGate, { kind: "asa" }> =>
      gate.kind === "asa"
  );
  const uncheckableGates = gates.filter(
    (gate) => gate.kind !== "asa"
  );

  // Never soft-pass on NFD/creator-only gates.
  if (asaGates.length === 0 && uncheckableGates.length > 0) {
    return false;
  }

  if (asaGates.length === 0) {
    return true;
  }

  if (holdings.balances === undefined) {
    // Fall back to presence-only when balances unavailable.
    const matchAny = requirements.gateMatch !== "all";
    if (matchAny) {
      return asaGates.some((gate) => holdings.heldAssetIds.has(gate.assetId));
    }
    return asaGates.every((gate) => holdings.heldAssetIds.has(gate.assetId));
  }

  const gateOk = (gate: Extract<OpportunityEntryGate, { kind: "asa" }>): boolean => {
    const balance = holdings.balances!.get(gate.assetId) ?? 0n;
    const minBalance =
      gate.minBalance !== undefined ? BigInt(gate.minBalance) : 1n;
    return balance >= minBalance;
  };

  if (requirements.gateMatch === "all") {
    return asaGates.every(gateOk);
  }
  return asaGates.some(gateOk);
}
