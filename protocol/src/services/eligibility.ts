import type { AccountHoldings } from "./account-assets.js";
import { fetchAccountHoldings } from "./account-assets.js";
import {
  fetchOpportunitiesResult,
  SUPPORTED_AGGREGATE_PROTOCOLS
} from "./aggregate-opportunities.js";
import { ALGO_ASSET_ID } from "./asset-decimals.js";
import type { EligibilityRequest, EligibilityResponse } from "../types/eligibility.js";
import type {
  EligibilityGateResult,
  EligibilityMissingAsset,
  EligibilityReason,
  EligibilitySuggestedSwap,
  OpportunityEligibility
} from "../types/eligibility.js";
import type {
  OpportunityCapacity,
  OpportunityEntryGate,
  OpportunityMarketRecord
} from "../types/opportunity.js";

export interface EligibilityHoldings {
  heldAssetIds: ReadonlySet<number>;
  /** Base-unit balances keyed by asset id (0 = ALGO). */
  balances?: ReadonlyMap<number, bigint>;
}

const SUGGESTED_SWAP_NOTE =
  "Hint only — not a live quote. Use POST /swaps/quote, then re-check POST /eligibility. Quote-time on-chain checks remain authoritative.";

function parseBaseUnits(value: string | undefined, fallback = 0n): bigint {
  if (value === undefined) {
    return fallback;
  }
  try {
    return BigInt(value);
  } catch {
    return fallback;
  }
}

function heldAmount(holdings: EligibilityHoldings, assetId: number): bigint {
  if (holdings.balances !== undefined) {
    return holdings.balances.get(assetId) ?? 0n;
  }
  return holdings.heldAssetIds.has(assetId) ? 1n : 0n;
}

function resolveUsdcAssetId(): number | undefined {
  const raw = process.env.X402_USDC_ASSET_ID?.trim();
  if (!raw || !/^\d+$/.test(raw)) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function uniqueReasons(reasons: EligibilityReason[]): EligibilityReason[] {
  return [...new Set(reasons)];
}

function notFound(opportunityId: string): OpportunityEligibility {
  return {
    opportunityId,
    protocol: null,
    found: false,
    canEnter: false,
    eligibilityFullyCheckable: true,
    missingAssets: [],
    gates: [],
    capacity: null,
    suggestedSwap: null,
    reasons: ["opportunity-not-found"]
  };
}

function evaluateCapacity(capacity: OpportunityCapacity | undefined): {
  ok: boolean;
  reasons: EligibilityReason[];
} {
  if (capacity === undefined) {
    return { ok: true, reasons: [] };
  }

  const reasons: EligibilityReason[] = [];
  if (capacity.acceptingStake === false) {
    reasons.push("capacity-not-accepting");
  }
  if (capacity.stakerSlotsRemaining === 0) {
    reasons.push("capacity-no-slots");
  }
  if (capacity.algoRoomMicroAlgos === "0") {
    reasons.push("capacity-no-algo-room");
  }
  return { ok: reasons.length === 0, reasons };
}

function evaluateMinAmount(
  opportunity: OpportunityMarketRecord,
  holdings: EligibilityHoldings
): { missing: EligibilityMissingAsset | undefined; reason?: EligibilityReason } {
  const minAmount = opportunity.entryRequirements?.minAmount;
  if (minAmount === undefined) {
    return { missing: undefined };
  }

  const required = parseBaseUnits(minAmount.amount);
  const held = heldAmount(holdings, minAmount.assetId);
  if (held >= required) {
    return { missing: undefined };
  }

  const shortfall = required > held ? required - held : 0n;
  return {
    missing: {
      assetId: minAmount.assetId,
      requiredAmount: required.toString(),
      heldAmount: held.toString(),
      shortfall: shortfall.toString(),
      role: "min-amount"
    },
    reason: "below-min-amount"
  };
}

function evaluateGates(
  opportunity: OpportunityMarketRecord,
  holdings: EligibilityHoldings
): {
  gates: EligibilityGateResult[];
  missingAssets: EligibilityMissingAsset[];
  reasons: EligibilityReason[];
  fullyCheckable: boolean;
  asaGatesPass: boolean;
} {
  const requirements = opportunity.entryRequirements;
  const published = requirements?.gates ?? [];
  if (published.length === 0) {
    return {
      gates: [],
      missingAssets: [],
      reasons: [],
      fullyCheckable: requirements?.eligibilityFullyCheckable !== false,
      asaGatesPass: true
    };
  }

  const matchAll = requirements?.gateMatch === "all";
  const gates: EligibilityGateResult[] = [];
  const missingAssets: EligibilityMissingAsset[] = [];
  const reasons: EligibilityReason[] = [];
  let fullyCheckable = requirements?.eligibilityFullyCheckable !== false;
  const asaStatuses: boolean[] = [];

  for (const gate of published) {
    const evaluated = evaluateGate(gate, holdings);
    gates.push(evaluated.result);
    if (evaluated.missing) {
      missingAssets.push(evaluated.missing);
    }
    if (evaluated.reason) {
      reasons.push(evaluated.reason);
    }
    if (evaluated.result.status === "unresolved") {
      fullyCheckable = false;
    }
    if (gate.kind === "asa") {
      asaStatuses.push(evaluated.result.status === "pass");
    }
  }

  if (published.some((gate) => gate.kind !== "asa")) {
    fullyCheckable = false;
  }

  let asaGatesPass = true;
  if (asaStatuses.length > 0) {
    asaGatesPass = matchAll ? asaStatuses.every(Boolean) : asaStatuses.some(Boolean);
  }

  const filteredMissing = asaGatesPass
    ? missingAssets.filter((row) => row.role !== "asa-gate")
    : missingAssets;
  const filteredReasons = uniqueReasons(
    asaGatesPass
      ? reasons.filter((reason) => reason !== "missing-asa-gate")
      : reasons.includes("missing-asa-gate")
        ? reasons
        : [...reasons, "missing-asa-gate"]
  );

  return {
    gates,
    missingAssets: filteredMissing,
    reasons: filteredReasons,
    fullyCheckable,
    asaGatesPass
  };
}

function evaluateGate(
  gate: OpportunityEntryGate,
  holdings: EligibilityHoldings
): {
  result: EligibilityGateResult;
  missing?: EligibilityMissingAsset;
  reason?: EligibilityReason;
} {
  if (gate.kind === "asa") {
    const required = parseBaseUnits(gate.minBalance, 1n);
    const held = heldAmount(holdings, gate.assetId);
    const pass = held >= required;
    const shortfall = required > held ? required - held : 0n;
    const result: EligibilityGateResult = {
      kind: "asa",
      assetId: gate.assetId,
      ...(gate.minBalance !== undefined ? { minBalance: gate.minBalance } : {}),
      status: pass ? "pass" : "fail",
      heldAmount: held.toString(),
      ...(pass ? {} : { reason: "missing-asa-gate" as const })
    };
    if (pass) {
      return { result };
    }
    return {
      result,
      missing: {
        assetId: gate.assetId,
        requiredAmount: required.toString(),
        heldAmount: held.toString(),
        shortfall: shortfall.toString(),
        role: "asa-gate"
      },
      reason: "missing-asa-gate"
    };
  }

  if (gate.kind === "asa-creator") {
    return {
      result: {
        kind: "asa-creator",
        creator: gate.creator,
        ...(gate.minBalance !== undefined ? { minBalance: gate.minBalance } : {}),
        status: "unresolved",
        reason: "unresolved-creator-gate"
      },
      reason: "unresolved-creator-gate"
    };
  }

  if (gate.kind === "nfd-linked-creators") {
    return {
      result: {
        kind: "nfd-linked-creators",
        nfd: gate.nfd,
        status: "unresolved",
        reason: "unresolved-nfd-gate"
      },
      reason: "unresolved-nfd-gate"
    };
  }

  return {
    result: {
      kind: "nfd-root-segment",
      nfdRoot: gate.nfdRoot,
      status: "unresolved",
      reason: "unresolved-nfd-gate"
    },
    reason: "unresolved-nfd-gate"
  };
}

function evaluateRequiredAssets(
  opportunity: OpportunityMarketRecord,
  holdings: EligibilityHoldings,
  alreadyMissing: ReadonlySet<number>
): EligibilityMissingAsset[] {
  if (opportunity.entryRequirements !== undefined) {
    return [];
  }

  const assetIds = opportunity.assetIds ?? [];
  if (assetIds.length === 0) {
    return [];
  }

  // Ungated venues (AMMs, lending pools) stay enterable when the wallet holds
  // any overlapping assetId. Requiring the full pair would hide matchable
  // markets. Réti min/ASA/capacity/NFD checks live on entryRequirements.
  const anyHeld = assetIds.some((assetId) => heldAmount(holdings, assetId) > 0n);
  if (anyHeld) {
    return [];
  }

  const missing: EligibilityMissingAsset[] = [];
  for (const assetId of assetIds) {
    if (alreadyMissing.has(assetId)) {
      continue;
    }
    const held = heldAmount(holdings, assetId);
    missing.push({
      assetId,
      requiredAmount: "1",
      heldAmount: held.toString(),
      shortfall: "1",
      role: "required-asset"
    });
  }
  return missing;
}

function suggestSwap(
  holdings: EligibilityHoldings,
  missingAssets: readonly EligibilityMissingAsset[],
  fullyCheckable: boolean
): EligibilitySuggestedSwap | null {
  if (!fullyCheckable || missingAssets.length === 0) {
    return null;
  }

  const target = missingAssets[0];
  if (target === undefined || target.shortfall === "0") {
    return null;
  }

  const fromAssetId = pickSwapSource(holdings, target.assetId);
  if (fromAssetId === undefined) {
    return null;
  }

  const reason =
    target.role === "asa-gate"
      ? "missing-asa-gate"
      : target.role === "min-amount"
        ? "missing-min-amount"
        : "missing-required-asset";

  return {
    fromAssetId,
    toAssetId: target.assetId,
    amount: target.shortfall,
    reason,
    note: SUGGESTED_SWAP_NOTE
  };
}

function pickSwapSource(
  holdings: EligibilityHoldings,
  toAssetId: number
): number | undefined {
  const usdcAssetId = resolveUsdcAssetId();
  const candidates: number[] = [];
  if (toAssetId !== ALGO_ASSET_ID && heldAmount(holdings, ALGO_ASSET_ID) > 0n) {
    candidates.push(ALGO_ASSET_ID);
  }
  if (
    usdcAssetId !== undefined &&
    usdcAssetId !== toAssetId &&
    heldAmount(holdings, usdcAssetId) > 0n
  ) {
    candidates.push(usdcAssetId);
  }

  if (candidates.length > 0) {
    return candidates[0];
  }

  let best: { assetId: number; amount: bigint } | undefined;
  for (const assetId of holdings.heldAssetIds) {
    if (assetId === toAssetId) {
      continue;
    }
    const amount = heldAmount(holdings, assetId);
    if (amount <= 0n) {
      continue;
    }
    if (best === undefined || amount > best.amount) {
      best = { assetId, amount };
    }
  }
  return best?.assetId;
}

/**
 * Evaluate whether a wallet can enter a single opportunity.
 *
 * NFD / creator gates are published as `unresolved`. `canEnter` is never true
 * unless `eligibilityFullyCheckable` is true. Quote-time on-chain checks remain
 * authoritative.
 */
export function evaluateOpportunityEligibility(
  opportunity: OpportunityMarketRecord | undefined,
  opportunityId: string,
  holdings: EligibilityHoldings | AccountHoldings
): OpportunityEligibility {
  if (opportunity === undefined) {
    return notFound(opportunityId);
  }

  const capacityEval = evaluateCapacity(opportunity.capacity);
  const minEval = evaluateMinAmount(opportunity, holdings);
  const gateEval = evaluateGates(opportunity, holdings);

  const missingAssets: EligibilityMissingAsset[] = [];
  if (minEval.missing) {
    missingAssets.push(minEval.missing);
  }
  missingAssets.push(...gateEval.missingAssets);

  const alreadyMissing = new Set(missingAssets.map((row) => row.assetId));
  const requiredAssetMissing = evaluateRequiredAssets(
    opportunity,
    holdings,
    alreadyMissing
  );
  missingAssets.push(...requiredAssetMissing);

  const reasons: EligibilityReason[] = uniqueReasons([
    ...capacityEval.reasons,
    ...(minEval.reason ? [minEval.reason] : []),
    ...gateEval.reasons,
    ...(requiredAssetMissing.length > 0 ? (["missing-required-asset"] as const) : [])
  ]);

  const eligibilityFullyCheckable = gateEval.fullyCheckable;
  const requirementsPass =
    minEval.missing === undefined &&
    gateEval.asaGatesPass &&
    requiredAssetMissing.length === 0;
  const canEnter =
    eligibilityFullyCheckable && capacityEval.ok && requirementsPass;

  return {
    opportunityId: opportunity.opportunityId,
    protocol: opportunity.protocol,
    found: true,
    canEnter,
    eligibilityFullyCheckable,
    missingAssets,
    gates: gateEval.gates,
    capacity: opportunity.capacity ?? null,
    suggestedSwap: suggestSwap(holdings, missingAssets, eligibilityFullyCheckable),
    reasons
  };
}

export function eligibilityBlockedOnlyByCapacity(
  eligibility: OpportunityEligibility
): boolean {
  if (!eligibility.found || !eligibility.eligibilityFullyCheckable) {
    return false;
  }
  if (eligibility.canEnter) {
    return false;
  }
  if (eligibility.missingAssets.length > 0) {
    return false;
  }
  return eligibility.reasons.every(
    (reason) =>
      reason === "capacity-not-accepting" ||
      reason === "capacity-no-slots" ||
      reason === "capacity-no-algo-room"
  );
}

export function matchesPersonalizedFromEligibility(
  opportunity: OpportunityMarketRecord,
  eligibility: OpportunityEligibility,
  holdings: EligibilityHoldings,
  options: { includeInactive?: boolean } = {}
): boolean {
  if (!eligibility.found || !eligibility.eligibilityFullyCheckable) {
    return false;
  }

  const assetMatch = (opportunity.assetIds ?? []).some((assetId) =>
    holdings.heldAssetIds.has(assetId)
  );
  if (!assetMatch) {
    return false;
  }

  if (eligibility.canEnter) {
    return true;
  }

  return (
    options.includeInactive === true && eligibilityBlockedOnlyByCapacity(eligibility)
  );
}

export async function fetchEligibility(
  request: EligibilityRequest
): Promise<EligibilityResponse> {
  const holdings = await fetchAccountHoldings(request.address);
  const { data } = await fetchOpportunitiesResult(SUPPORTED_AGGREGATE_PROTOCOLS, {
    refresh: request.refresh === true
  });
  const byId = new Map(
    data.map((row) => [row.opportunityId, row] as const)
  );

  return {
    data: request.opportunityIds.map((opportunityId) =>
      evaluateOpportunityEligibility(byId.get(opportunityId), opportunityId, holdings)
    ),
    meta: {
      address: request.address,
      fetchedAt: new Date().toISOString(),
      paymentRequired: true,
      quoteTimeAuthoritative: true
    }
  };
}
