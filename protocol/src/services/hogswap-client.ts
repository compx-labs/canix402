import {
  createRequestGate,
  mapWithThrottle,
  retryRateLimited,
  type RequestGate
} from "./request-throttle.js";

export const HOGSWAP_DEFAULT_BASE_URL = "https://hogswap-v1.liquihog.dev";

/** HOGSWAP allows 4 in-flight requests per IP. Stay under that. */
export const HOGSWAP_DEFAULT_HTTP_CONCURRENCY = 2;

/**
 * Protocols whose LP ASAs are valued by the unified HOGSWAP collector.
 * Tinyman and Pact keep their dedicated collectors and are excluded here.
 */
export const HOGSWAP_LP_POSITION_PROTOCOLS = [
  "stamm",
  "algofi",
  "humble"
] as const;

export type HogswapLpProtocol = (typeof HOGSWAP_LP_POSITION_PROTOCOLS)[number];

/** DEX names that already have per-protocol LP collectors. Do not double-count. */
const DEDICATED_LP_COLLECTOR_DEX_PREFIXES = ["tinyman", "pact"] as const;

export interface HogswapLpCatalogEntry {
  lpAssetId: number;
  poolId: number;
  dexKind: number | null;
  dexName: string;
  protocol: HogswapLpProtocol | null;
  /** True when Tinyman/Pact already collect this LP ASA. */
  dedicatedCollector: boolean;
  tierIndex: number | null;
  assetA: number | null;
  assetB: number | null;
  lpDecimals: number | null;
}

export interface HogswapLpValuation {
  assetId: number;
  poolId: number | null;
  dexKind: number | null;
  dexName: string | null;
  tierIndex: number | null;
  assetA: number | null;
  assetB: number | null;
  poolTvlUsdMicro: number | null;
  tvlConfidenceBps: number | null;
  asOfRound: number | null;
  lpSupply: bigint | null;
  lpDecimals: number | null;
  reserveAMicro: bigint | null;
  reserveBMicro: bigint | null;
  perLpAssetAMicro: bigint | null;
  perLpAssetBMicro: bigint | null;
  valuePerLpUsdMicro: number | null;
  amount: bigint | null;
  valueUsdMicro: number | null;
  redeemableAssetAMicro: bigint | null;
  redeemableAssetBMicro: bigint | null;
}

export interface HogswapAnalyticsPrice {
  priceAlgo: number | null;
  priceUsd: number | null;
  confidenceBps: number | null;
}

export interface HogswapAnalyticsPrices {
  algoUsd: number | null;
  asOfRound: number | null;
  asOfTs: number | null;
  prices: Map<number, HogswapAnalyticsPrice>;
}

export class HogswapClientError extends Error {
  public readonly status: number | undefined;

  public constructor(message: string, status?: number) {
    super(message);
    this.name = "HogswapClientError";
    this.status = status;
  }
}

interface HogswapClientDependencies {
  fetch: typeof fetch;
  now: () => number;
}

let dependencyOverrides: Partial<HogswapClientDependencies> | undefined;
let catalogCache:
  | { expiresAt: number; value: Map<number, HogswapLpCatalogEntry> }
  | undefined;
let catalogInFlight: Promise<Map<number, HogswapLpCatalogEntry>> | undefined;
let hogswapRequestGate: RequestGate | undefined;

export function setHogswapClientDependenciesForTests(
  overrides?: Partial<HogswapClientDependencies>
): void {
  dependencyOverrides = overrides;
  resetHogswapClientCacheForTests();
}

export function resetHogswapClientCacheForTests(): void {
  catalogCache = undefined;
  catalogInFlight = undefined;
  hogswapRequestGate = undefined;
}

function resolveDependencies(): HogswapClientDependencies {
  return {
    fetch: globalThis.fetch.bind(globalThis),
    now: Date.now,
    ...dependencyOverrides
  };
}

function hogswapBaseUrl(): string {
  return trimTrailingSlash(
    process.env.HOGSWAP_API_BASE_URL ?? HOGSWAP_DEFAULT_BASE_URL
  );
}

function hogswapHeaders(): HeadersInit {
  const apiKey = process.env.HOGSWAP_API_KEY?.trim();
  if (!apiKey) {
    return { accept: "application/json" };
  }
  return {
    accept: "application/json",
    "x-api-key": apiKey
  };
}

function sharedHogswapGate(): RequestGate {
  if (hogswapRequestGate === undefined) {
    hogswapRequestGate = createRequestGate({
      concurrency: readPositiveInteger(
        process.env.HOGSWAP_HTTP_CONCURRENCY,
        HOGSWAP_DEFAULT_HTTP_CONCURRENCY
      ),
      delayMs: readNonNegativeInteger(process.env.HOGSWAP_HTTP_DELAY_MS, 50)
    });
  }
  return hogswapRequestGate;
}

async function hogswapGetJson(path: string): Promise<unknown> {
  const { fetch: fetchImpl } = resolveDependencies();
  const url = `${hogswapBaseUrl()}${path}`;
  return sharedHogswapGate().run(() =>
    retryRateLimited(
      async () => {
        const response = await fetchImpl(url, { headers: hogswapHeaders() });
        if (response.status === 429) {
          const error = new HogswapClientError(
            `HOGSWAP returned HTTP 429 for ${path}.`,
            429
          );
          (error as HogswapClientError & { status: number }).status = 429;
          throw error;
        }
        if (!response.ok) {
          throw new HogswapClientError(
            `HOGSWAP ${path} returned HTTP ${response.status}.`,
            response.status
          );
        }
        return (await response.json()) as unknown;
      },
      {
        maxRetries: readNonNegativeInteger(process.env.HOGSWAP_429_MAX_RETRIES, 2),
        baseDelayMs: readNonNegativeInteger(
          process.env.HOGSWAP_429_RETRY_BASE_MS,
          250
        ),
        getStatus: (error) =>
          error instanceof HogswapClientError ? error.status : undefined
      }
    )
  );
}

/**
 * LP-id catalog: STAMM ids from `/stamm/pools` `tier_breakdown`, other DEX
 * ids from paginated `/pools` `lp_asset_id`. Cached like other position catalogs.
 */
export async function fetchHogswapLpCatalog(): Promise<
  Map<number, HogswapLpCatalogEntry>
> {
  const now = resolveDependencies().now();
  if (catalogCache && catalogCache.expiresAt > now) {
    return catalogCache.value;
  }
  if (catalogInFlight !== undefined) {
    return catalogInFlight;
  }
  catalogInFlight = fetchHogswapLpCatalogFromSource(now);
  try {
    return await catalogInFlight;
  } finally {
    catalogInFlight = undefined;
  }
}

async function fetchHogswapLpCatalogFromSource(
  now: number
): Promise<Map<number, HogswapLpCatalogEntry>> {
  const [stammPayload, pools] = await Promise.all([
    hogswapGetJson("/stamm/pools"),
    fetchAllHogswapPools()
  ]);
  const catalog = new Map<number, HogswapLpCatalogEntry>();
  for (const pool of pools) {
    const lpAssetId = parseSafePositiveInteger(pool.lp_asset_id);
    if (lpAssetId === null) {
      continue;
    }
    catalog.set(lpAssetId, catalogEntryFromPool(pool, lpAssetId, null));
  }
  // STAMM LP ids live on tier_breakdown, not pool.lp_asset_id (usually null).
  for (const pool of asObjectArray(asRecord(stammPayload)?.pools)) {
    const poolId = parseSafePositiveInteger(pool.pool_id);
    if (poolId === null) {
      continue;
    }
    for (const tier of asObjectArray(pool.tier_breakdown)) {
      const lpAssetId = parseSafePositiveInteger(tier.lp_asset_id);
      if (lpAssetId === null) {
        continue;
      }
      catalog.set(
        lpAssetId,
        catalogEntryFromPool(
          pool,
          lpAssetId,
          parseNonNegativeInteger(tier.index),
          parseNonNegativeInteger(tier.lp_decimals)
        )
      );
    }
  }
  catalogCache = {
    expiresAt:
      now +
      readNonNegativeInteger(
        process.env.POSITIONS_CATALOG_TTL_MS,
        5 * 60 * 1000
      ),
    value: catalog
  };
  return catalog;
}

async function fetchAllHogswapPools(): Promise<Record<string, unknown>[]> {
  const pools: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  const maxPages = readPositiveInteger(process.env.HOGSWAP_POOLS_MAX_PAGES, 50);
  for (let page = 0; page < maxPages; page += 1) {
    const query = new URLSearchParams({
      limit: String(readPositiveInteger(process.env.HOGSWAP_POOLS_PAGE_LIMIT, 500))
    });
    if (cursor) {
      query.set("cursor", cursor);
    }
    const payload = asRecord(await hogswapGetJson(`/pools?${query.toString()}`));
    const pagePools = asObjectArray(payload?.pools);
    pools.push(...pagePools);
    const next = payload?.next_cursor;
    if (typeof next !== "string" || next.length === 0) {
      break;
    }
    cursor = next;
  }
  return pools;
}

function catalogEntryFromPool(
  pool: Record<string, unknown>,
  lpAssetId: number,
  tierIndex: number | null,
  lpDecimals: number | null = null
): HogswapLpCatalogEntry {
  const dexName =
    typeof pool.dex_name === "string" && pool.dex_name.trim().length > 0
      ? pool.dex_name.trim()
      : "unknown";
  const protocol = mapHogswapDexToProtocol(dexName);
  return {
    lpAssetId,
    poolId: parseSafePositiveInteger(pool.pool_id) ?? lpAssetId,
    dexKind: parseSafePositiveInteger(pool.dex_kind),
    dexName,
    protocol,
    dedicatedCollector: isDedicatedLpCollectorDex(dexName),
    tierIndex,
    assetA: parseSafeNonNegativeInteger(pool.asset_a),
    assetB: parseSafeNonNegativeInteger(pool.asset_b),
    lpDecimals
  };
}

export function mapHogswapDexToProtocol(
  dexName: string
): HogswapLpProtocol | null {
  const normalized = dexName.trim().toLowerCase();
  if (normalized === "stamm") {
    return "stamm";
  }
  if (normalized.startsWith("algofi")) {
    return "algofi";
  }
  if (normalized.startsWith("humble")) {
    return "humble";
  }
  return null;
}

export function isDedicatedLpCollectorDex(dexName: string): boolean {
  const normalized = dexName.trim().toLowerCase();
  return DEDICATED_LP_COLLECTOR_DEX_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix)
  );
}

export async function fetchHogswapLpValuation(
  assetId: number,
  amount: bigint
): Promise<HogswapLpValuation> {
  const query = new URLSearchParams({ amount: amount.toString() });
  return parseHogswapLpValuation(
    await hogswapGetJson(`/lp/${assetId}?${query.toString()}`)
  );
}

export function parseHogswapLpValuation(
  payload: unknown
): HogswapLpValuation {
  const record = asRecord(payload);
  if (record === null) {
    throw new HogswapClientError("HOGSWAP LP valuation is missing asset_id.");
  }
  const assetId = parseSafePositiveInteger(record.asset_id);
  if (assetId === null) {
    throw new HogswapClientError("HOGSWAP LP valuation is missing asset_id.");
  }
  return {
    assetId,
    poolId: parseSafePositiveInteger(record.pool_id),
    dexKind: parseSafePositiveInteger(record.dex_kind),
    dexName: typeof record.dex_name === "string" ? record.dex_name : null,
    tierIndex: parseNonNegativeInteger(record.tier_index),
    assetA: parseSafeNonNegativeInteger(record.asset_a),
    assetB: parseSafeNonNegativeInteger(record.asset_b),
    poolTvlUsdMicro: parseNullableNonNegativeNumber(record.pool_tvl_usd_micro),
    tvlConfidenceBps: parseNullableNonNegativeNumber(record.tvl_confidence_bps),
    asOfRound: parseSafePositiveInteger(record.as_of_round),
    lpSupply: parseUnsignedBigInt(record.lp_supply),
    lpDecimals: parseNonNegativeInteger(record.lp_decimals),
    reserveAMicro: parseUnsignedBigInt(record.reserve_a_micro),
    reserveBMicro: parseUnsignedBigInt(record.reserve_b_micro),
    perLpAssetAMicro: parseUnsignedBigInt(record.per_lp_asset_a_micro),
    perLpAssetBMicro: parseUnsignedBigInt(record.per_lp_asset_b_micro),
    valuePerLpUsdMicro: parseNullableNonNegativeNumber(
      record.value_per_lp_usd_micro
    ),
    amount: parseUnsignedBigInt(record.amount),
    valueUsdMicro: parseNullableNonNegativeNumber(record.value_usd_micro),
    redeemableAssetAMicro: parseUnsignedBigInt(record.redeemable_asset_a_micro),
    redeemableAssetBMicro: parseUnsignedBigInt(record.redeemable_asset_b_micro)
  };
}

/**
 * Bulk price map for leftover wallet assets on the same positions payload.
 * Not a full portfolio product — callers should pass only ids they still need.
 */
export async function fetchHogswapAnalyticsPrices(
  assetIds?: readonly number[]
): Promise<HogswapAnalyticsPrices> {
  const payload = asRecord(await hogswapGetJson("/analytics/prices"));
  const prices = new Map<number, HogswapAnalyticsPrice>();
  const rawPrices = asRecord(payload?.prices) ?? {};
  const wanted =
    assetIds === undefined ? undefined : new Set(assetIds);
  for (const [key, value] of Object.entries(rawPrices)) {
    const assetId = parseSafeNonNegativeInteger(key);
    if (assetId === null || (wanted !== undefined && !wanted.has(assetId))) {
      continue;
    }
    const row = asRecord(value);
    prices.set(assetId, {
      priceAlgo: parseNullableNonNegativeNumber(
        row?.price_algo ?? row?.priceAlgo
      ),
      priceUsd: parseNullableNonNegativeNumber(row?.price_usd ?? row?.priceUsd),
      confidenceBps: parseNullableNonNegativeNumber(
        row?.confidence_bps ?? row?.confidenceBps
      )
    });
  }
  return {
    algoUsd: parseNullableNonNegativeNumber(payload?.algo_usd),
    asOfRound: parseSafePositiveInteger(payload?.as_of_round),
    asOfTs: parseNullableNonNegativeNumber(payload?.as_of_ts),
    prices
  };
}

export async function mapHogswapRequests<T>(
  items: readonly T[],
  worker: (item: T) => Promise<void>
): Promise<void> {
  await mapWithThrottle(
    items,
    {
      concurrency: readPositiveInteger(
        process.env.HOGSWAP_HTTP_CONCURRENCY,
        HOGSWAP_DEFAULT_HTTP_CONCURRENCY
      ),
      delayMs: 0
    },
    worker
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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
    typeof value === "number" || typeof value === "string"
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseSafeNonNegativeInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number" || typeof value === "string"
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseNonNegativeInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number" || typeof value === "string"
      ? Number(value)
      : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseNullableNonNegativeNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed =
    typeof value === "number" || typeof value === "string"
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function readNonNegativeInteger(
  value: string | undefined,
  fallback: number
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
