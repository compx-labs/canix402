import { fetchWalletPositions } from "./aggregate-positions.js";
import type {
  OpportunityAdapterRisk,
  OpportunityMarketRecord,
  OpportunityRecordV1,
  OpportunityRisk,
  OpportunityRiskConfidence,
  OpportunityVolatilityBucket
} from "../types/opportunity.js";
import type { PositionRecordV1 } from "../types/position.js";

/** Matches the default opportunities cache TTL (3 minutes). */
export const RISK_CONFIDENCE_HIGH_MAX_AGE_MS = 180_000;
/** Snapshots older than this are low confidence. */
export const RISK_CONFIDENCE_MEDIUM_MAX_AGE_MS = 3_600_000;

export const RISK_UTILIZATION_ELEVATED = 80;
export const RISK_UTILIZATION_CRITICAL = 95;

export const RISK_HEALTH_FACTOR_CRITICAL = 1;
export const RISK_HEALTH_FACTOR_ELEVATED = 1.5;
export const RISK_HEALTH_FACTOR_WATCH = 2;

export const TINYMAN_STABLE_IL_HINT =
  "Tinyman marks this pool as stable; IL is typically low versus volatile pairs.";

export interface WalletHealthFactorIndex {
  byOpportunityId: Map<string, number>;
  byProtocol: Map<string, number>;
}

export interface FinalizeOpportunityRiskOptions {
  now?: Date;
  cacheAgeMs?: number | null;
  healthFactor?: number | null;
}

type HealthFactorLoader = (address: string) => Promise<WalletHealthFactorIndex>;

let healthFactorLoaderOverride: HealthFactorLoader | undefined;

export function setWalletHealthFactorLoaderForTests(
  loader?: HealthFactorLoader
): void {
  healthFactorLoaderOverride = loader;
}

export function emptyWalletHealthFactorIndex(): WalletHealthFactorIndex {
  return {
    byOpportunityId: new Map(),
    byProtocol: new Map()
  };
}

export function indexHealthFactorsFromPositions(
  positions: readonly Pick<
    PositionRecordV1,
    "protocol" | "opportunityId" | "healthFactor"
  >[]
): WalletHealthFactorIndex {
  const byOpportunityId = new Map<string, number>();
  const byProtocol = new Map<string, number>();

  for (const position of positions) {
    if (position.healthFactor === undefined || position.healthFactor === null) {
      continue;
    }
    if (!Number.isFinite(position.healthFactor) || position.healthFactor < 0) {
      continue;
    }
    if (position.opportunityId) {
      const existing = byOpportunityId.get(position.opportunityId);
      if (existing === undefined || position.healthFactor < existing) {
        byOpportunityId.set(position.opportunityId, position.healthFactor);
      }
    }
    const protocolExisting = byProtocol.get(position.protocol);
    if (protocolExisting === undefined || position.healthFactor < protocolExisting) {
      byProtocol.set(position.protocol, position.healthFactor);
    }
  }

  return { byOpportunityId, byProtocol };
}

export async function loadWalletHealthFactors(
  address: string
): Promise<WalletHealthFactorIndex> {
  if (healthFactorLoaderOverride) {
    return healthFactorLoaderOverride(address);
  }
  try {
    const response = await fetchWalletPositions(address);
    return indexHealthFactorsFromPositions(response.data);
  } catch {
    return emptyWalletHealthFactorIndex();
  }
}

export function resolveWalletHealthFactor(
  opportunity: Pick<OpportunityMarketRecord, "opportunityId" | "protocol" | "opportunityType"> | undefined,
  index: WalletHealthFactorIndex | undefined
): number | undefined {
  if (opportunity === undefined || index === undefined) {
    return undefined;
  }
  const byId = index.byOpportunityId.get(opportunity.opportunityId);
  if (byId !== undefined) {
    return byId;
  }
  if (opportunity.opportunityType !== "lending") {
    return undefined;
  }
  return index.byProtocol.get(opportunity.protocol);
}

export function confidenceFromAgeMs(
  ageMs: number | undefined
): OpportunityRiskConfidence {
  if (ageMs === undefined || !Number.isFinite(ageMs) || ageMs < 0) {
    return "unknown";
  }
  if (ageMs <= RISK_CONFIDENCE_HIGH_MAX_AGE_MS) {
    return "high";
  }
  if (ageMs <= RISK_CONFIDENCE_MEDIUM_MAX_AGE_MS) {
    return "medium";
  }
  return "low";
}

export function tinymanVolatilityRisk(
  isStable: boolean | null | undefined
): OpportunityAdapterRisk | undefined {
  if (isStable === true) {
    return {
      volatilityBucket: "stable",
      ilHint: TINYMAN_STABLE_IL_HINT
    };
  }
  if (isStable === false) {
    return { volatilityBucket: "unknown" };
  }
  return undefined;
}

export function utilizationFromBalances(
  borrowed: bigint,
  deposits: bigint
): number | undefined {
  if (deposits <= 0n) {
    return undefined;
  }
  const scaled = Number((borrowed * 10_000n) / deposits) / 100;
  if (!Number.isFinite(scaled) || scaled < 0) {
    return undefined;
  }
  return scaled;
}

export function finalizeOpportunityRisk(
  record: OpportunityMarketRecord | OpportunityRecordV1,
  options: FinalizeOpportunityRiskOptions = {}
): OpportunityRisk {
  const now = options.now ?? new Date();
  const existing = record.risk;
  const fetchedAgeMs = ageMsFromIso(record.fetchedAt, now);
  const sourceAgeMs = ageMsFromIso(record.sourceTimestamp, now);
  const ageForConfidence =
    options.cacheAgeMs !== undefined && options.cacheAgeMs !== null
      ? options.cacheAgeMs
      : fetchedAgeMs;
  const sourceAgeSeconds =
    sourceAgeMs === undefined ? undefined : Math.floor(sourceAgeMs / 1000);

  const healthFactor =
    options.healthFactor !== undefined
      ? options.healthFactor
      : existing?.healthFactor;
  const borrowApr =
    existing?.borrowApr !== undefined ? existing.borrowApr : record.borrowApr;

  return omitUndefinedRisk({
    utilization: existing?.utilization,
    liquidationThreshold: existing?.liquidationThreshold,
    ltv: existing?.ltv,
    borrowApr,
    healthFactor,
    volatilityBucket: existing?.volatilityBucket,
    ilHint: existing?.ilHint,
    rewardRunwayRemaining: existing?.rewardRunwayRemaining,
    confidence: confidenceFromAgeMs(ageForConfidence),
    sourceAgeSeconds
  });
}

export function attachOpportunityRisk<T extends OpportunityMarketRecord>(
  records: readonly T[],
  options: {
    now?: Date;
    cacheAgeMs?: number | null;
    healthFactors?: WalletHealthFactorIndex;
  } = {}
): T[] {
  return records.map((record) => {
    const healthFactor = resolveWalletHealthFactor(record, options.healthFactors);
    return {
      ...record,
      risk: finalizeOpportunityRisk(record, {
        ...(options.now ? { now: options.now } : {}),
        ...(options.cacheAgeMs !== undefined ? { cacheAgeMs: options.cacheAgeMs } : {}),
        ...(healthFactor !== undefined ? { healthFactor } : {})
      })
    };
  });
}

export function riskConstraintPenalty(risk: OpportunityRisk | undefined): number {
  if (risk === undefined) {
    return confidencePenalty("unknown");
  }
  return (
    confidencePenalty(risk.confidence) +
    utilizationPenalty(risk.utilization) +
    volatilityPenalty(risk.volatilityBucket) +
    healthFactorPenalty(risk.healthFactor) +
    runwayPenalty(risk.rewardRunwayRemaining)
  );
}

export function compareOpportunitiesByRiskThenYield(
  left: OpportunityMarketRecord,
  right: OpportunityMarketRecord,
  now: Date = new Date()
): number {
  const leftRisk = finalizeOpportunityRisk(left, { now });
  const rightRisk = finalizeOpportunityRisk(right, { now });
  const penaltyDelta = riskConstraintPenalty(leftRisk) - riskConstraintPenalty(rightRisk);
  if (penaltyDelta !== 0) {
    return penaltyDelta;
  }
  const apyDelta = right.apy - left.apy;
  if (apyDelta !== 0) {
    return apyDelta;
  }
  const tvlDelta = right.tvlUsd - left.tvlUsd;
  if (tvlDelta !== 0) {
    return tvlDelta;
  }
  return left.opportunityId.localeCompare(right.opportunityId);
}

function confidencePenalty(confidence: OpportunityRiskConfidence): number {
  switch (confidence) {
    case "high":
      return 0;
    case "medium":
      return 1;
    case "low":
      return 2;
    case "unknown":
      return 2;
    default:
      return 2;
  }
}

function utilizationPenalty(utilization: number | undefined): number {
  if (utilization === undefined || !Number.isFinite(utilization)) {
    return 0;
  }
  if (utilization >= RISK_UTILIZATION_CRITICAL) {
    return 2;
  }
  if (utilization >= RISK_UTILIZATION_ELEVATED) {
    return 1;
  }
  return 0;
}

function volatilityPenalty(
  bucket: OpportunityVolatilityBucket | undefined
): number {
  switch (bucket) {
    case "high":
      return 2;
    case "medium":
      return 1;
    case "stable":
    case "low":
    case "unknown":
    case undefined:
      return 0;
    default:
      return 0;
  }
}

function healthFactorPenalty(healthFactor: number | null | undefined): number {
  if (healthFactor === undefined || healthFactor === null || !Number.isFinite(healthFactor)) {
    return 0;
  }
  if (healthFactor < RISK_HEALTH_FACTOR_CRITICAL) {
    return 3;
  }
  if (healthFactor < RISK_HEALTH_FACTOR_ELEVATED) {
    return 2;
  }
  if (healthFactor < RISK_HEALTH_FACTOR_WATCH) {
    return 1;
  }
  return 0;
}

function runwayPenalty(remaining: string | undefined): number {
  if (remaining === undefined) {
    return 0;
  }
  try {
    return BigInt(remaining) === 0n ? 2 : 0;
  } catch {
    return 0;
  }
}

function ageMsFromIso(value: string, now: Date): number | undefined {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.max(0, now.getTime() - parsed);
}

function omitUndefinedRisk(risk: {
  utilization?: number | undefined;
  liquidationThreshold?: number | undefined;
  ltv?: number | undefined;
  borrowApr?: number | undefined;
  healthFactor?: number | null | undefined;
  volatilityBucket?: OpportunityVolatilityBucket | undefined;
  ilHint?: string | undefined;
  rewardRunwayRemaining?: string | undefined;
  confidence: OpportunityRiskConfidence;
  sourceAgeSeconds?: number | undefined;
}): OpportunityRisk {
  const result: OpportunityRisk = { confidence: risk.confidence };
  if (risk.utilization !== undefined) {
    result.utilization = risk.utilization;
  }
  if (risk.liquidationThreshold !== undefined) {
    result.liquidationThreshold = risk.liquidationThreshold;
  }
  if (risk.ltv !== undefined) {
    result.ltv = risk.ltv;
  }
  if (risk.borrowApr !== undefined) {
    result.borrowApr = risk.borrowApr;
  }
  if (risk.healthFactor !== undefined) {
    result.healthFactor = risk.healthFactor;
  }
  if (risk.volatilityBucket !== undefined) {
    result.volatilityBucket = risk.volatilityBucket;
  }
  if (risk.ilHint !== undefined) {
    result.ilHint = risk.ilHint;
  }
  if (risk.rewardRunwayRemaining !== undefined) {
    result.rewardRunwayRemaining = risk.rewardRunwayRemaining;
  }
  if (risk.sourceAgeSeconds !== undefined) {
    result.sourceAgeSeconds = risk.sourceAgeSeconds;
  }
  return result;
}
