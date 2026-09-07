import { buildSourceMetadata } from "../services/source-metadata.js";
import {
  fetchStammAssets,
  fetchStammPools,
  type HogswapStammAssetMeta
} from "../services/hogswap-client.js";
import { OpportunityMarketRecord } from "../types/opportunity.js";

export const STAMM_UNKNOWN_APY_NOTE =
  "APY is unknown (emitted as 0). Listings expose TVL and fee bps only; fee-APR is not inferred from incomplete volume.";

export class StammAdapterError extends Error {
  public readonly cause?: unknown;

  public constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "StammAdapterError";
    this.cause = cause;
  }
}

export interface StammTierSnapshot {
  poolId: number;
  assetA: number;
  assetB: number;
  lpAssetId: number;
  tierIndex: number;
  feeBps: number;
  tvlUsd: number;
  assetPair: string;
}

interface StammAdapterDependencies {
  fetchPools: () => Promise<Record<string, unknown>[]>;
  fetchAssets: () => Promise<Map<number, HogswapStammAssetMeta>>;
}

let dependencyOverrides: Partial<StammAdapterDependencies> | undefined;

export function setStammAdapterDependenciesForTests(
  overrides?: Partial<StammAdapterDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): StammAdapterDependencies {
  return {
    fetchPools: fetchStammPools,
    fetchAssets: fetchStammAssets,
    ...dependencyOverrides
  };
}

/**
 * One OpportunityRecordV1 row per **active STAMM fee tier**.
 * HOGSWAP `GET /stamm/pools` is the source; Canix does not invent yield.
 */
export async function fetchStammOpportunities(): Promise<OpportunityMarketRecord[]> {
  const dependencies = resolveDependencies();
  const fetchedAtIso = new Date().toISOString();

  try {
    const [pools, assets] = await Promise.all([
      dependencies.fetchPools(),
      dependencies.fetchAssets().catch(() => new Map<number, HogswapStammAssetMeta>())
    ]);
    return pools.flatMap((pool) =>
      normalizeStammPoolTiers(pool, assets, fetchedAtIso)
    );
  } catch (error) {
    if (error instanceof StammAdapterError) {
      throw error;
    }
    throw new StammAdapterError("STAMM adapter request failed.", error);
  }
}

export function normalizeStammPoolTiers(
  pool: Record<string, unknown>,
  assets: Map<number, HogswapStammAssetMeta>,
  fetchedAtIso: string
): OpportunityMarketRecord[] {
  const poolId = parseSafePositiveInteger(pool.pool_id);
  if (poolId === null) {
    return [];
  }
  const assetA = parseSafeNonNegativeInteger(pool.asset_a);
  const assetB = parseSafeNonNegativeInteger(pool.asset_b);
  if (assetA === null || assetB === null) {
    return [];
  }

  const poolTvlUsd = microUsdToUsd(pool.tvl_usd_micro);
  const poolReserveA = parseUnsignedBigInt(pool.reserve_a_micro);
  const poolReserveB = parseUnsignedBigInt(pool.reserve_b_micro);
  const assetPair = formatAssetPair(assetA, assetB, assets);

  return asObjectArray(pool.tier_breakdown).flatMap((tier) => {
    const snapshot = snapshotActiveTier({
      poolId,
      assetA,
      assetB,
      assetPair,
      poolTvlUsd,
      poolReserveA,
      poolReserveB,
      tier
    });
    if (snapshot === null) {
      return [];
    }
    const record = normalizeStammLpOpportunity(snapshot, fetchedAtIso);
    return record === null ? [] : [record];
  });
}

export function normalizeStammLpOpportunity(
  snapshot: StammTierSnapshot,
  fetchedAtIso: string = new Date().toISOString()
): OpportunityMarketRecord | null {
  if (!(snapshot.tvlUsd > 0) || !Number.isFinite(snapshot.tvlUsd)) {
    return null;
  }
  if (!Number.isInteger(snapshot.tierIndex) || snapshot.tierIndex < 0 || snapshot.tierIndex > 5) {
    return null;
  }

  return {
    protocol: "stamm",
    opportunityType: "lp",
    opportunityId: stammLpOpportunityId(snapshot.poolId, snapshot.tierIndex),
    assetPair: snapshot.assetPair,
    assetIds: [snapshot.assetA, snapshot.assetB],
    poolAppId: snapshot.poolId,
    liquidityAssetId: snapshot.lpAssetId,
    apy: 0,
    yieldBasis: "apr",
    tvlUsd: snapshot.tvlUsd,
    risk: { volatilityBucket: "unknown" },
    ...buildSourceMetadata({
      fetchedAtIso,
      contextNotes: [
        `STAMM LP tier ${snapshot.tierIndex} (pool ${snapshot.poolId}, lp_asset_id ${snapshot.lpAssetId}, fee ${snapshot.feeBps} bps).`,
        STAMM_UNKNOWN_APY_NOTE,
        "Wallet must already be opted into the LP ASA before mint/redeem execute. Router/registry app ids are not hardcoded — /execute targets the current HOGSWAP router."
      ]
    })
  };
}

export function stammLpOpportunityId(poolId: number, tierIndex: number): string {
  return `${poolId}:lp:${tierIndex}`;
}

function snapshotActiveTier(input: {
  poolId: number;
  assetA: number;
  assetB: number;
  assetPair: string;
  poolTvlUsd: number | null;
  poolReserveA: bigint | null;
  poolReserveB: bigint | null;
  tier: Record<string, unknown>;
}): StammTierSnapshot | null {
  const { poolId, assetA, assetB, assetPair, poolTvlUsd, poolReserveA, poolReserveB, tier } =
    input;
  if (tier.active === false) {
    return null;
  }
  const lpAssetId = parseSafePositiveInteger(tier.lp_asset_id);
  const tierIndex = parseNonNegativeInteger(tier.index);
  if (lpAssetId === null || tierIndex === null) {
    return null;
  }
  const tvlUsd = allocateTierTvlUsd({
    poolTvlUsd,
    poolReserveA,
    poolReserveB,
    tierReserveA: parseUnsignedBigInt(tier.reserve_a),
    tierReserveB: parseUnsignedBigInt(tier.reserve_b)
  });
  if (tvlUsd === null) {
    return null;
  }
  const feeBps = parseNonNegativeInteger(tier.fee_bps) ?? 0;
  return {
    poolId,
    assetA,
    assetB,
    lpAssetId,
    tierIndex,
    feeBps,
    tvlUsd,
    assetPair
  };
}

/**
 * Allocate pool TVL to a tier by reserve share. Do not invent USD when the
 * pool TVL or both reserve sides are missing.
 */
export function allocateTierTvlUsd(input: {
  poolTvlUsd: number | null;
  poolReserveA: bigint | null;
  poolReserveB: bigint | null;
  tierReserveA: bigint | null;
  tierReserveB: bigint | null;
}): number | null {
  const { poolTvlUsd, poolReserveA, poolReserveB, tierReserveA, tierReserveB } = input;
  if (poolTvlUsd === null || !(poolTvlUsd > 0)) {
    return null;
  }
  const shareA =
    poolReserveA !== null && poolReserveA > 0n && tierReserveA !== null
      ? Number(tierReserveA) / Number(poolReserveA)
      : null;
  const shareB =
    poolReserveB !== null && poolReserveB > 0n && tierReserveB !== null
      ? Number(tierReserveB) / Number(poolReserveB)
      : null;
  const share = shareA !== null && Number.isFinite(shareA) && shareA > 0 ? shareA : shareB;
  if (share === null || !Number.isFinite(share) || share <= 0) {
    return null;
  }
  const tvlUsd = poolTvlUsd * share;
  return Number.isFinite(tvlUsd) && tvlUsd > 0 ? tvlUsd : null;
}

function formatAssetPair(
  assetA: number,
  assetB: number,
  assets: Map<number, HogswapStammAssetMeta>
): string {
  return `${assetLabel(assetA, assets)}/${assetLabel(assetB, assets)}`;
}

function assetLabel(
  assetId: number,
  assets: Map<number, HogswapStammAssetMeta>
): string {
  if (assetId === 0) {
    return "ALGO";
  }
  const meta = assets.get(assetId);
  if (meta?.unitName) {
    return meta.unitName;
  }
  if (meta?.name) {
    return meta.name;
  }
  return `ASSET-${assetId}`;
}

function microUsdToUsd(value: unknown): number | null {
  const micro = parseNullableNonNegativeNumber(value);
  if (micro === null) {
    return null;
  }
  const usd = micro / 1_000_000;
  return Number.isFinite(usd) && usd >= 0 ? usd : null;
}

function asObjectArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === "object" && entry !== null && !Array.isArray(entry)
  );
}

function parseUnsignedBigInt(value: unknown): bigint | null {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "bigint"
  ) {
    return null;
  }
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : null;
  } catch {
    return null;
  }
}

function parseSafePositiveInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseSafeNonNegativeInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseNonNegativeInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseNullableNonNegativeNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed =
    typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
