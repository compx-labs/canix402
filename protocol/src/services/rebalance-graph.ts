import type { ClaimableQuoteRequest, ClaimableRewardRecord } from "../types/claimable.js";
import type { PositionRecordV1 } from "../types/position.js";
import type { Protocol } from "../routes/schemas.js";
import type { RebalanceBook, RebalanceBookWeight, RebalanceTargetWeight } from "../types/rebalance.js";

export const BPS_DENOMINATOR = 10_000;
export const DEFAULT_MIN_DELTA_BPS = 50;
export const DEFAULT_ALGO_RESERVE_MICRO = 1_000_000n;

const BOOK_POSITION_TYPES = new Set(["supplied", "lp", "staked"]);

export interface RebalanceIntent {
  kind: "claim" | "exit" | "enter";
  opportunityId: string | null;
  positionId?: string;
  protocol: Protocol | null;
  assetId: number | null;
  amountRaw: string;
  shapeKey?: string;
  quote?: ClaimableQuoteRequest;
  currentUsd?: number;
  reason: string;
  /** False when the leg needs a confirmed prior group (exit proceeds). */
  compileNow: boolean;
}

export interface RebalanceGraphInput {
  positions: readonly PositionRecordV1[];
  claimable: readonly ClaimableRewardRecord[];
  idleAlgoMicro: bigint;
  targetWeights?: readonly RebalanceTargetWeight[];
  harvestIdle: boolean;
  includeClaims: boolean;
  minDeltaBps: number;
}

export interface RebalanceGraphResult {
  book: RebalanceBook;
  intents: RebalanceIntent[];
  warnings: string[];
}

/**
 * Pure compiler graph: positions are the book, opportunities (target ids) are
 * the menu. Emit only claim / exit / enter legs that change the book.
 */
export function computeRebalanceDeltas(input: RebalanceGraphInput): RebalanceGraphResult {
  const warnings: string[] = [];
  const intents: RebalanceIntent[] = [];
  const targetMap = new Map<string, number>();
  if (input.targetWeights) {
    for (const row of input.targetWeights) {
      targetMap.set(row.opportunityId, row.weightBps);
    }
  }

  const bookPositions = input.positions.filter(isBookPosition);
  const universePositions =
    targetMap.size > 0
      ? bookPositions.filter(
          (position) =>
            typeof position.opportunityId === "string" &&
            targetMap.has(position.opportunityId)
        )
      : [];

  const untouched = bookPositions.filter(
    (position) =>
      typeof position.opportunityId !== "string" ||
      (targetMap.size > 0 && !targetMap.has(position.opportunityId))
  );
  const unweightedUsd = sumUsd(untouched);

  const grouped = groupByOpportunity(universePositions);
  const knownUsd = [...grouped.values()].reduce((sum, row) => sum + row.usdValue, 0);
  const hasNullUsd = universePositions.some((position) => position.usdValue === null);
  const totalUsd = grouped.size === 0 ? null : knownUsd;
  if (hasNullUsd) {
    warnings.push(
      "Some book positions have null usdValue; weights use priced rows only."
    );
  }

  const currentBps = allocateWeightBps(grouped, totalUsd);
  const weights: RebalanceBookWeight[] = [];
  const seen = new Set<string>();

  for (const opportunityId of targetMap.keys()) {
    seen.add(opportunityId);
    const group = grouped.get(opportunityId);
    const usdValue = group?.usdValue ?? 0;
    const protocol = group?.protocol ?? null;
    const currentWeightBps = currentBps.get(opportunityId) ?? 0;
    const targetWeightBps = targetMap.get(opportunityId) ?? 0;
    weights.push({
      opportunityId,
      protocol,
      usdValue,
      currentWeightBps,
      targetWeightBps,
      deltaBps: targetWeightBps - currentWeightBps
    });
  }

  for (const [opportunityId, group] of grouped) {
    if (seen.has(opportunityId)) {
      continue;
    }
    const currentWeightBps = currentBps.get(opportunityId) ?? 0;
    weights.push({
      opportunityId,
      protocol: group.protocol,
      usdValue: group.usdValue,
      currentWeightBps,
      targetWeightBps: 0,
      deltaBps: -currentWeightBps
    });
  }

  const book: RebalanceBook = {
    totalUsd,
    idleAlgoMicroAlgos: input.idleAlgoMicro.toString(),
    weights,
    unweightedUsd
  };

  if (input.includeClaims) {
    const seenKeys = new Set<string>();
    for (const row of input.claimable) {
      if (row.worthClaiming !== true || row.quote === null) {
        continue;
      }
      if (seenKeys.has(row.claimKey)) {
        continue;
      }
      seenKeys.add(row.claimKey);
      intents.push({
        kind: "claim",
        opportunityId: row.opportunityId,
        protocol: row.protocol,
        assetId: row.assetId,
        amountRaw: row.amountRaw,
        reason: "worth-claiming-reward",
        compileNow: true,
        positionId: row.positionId,
        shapeKey: row.quote.shapeKey,
        quote: row.quote
      });
    }
    if (seenKeys.size === 0) {
      warnings.push("No worth-claiming rewards on the claim desk.");
    }
  }

  const overweight = weights.filter((row) => {
    if (row.targetWeightBps === 0 && row.currentWeightBps > 0) {
      return true;
    }
    return row.deltaBps <= -input.minDeltaBps;
  });
  const underweight = weights.filter((row) => row.deltaBps >= input.minDeltaBps);

  for (const row of overweight) {
    const group = grouped.get(row.opportunityId);
    if (group === undefined || group.positions.length === 0) {
      continue;
    }
    const fullExit = row.targetWeightBps === 0;
    const overweightUsd =
      totalUsd !== null && totalUsd > 0
        ? (Math.abs(row.deltaBps) / BPS_DENOMINATOR) * totalUsd
        : group.usdValue;
    for (const position of group.positions) {
      const shapeKey = position.compatibleExitShapeKeys[0];
      if (shapeKey === undefined) {
        warnings.push(
          `No compatibleExitShapeKeys on ${position.positionId}; skipped exit.`
        );
        continue;
      }
      if (position.compatibleExitShapeKeys.length > 1) {
        warnings.push(
          `Multiple compatibleExitShapeKeys on ${position.positionId}; compiling the first (${shapeKey}). Remaining keys need a later POST /execution/quotes.`
        );
      }
      const amountRaw = fullExit
        ? position.amountRaw
        : scaleAmount(position.amountRaw, overweightUsd, group.usdValue);
      if (amountRaw === "0") {
        warnings.push(`Exit amount rounded to zero for ${position.positionId}.`);
        continue;
      }
      intents.push({
        kind: "exit",
        opportunityId: row.opportunityId,
        protocol: position.protocol,
        assetId: position.assetId,
        amountRaw,
        reason: fullExit ? "target-weight-zero" : "overweight-delta",
        compileNow: true,
        positionId: position.positionId,
        shapeKey,
        ...(position.usdValue !== null ? { currentUsd: position.usdValue } : {})
      });
    }
  }

  const hasCompiledExits = intents.some((intent) => intent.kind === "exit");
  const deployableIdle = input.harvestIdle || targetMap.size > 0 ? input.idleAlgoMicro : 0n;

  if (targetMap.size === 0 && input.harvestIdle) {
    if (deployableIdle > 0n) {
      intents.push({
        kind: "enter",
        opportunityId: null,
        protocol: null,
        assetId: 0,
        amountRaw: deployableIdle.toString(),
        reason: "harvest-idle-algo",
        compileNow: true
      });
    } else {
      warnings.push("No idle ALGO above reserve to redeploy.");
    }
  } else if (underweight.length > 0) {
    const totalGapBps = underweight.reduce((sum, row) => sum + row.deltaBps, 0);
    if (deployableIdle > 0n && totalGapBps > 0) {
      let remaining = deployableIdle;
      for (const [index, row] of underweight.entries()) {
        const share =
          index === underweight.length - 1
            ? remaining
            : (deployableIdle * BigInt(row.deltaBps)) / BigInt(totalGapBps);
        remaining -= share;
        if (share <= 0n) {
          continue;
        }
        intents.push({
          kind: "enter",
          opportunityId: row.opportunityId,
          protocol: row.protocol,
          assetId: 0,
          amountRaw: share.toString(),
          reason: "underweight-idle-algo",
          compileNow: true
        });
      }
    } else if (hasCompiledExits) {
      for (const row of underweight) {
        intents.push({
          kind: "enter",
          opportunityId: row.opportunityId,
          protocol: row.protocol,
          assetId: 0,
          amountRaw: "0",
          reason: "underweight-awaiting-exit-proceeds",
          compileNow: false
        });
      }
    } else {
      warnings.push(
        "Underweight targets have no idle ALGO and no overweight exits to fund enters."
      );
    }
  }

  if (targetMap.size > 0 && overweight.length === 0 && underweight.length === 0) {
    warnings.push("Book already matches target weights within minDeltaBps; no exit/enter deltas.");
  }

  if (untouched.length > 0 && targetMap.size > 0) {
    warnings.push(
      "Positions whose opportunityId is not in targetWeights were left unchanged (delta plan, not a full unwind)."
    );
  }

  return { book, intents, warnings: unique(warnings) };
}

export function resolveIdleAlgoMicro(
  walletAlgoMicro: bigint,
  reserveMicro: bigint
): bigint {
  return walletAlgoMicro > reserveMicro ? walletAlgoMicro - reserveMicro : 0n;
}

function isBookPosition(position: PositionRecordV1): boolean {
  return BOOK_POSITION_TYPES.has(position.positionType);
}

interface OpportunityGroup {
  protocol: Protocol | null;
  usdValue: number;
  positions: PositionRecordV1[];
}

function groupByOpportunity(
  positions: readonly PositionRecordV1[]
): Map<string, OpportunityGroup> {
  const grouped = new Map<string, OpportunityGroup>();
  for (const position of positions) {
    if (typeof position.opportunityId !== "string") {
      continue;
    }
    const existing = grouped.get(position.opportunityId);
    const usd = position.usdValue ?? 0;
    if (existing === undefined) {
      grouped.set(position.opportunityId, {
        protocol: position.protocol,
        usdValue: usd,
        positions: [position]
      });
      continue;
    }
    existing.usdValue += usd;
    existing.positions.push(position);
  }
  return grouped;
}

function allocateWeightBps(
  grouped: Map<string, OpportunityGroup>,
  totalUsd: number | null
): Map<string, number> {
  const result = new Map<string, number>();
  if (totalUsd === null || totalUsd <= 0) {
    for (const opportunityId of grouped.keys()) {
      result.set(opportunityId, 0);
    }
    return result;
  }
  let assigned = 0;
  let remainderId: string | undefined;
  let remainderUsd = -1;
  for (const [opportunityId, group] of grouped) {
    const bps = Math.floor((group.usdValue * BPS_DENOMINATOR) / totalUsd);
    result.set(opportunityId, bps);
    assigned += bps;
    if (group.usdValue > remainderUsd) {
      remainderUsd = group.usdValue;
      remainderId = opportunityId;
    }
  }
  const leftover = BPS_DENOMINATOR - assigned;
  if (leftover > 0 && remainderId !== undefined) {
    result.set(remainderId, (result.get(remainderId) ?? 0) + leftover);
  }
  return result;
}

function scaleAmount(amountRaw: string, numeratorUsd: number, denominatorUsd: number): string {
  if (!(denominatorUsd > 0) || !(numeratorUsd > 0)) {
    return "0";
  }
  const raw = BigInt(amountRaw);
  const scale = 1_000_000n;
  const num = BigInt(Math.round(numeratorUsd * 1e6));
  const den = BigInt(Math.round(denominatorUsd * 1e6));
  if (den === 0n) {
    return "0";
  }
  const scaled = (raw * num) / den;
  if (scaled >= raw) {
    return raw.toString();
  }
  return scaled.toString();
}

function sumUsd(positions: readonly PositionRecordV1[]): number | null {
  let total = 0;
  let any = false;
  for (const position of positions) {
    if (position.usdValue === null) {
      continue;
    }
    any = true;
    total += position.usdValue;
  }
  return any ? total : null;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
