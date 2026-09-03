import type { OpportunityCapacity, OpportunityMarketRecord } from "../types/opportunity.js";
import type { ClaimableRewardsResponse } from "../types/claimable.js";
import type { PositionRecordV1 } from "../types/position.js";
import type {
  WatchFiring,
  WatchKind,
  WatchLastSnapshot,
  WatchRetiCapacityThreshold,
  WatchThresholds
} from "../types/watch.js";
import { mintEpisodeId, mintFiringId } from "./watch-store.js";
import { indexHealthFactorsFromPositions } from "./opportunity-risk.js";
import { fetchWalletPositions } from "./aggregate-positions.js";
import { fetchClaimableRewards } from "./claimable-rewards.js";
import {
  fetchOpportunitiesForProtocols,
  SUPPORTED_AGGREGATE_PROTOCOLS
} from "./aggregate-opportunities.js";

export interface WatchMarketOpportunity {
  opportunityId: string;
  protocol: string;
  apy: number;
  capacity?: OpportunityCapacity;
}

export interface WatchSnapshot {
  healthFactor: number | null;
  claimableUsd: number | null;
  opportunities: WatchMarketOpportunity[];
}

export interface WatchEvaluation {
  firings: WatchFiring[];
  nextSnapshot: WatchLastSnapshot;
}

export type WatchSnapshotLoader = (address: string) => Promise<WatchSnapshot>;

let snapshotLoaderOverride: WatchSnapshotLoader | undefined;

export function setWatchSnapshotLoaderForTests(loader: WatchSnapshotLoader | undefined): void {
  snapshotLoaderOverride = loader;
}

export function minHealthFactorFromPositions(
  positions: readonly Pick<PositionRecordV1, "protocol" | "opportunityId" | "healthFactor">[]
): number | null {
  const index = indexHealthFactorsFromPositions(positions);
  let min: number | null = null;
  for (const value of index.byOpportunityId.values()) {
    if (min === null || value < min) {
      min = value;
    }
  }
  if (min !== null) {
    return min;
  }
  for (const value of index.byProtocol.values()) {
    if (min === null || value < min) {
      min = value;
    }
  }
  return min;
}

export function snapshotFromSources(input: {
  positions?: readonly PositionRecordV1[];
  claimable?: Pick<ClaimableRewardsResponse, "totals"> | null;
  opportunities?: readonly Pick<
    OpportunityMarketRecord,
    "opportunityId" | "protocol" | "apy" | "capacity"
  >[];
}): WatchSnapshot {
  return {
    healthFactor: input.positions ? minHealthFactorFromPositions(input.positions) : null,
    claimableUsd: input.claimable?.totals.claimableUsd ?? null,
    opportunities: (input.opportunities ?? []).map((row) => ({
      opportunityId: row.opportunityId,
      protocol: row.protocol,
      apy: row.apy,
      ...(row.capacity ? { capacity: row.capacity } : {})
    }))
  };
}

export async function loadWatchSnapshot(address: string): Promise<WatchSnapshot> {
  if (snapshotLoaderOverride) {
    return snapshotLoaderOverride(address);
  }
  const [positions, claimable, opportunities] = await Promise.all([
    fetchWalletPositions(address).catch(() => null),
    fetchClaimableRewards(address).catch(() => null),
    fetchOpportunitiesForProtocols([...SUPPORTED_AGGREGATE_PROTOCOLS]).catch(() => [])
  ]);
  return snapshotFromSources({
    positions: positions?.data,
    claimable,
    opportunities
  });
}

export function evaluateWatchThresholds(
  watchId: string,
  thresholds: WatchThresholds,
  previous: WatchLastSnapshot,
  snapshot: WatchSnapshot,
  nowMs: number
): WatchEvaluation {
  const firedAt = new Date(nowMs).toISOString();
  const firings: WatchFiring[] = [];
  const nextSnapshot: WatchLastSnapshot = {
    healthFactor: snapshot.healthFactor,
    claimableUsd: snapshot.claimableUsd,
    apyByOpportunityId: Object.fromEntries(
      snapshot.opportunities.map((row) => [row.opportunityId, row.apy])
    ),
    retiByOpportunityId: Object.fromEntries(
      snapshot.opportunities
        .filter((row) => row.protocol === "reti" && row.capacity)
        .map((row) => [
          row.opportunityId,
          {
            opportunityId: row.opportunityId,
            acceptingStake: row.capacity!.acceptingStake,
            stakerSlotsRemaining: row.capacity!.stakerSlotsRemaining,
            algoRoomMicroAlgos: row.capacity!.algoRoomMicroAlgos
          }
        ])
    ),
    healthFactorEpisodeId: previous.healthFactorEpisodeId ?? null,
    claimableUsdEpisodeId: previous.claimableUsdEpisodeId ?? null,
    retiEpisodeByOpportunityId: { ...(previous.retiEpisodeByOpportunityId ?? {}) }
  };

  if (thresholds.healthFactor !== undefined) {
    const result = evaluateLevelCrossing({
      watchId,
      kind: "healthFactor",
      threshold: thresholds.healthFactor,
      previousValue: previous.healthFactor,
      currentValue: snapshot.healthFactor,
      inBreach: (value) => value < thresholds.healthFactor!,
      episodeId: previous.healthFactorEpisodeId ?? null,
      firedAt
    });
    nextSnapshot.healthFactorEpisodeId = result.episodeId;
    if (result.firing) {
      firings.push(result.firing);
    }
  }

  if (thresholds.claimableUsd !== undefined) {
    const result = evaluateLevelCrossing({
      watchId,
      kind: "claimableUsd",
      threshold: thresholds.claimableUsd,
      previousValue: previous.claimableUsd,
      currentValue: snapshot.claimableUsd,
      inBreach: (value) => value >= thresholds.claimableUsd!,
      episodeId: previous.claimableUsdEpisodeId ?? null,
      firedAt
    });
    nextSnapshot.claimableUsdEpisodeId = result.episodeId;
    if (result.firing) {
      firings.push(result.firing);
    }
  }

  if (thresholds.apyDropBps !== undefined) {
    const dropThreshold = thresholds.apyDropBps / 100;
    for (const opportunity of snapshot.opportunities) {
      const previousApy = previous.apyByOpportunityId?.[opportunity.opportunityId];
      if (previousApy === undefined || !Number.isFinite(previousApy)) {
        continue;
      }
      const drop = previousApy - opportunity.apy;
      if (drop + 1e-12 < dropThreshold) {
        continue;
      }
      firings.push(
        buildFiring({
          watchId,
          kind: "apyDrop",
          idempotencyKey: [
            "wfire",
            watchId,
            "apyDrop",
            opportunity.opportunityId,
            roundApyKey(previousApy),
            roundApyKey(opportunity.apy)
          ].join("_"),
          threshold: thresholds.apyDropBps,
          previous: previousApy,
          current: opportunity.apy,
          opportunityId: opportunity.opportunityId,
          firedAt
        })
      );
    }
  }

  if (thresholds.retiCapacity !== undefined) {
    const retiThreshold = normalizeRetiThreshold(thresholds.retiCapacity);
    const episodes = { ...(previous.retiEpisodeByOpportunityId ?? {}) };
    for (const opportunity of snapshot.opportunities) {
      if (opportunity.protocol !== "reti" || !opportunity.capacity) {
        continue;
      }
      const constrained = isRetiConstrained(opportunity.capacity, retiThreshold);
      const previousCapacity = previous.retiByOpportunityId?.[opportunity.opportunityId];
      const wasConstrained = previousCapacity
        ? isRetiConstrained(
            {
              acceptingStake: previousCapacity.acceptingStake,
              stakerSlotsRemaining: previousCapacity.stakerSlotsRemaining,
              algoRoomMicroAlgos: previousCapacity.algoRoomMicroAlgos
            },
            retiThreshold
          )
        : false;
      const existingEpisode = episodes[opportunity.opportunityId];
      if (constrained && !wasConstrained) {
        const episodeId = existingEpisode ?? mintEpisodeId();
        episodes[opportunity.opportunityId] = episodeId;
        firings.push(
          buildFiring({
            watchId,
            kind: "retiCapacity",
            idempotencyKey: ["wfire", watchId, "retiCapacity", opportunity.opportunityId, episodeId].join(
              "_"
            ),
            threshold: true,
            previous: previousCapacity?.acceptingStake ?? null,
            current: opportunity.capacity.acceptingStake,
            opportunityId: opportunity.opportunityId,
            firedAt
          })
        );
      } else if (!constrained) {
        delete episodes[opportunity.opportunityId];
      }
    }
    nextSnapshot.retiEpisodeByOpportunityId = episodes;
  }

  return { firings, nextSnapshot };
}

function evaluateLevelCrossing(input: {
  watchId: string;
  kind: WatchKind;
  threshold: number;
  previousValue: number | null | undefined;
  currentValue: number | null;
  inBreach: (value: number) => boolean;
  episodeId: string | null;
  firedAt: string;
}): { firing: WatchFiring | undefined; episodeId: string | null } {
  if (input.currentValue === null || !Number.isFinite(input.currentValue)) {
    return { firing: undefined, episodeId: input.episodeId };
  }
  const currentlyBreached = input.inBreach(input.currentValue);
  if (!currentlyBreached) {
    return { firing: undefined, episodeId: null };
  }
  const previousBreached =
    input.previousValue !== undefined &&
    input.previousValue !== null &&
    Number.isFinite(input.previousValue) &&
    input.inBreach(input.previousValue);
  if (previousBreached && input.episodeId) {
    return { firing: undefined, episodeId: input.episodeId };
  }
  const episodeId = input.episodeId ?? mintEpisodeId();
  return {
    episodeId,
    firing: buildFiring({
      watchId: input.watchId,
      kind: input.kind,
      idempotencyKey: ["wfire", input.watchId, input.kind, episodeId].join("_"),
      threshold: input.threshold,
      previous: input.previousValue ?? null,
      current: input.currentValue,
      firedAt: input.firedAt
    })
  };
}

function buildFiring(input: {
  watchId: string;
  kind: WatchKind;
  idempotencyKey: string;
  threshold: number | string | boolean;
  previous: number | string | boolean | null;
  current: number | string | boolean | null;
  opportunityId?: string;
  firedAt: string;
}): WatchFiring {
  return {
    firingId: mintFiringId(),
    idempotencyKey: input.idempotencyKey,
    kind: input.kind,
    firedAt: input.firedAt,
    threshold: input.threshold,
    previous: input.previous,
    current: input.current,
    ...(input.opportunityId ? { opportunityId: input.opportunityId } : {}),
    delivered: false,
    deliveryStatus: "pending"
  };
}

function normalizeRetiThreshold(
  value: true | WatchRetiCapacityThreshold
): WatchRetiCapacityThreshold {
  if (value === true) {
    return { minStakerSlotsRemaining: 1, minAlgoRoomMicroAlgos: "1" };
  }
  return value;
}

function isRetiConstrained(
  capacity: {
    acceptingStake: boolean;
    stakerSlotsRemaining: number | null;
    algoRoomMicroAlgos: string | null;
  },
  threshold: WatchRetiCapacityThreshold
): boolean {
  if (capacity.acceptingStake === false) {
    return true;
  }
  if (
    threshold.minStakerSlotsRemaining !== undefined &&
    capacity.stakerSlotsRemaining !== null &&
    capacity.stakerSlotsRemaining < threshold.minStakerSlotsRemaining
  ) {
    return true;
  }
  if (threshold.minAlgoRoomMicroAlgos !== undefined && capacity.algoRoomMicroAlgos !== null) {
    try {
      if (BigInt(capacity.algoRoomMicroAlgos) < BigInt(threshold.minAlgoRoomMicroAlgos)) {
        return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}

function roundApyKey(apy: number): string {
  return (Math.round(apy * 10_000) / 10_000).toFixed(4);
}
