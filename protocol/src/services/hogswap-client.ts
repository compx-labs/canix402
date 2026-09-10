import {
  createRequestGate,
  mapWithThrottle,
  retryRateLimited,
  type RequestGate
} from "./request-throttle.js";

export const HOGSWAP_DEFAULT_BASE_URL = "https://hogswap-v1.liquihog.dev";

/** HOGSWAP allows 4 in-flight requests per IP. Stay under that. */
export const HOGSWAP_DEFAULT_HTTP_CONCURRENCY = 2;

/** Per-request abort. Matches Tinyman (8s); Pact uses 15s. */
export const HOGSWAP_DEFAULT_HTTP_TIMEOUT_MS = 8_000;

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
  public readonly body: unknown;

  public constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = "HogswapClientError";
    this.status = status;
    this.body = body;
  }
}

/** Quote id expired (~30s) or was never issued. Callers should re-quote. */
export class HogswapQuoteExpiredError extends HogswapClientError {
  public constructor(message: string, status?: number, body?: unknown) {
    super(message, status, body);
    this.name = "HogswapQuoteExpiredError";
  }
}

/** Signer is missing an output / LP ASA opt-in required by /execute. */
export class HogswapMissingOptInError extends HogswapClientError {
  public readonly assetIds: number[];

  public constructor(message: string, assetIds: number[] = [], status?: number, body?: unknown) {
    super(message, status, body);
    this.name = "HogswapMissingOptInError";
    this.assetIds = assetIds;
  }
}

/** No route exists for the requested pair/size (`POST /quote` HTTP 404). */
export class HogswapNoRouteError extends HogswapClientError {
  public constructor(message: string, status?: number, body?: unknown) {
    super(message, status, body);
    this.name = "HogswapNoRouteError";
  }
}

/** HOGSWAP quote lifetime used by STAMM mint/redeem shapes (matches Haystack compose). */
export const HOGSWAP_QUOTE_TTL_MS = 30_000;

export const HOGSWAP_LP_DEFAULT_SLIPPAGE_BPS = 100;

/** SWAP OpenAPI default (`slippage_bps`). Distinct from the LP SDK default of 100. */
export const HOGSWAP_SWAP_DEFAULT_SLIPPAGE_BPS = 50;

/** SWAP OpenAPI default (`max_hops`). */
export const HOGSWAP_SWAP_DEFAULT_MAX_HOPS = 3;

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
  return hogswapRequestJson("GET", path);
}

async function hogswapPostJson(path: string, body: unknown): Promise<unknown> {
  return hogswapRequestJson("POST", path, body);
}

async function hogswapRequestJson(
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<unknown> {
  const { fetch: fetchImpl } = resolveDependencies();
  const url = `${hogswapBaseUrl()}${path}`;
  return sharedHogswapGate().run(() =>
    retryRateLimited(
      async () => {
        const headers: Record<string, string> = {
          ...(hogswapHeaders() as Record<string, string>)
        };
        const timeoutMs = readPositiveInteger(
          process.env.HOGSWAP_HTTP_TIMEOUT_MS,
          HOGSWAP_DEFAULT_HTTP_TIMEOUT_MS
        );
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const init: RequestInit = { method, headers, signal: controller.signal };
        if (method === "POST") {
          headers["content-type"] = "application/json";
          init.body = JSON.stringify(body ?? {});
        }
        try {
          const response = await fetchImpl(url, init);
          const payload = await readJsonBody(response);
          if (response.status === 429) {
            throw new HogswapClientError(
              `HOGSWAP returned HTTP 429 for ${path}.`,
              429,
              payload
            );
          }
          if (!response.ok) {
            throw mapHogswapHttpError(path, response.status, payload);
          }
          return payload;
        } catch (error) {
          if (isAbortError(error)) {
            throw new HogswapClientError(
              `HOGSWAP ${path} timed out after ${timeoutMs}ms.`
            );
          }
          throw error;
        } finally {
          clearTimeout(timeout);
        }
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

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function mapHogswapHttpError(
  path: string,
  status: number,
  payload: unknown
): HogswapClientError {
  const detail = hogswapErrorDetail(payload);
  const message =
    detail.length > 0
      ? `HOGSWAP ${path} returned HTTP ${status}: ${detail}`
      : `HOGSWAP ${path} returned HTTP ${status}.`;
  if (status === 404 && (path === "/execute" || path.startsWith("/execute"))) {
    return new HogswapQuoteExpiredError(message, status, payload);
  }
  if (status === 404 && (path === "/quote" || path.startsWith("/quote"))) {
    return new HogswapNoRouteError(message, status, payload);
  }
  if (status === 422 && isMissingOptInMessage(detail)) {
    return new HogswapMissingOptInError(
      message,
      parseMissingOptInAssetIds(payload),
      status,
      payload
    );
  }
  return new HogswapClientError(message, status, payload);
}

function hogswapErrorDetail(payload: unknown): string {
  if (typeof payload === "string") {
    return payload;
  }
  const record = asRecord(payload);
  if (record === null) {
    return "";
  }
  if (typeof record.detail === "string") {
    return record.detail;
  }
  if (Array.isArray(record.detail)) {
    return record.detail
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        const row = asRecord(entry);
        return typeof row?.msg === "string" ? row.msg : JSON.stringify(entry);
      })
      .join("; ");
  }
  if (typeof record.message === "string") {
    return record.message;
  }
  return "";
}

function isMissingOptInMessage(detail: string): boolean {
  return /opt[-\s]?in/i.test(detail);
}

function parseMissingOptInAssetIds(payload: unknown): number[] {
  const record = asRecord(payload);
  if (record === null) {
    return [];
  }
  const candidates = [record.assets, record.asset_ids, asRecord(record.detail)?.assets];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }
    return candidate
      .map((value) => parseSafeNonNegativeInteger(value))
      .filter((value): value is number => value !== null);
  }
  return [];
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

export interface HogswapStammAssetMeta {
  assetId: number;
  unitName: string | null;
  name: string | null;
  decimals: number | null;
}

export interface HogswapLpExternalInput {
  assetId: number;
  amount: bigint;
}

export interface HogswapLpMintQuoteRequest {
  poolAppId: number;
  tierIndex: number;
  amountA?: bigint;
  amountB?: bigint;
  externalInputs?: readonly HogswapLpExternalInput[];
  slippageBps?: number;
  maxLegs?: number;
  sender?: string;
}

export interface HogswapLpRedeemQuoteRequest {
  poolAppId: number;
  tierIndex: number;
  lpAmount: bigint;
  targetAsset: number;
  slippageBps?: number;
  maxLegs?: number;
  sender?: string;
}

export interface HogswapLpQuoteExtras {
  mode: string;
  poolAppId: number;
  tierIndex: number;
  lpAssetId: number;
  requiresMultiDeposit: boolean;
  expectedLpOut: number;
  usedPoolRatio: boolean;
  targetAsset: number;
  expectedAOut: number;
  expectedBOut: number;
}

export interface HogswapQuoteLeg {
  poolId: number;
  dexKind: number;
  dexName: string;
  assetIn: number;
  assetOut: number;
  plannedIn: number;
  plannedOut: number;
}

export interface HogswapPathBreakdown {
  assets: number[];
  inputAmount: number;
  outputAmount: number;
}

export interface HogswapSwapQuoteRequest {
  assetIn: number;
  assetOut: number;
  amountIn?: bigint;
  amountOut?: bigint;
  slippageBps?: number;
  maxHops?: number;
  maxLegs?: number;
  sender?: string;
}

export interface HogswapQuote {
  quoteId: string;
  mode: string;
  assetIn: number;
  assetOut: number;
  amountIn: number;
  expectedOut: number;
  expectedOutRobust: number;
  minOutAtSlippage: number;
  slippageBps: number;
  networkFeeMicroalgo: number;
  deposits: Array<{ assetId: number; amount: number }>;
  lp: HogswapLpQuoteExtras | null;
  legs: HogswapQuoteLeg[];
  pathBreakdown: HogswapPathBreakdown[];
  coverAlgoFee: boolean;
  requestedOut: number | null;
  maxInAtSlippage: number | null;
  /**
   * Router fee already deducted from `expectedOut` / `minOutAtSlippage`.
   * Do not subtract this again when scoring net out.
   */
  routerFeeBpsNominal: number;
  routerFeeBpsEffective: number;
  routerFeeAmount: number;
  routerFeeAmountUndiscounted: number;
  routerFeeAsset: number | null;
  hogHoldingsMicro: number | null;
  hogDiscountPct: number | null;
  quotedAtMs: number;
  raw: Record<string, unknown>;
}

/** Route/fee fields filled when an upstream quote omits them (LP payloads). */
export function hogswapQuoteRouteDefaults(): Pick<
  HogswapQuote,
  | "legs"
  | "pathBreakdown"
  | "coverAlgoFee"
  | "requestedOut"
  | "maxInAtSlippage"
  | "routerFeeBpsNominal"
  | "routerFeeBpsEffective"
  | "routerFeeAmount"
  | "routerFeeAmountUndiscounted"
  | "routerFeeAsset"
  | "hogHoldingsMicro"
  | "hogDiscountPct"
> {
  return {
    legs: [],
    pathBreakdown: [],
    coverAlgoFee: false,
    requestedOut: null,
    maxInAtSlippage: null,
    routerFeeBpsNominal: 0,
    routerFeeBpsEffective: 0,
    routerFeeAmount: 0,
    routerFeeAmountUndiscounted: 0,
    routerFeeAsset: null,
    hogHoldingsMicro: null,
    hogDiscountPct: null
  };
}

export interface HogswapExecuteResult {
  quoteId: string;
  unsignedGroup: Array<{ txnB64: string; description: string }>;
  routerAppId: number;
  groupIdB64: string;
  assetIn: number | null;
  assetOut: number | null;
  amountIn: number | null;
  minOutAtSlippage: number | null;
  networkFeeMicroalgo: number | null;
  notes: string[];
  raw: Record<string, unknown>;
}

/**
 * STAMM pool catalog from `GET /stamm/pools`. Market-data is edge-cached ~5s
 * upstream; Canix does not add a second long-lived cache here (opportunity
 * Redis cache covers list routes).
 */
export async function fetchStammPools(): Promise<Record<string, unknown>[]> {
  const payload = asRecord(await hogswapGetJson("/stamm/pools?active_only=true&sort=tvl"));
  return asObjectArray(payload?.pools);
}

/**
 * Chain metadata for STAMM-referenced assets (`GET /stamm/assets`).
 * Decimals/names are static; fetch once per process via the shared HTTP gate.
 */
export async function fetchStammAssets(): Promise<Map<number, HogswapStammAssetMeta>> {
  const payload = asRecord(await hogswapGetJson("/stamm/assets"));
  const assets = new Map<number, HogswapStammAssetMeta>();
  if (payload === null) {
    return assets;
  }
  for (const [key, value] of Object.entries(payload)) {
    const assetId = parseSafeNonNegativeInteger(key);
    if (assetId === null) {
      continue;
    }
    const row = asRecord(value);
    assets.set(assetId, {
      assetId,
      unitName:
        typeof row?.unit_name === "string" && row.unit_name.trim().length > 0
          ? row.unit_name.trim()
          : null,
      name: typeof row?.name === "string" && row.name.trim().length > 0 ? row.name.trim() : null,
      decimals: parseNonNegativeInteger(row?.decimals)
    });
  }
  return assets;
}

export async function quoteHogswapSwap(
  request: HogswapSwapQuoteRequest
): Promise<HogswapQuote> {
  const hasAmountIn = request.amountIn !== undefined;
  const hasAmountOut = request.amountOut !== undefined;
  if (hasAmountIn === hasAmountOut) {
    throw new HogswapClientError("SWAP quote requires exactly one of amountIn or amountOut.");
  }
  if (request.assetIn === request.assetOut) {
    throw new HogswapClientError("SWAP quote assetIn and assetOut must differ.");
  }
  const body: Record<string, unknown> = {
    mode: "SWAP",
    asset_in: request.assetIn,
    asset_out: request.assetOut,
    slippage_bps: request.slippageBps ?? HOGSWAP_SWAP_DEFAULT_SLIPPAGE_BPS,
    max_hops: request.maxHops ?? HOGSWAP_SWAP_DEFAULT_MAX_HOPS
  };
  if (hasAmountIn) {
    body.amount_in = numberFromBigInt(request.amountIn!, "amountIn");
  } else {
    body.amount_out = numberFromBigInt(request.amountOut!, "amountOut");
  }
  if (request.maxLegs !== undefined) {
    body.max_legs = request.maxLegs;
  }
  if (request.sender !== undefined && request.sender.length > 0) {
    body.sender = request.sender;
  }
  return parseHogswapQuote(await hogswapPostJson("/quote", body));
}

export async function quoteHogswapLpMint(
  request: HogswapLpMintQuoteRequest
): Promise<HogswapQuote> {
  const body: Record<string, unknown> = {
    mode: "LP_MINT",
    pool_app_id: request.poolAppId,
    tier_index: request.tierIndex,
    slippage_bps: request.slippageBps ?? HOGSWAP_LP_DEFAULT_SLIPPAGE_BPS
  };
  if (request.amountA !== undefined) {
    body.amount_a = numberFromBigInt(request.amountA, "amountA");
  }
  if (request.amountB !== undefined) {
    body.amount_b = numberFromBigInt(request.amountB, "amountB");
  }
  if (request.externalInputs !== undefined && request.externalInputs.length > 0) {
    body.external_inputs = request.externalInputs.map((entry) => ({
      asset_id: entry.assetId,
      amount: numberFromBigInt(entry.amount, "externalInputs.amount")
    }));
  }
  if (request.maxLegs !== undefined) {
    body.max_legs = request.maxLegs;
  }
  if (request.sender !== undefined && request.sender.length > 0) {
    body.sender = request.sender;
  }
  return parseHogswapQuote(await hogswapPostJson("/quote", body));
}

export async function quoteHogswapLpRedeem(
  request: HogswapLpRedeemQuoteRequest
): Promise<HogswapQuote> {
  const body: Record<string, unknown> = {
    mode: "LP_REDEEM",
    pool_app_id: request.poolAppId,
    tier_index: request.tierIndex,
    lp_amount: numberFromBigInt(request.lpAmount, "lpAmount"),
    target_asset: request.targetAsset,
    slippage_bps: request.slippageBps ?? HOGSWAP_LP_DEFAULT_SLIPPAGE_BPS
  };
  if (request.maxLegs !== undefined) {
    body.max_legs = request.maxLegs;
  }
  if (request.sender !== undefined && request.sender.length > 0) {
    body.sender = request.sender;
  }
  return parseHogswapQuote(await hogswapPostJson("/quote", body));
}

export async function executeHogswapQuote(
  quoteId: string,
  userAddress: string
): Promise<HogswapExecuteResult> {
  return parseHogswapExecute(
    await hogswapPostJson("/execute", {
      quote_id: quoteId,
      user_address: userAddress
    })
  );
}

export function parseHogswapQuote(payload: unknown): HogswapQuote {
  const record = asRecord(payload);
  if (record === null) {
    throw new HogswapClientError("HOGSWAP quote response is not an object.");
  }
  const quoteId = typeof record.quote_id === "string" ? record.quote_id.trim() : "";
  if (quoteId.length === 0) {
    throw new HogswapClientError("HOGSWAP quote is missing quote_id.");
  }
  const lpRecord = asRecord(record.lp);
  const defaults = hogswapQuoteRouteDefaults();
  const mode = typeof record.mode === "string" ? record.mode : "SWAP";
  const isSwap = mode === "SWAP";
  const defaultSlippageBps = isSwap
    ? HOGSWAP_SWAP_DEFAULT_SLIPPAGE_BPS
    : HOGSWAP_LP_DEFAULT_SLIPPAGE_BPS;
  const expectedOut = requirePresentNonNegativeNumber(record.expected_out, "expected_out");
  return {
    quoteId,
    mode,
    assetIn: isSwap
      ? requirePresentNonNegativeInteger(record.asset_in, "asset_in")
      : parseSafeNonNegativeInteger(record.asset_in) ?? 0,
    assetOut: isSwap
      ? requirePresentNonNegativeInteger(record.asset_out, "asset_out")
      : parseSafeNonNegativeInteger(record.asset_out) ?? 0,
    amountIn: parseNullableNonNegativeNumber(record.amount_in) ?? 0,
    expectedOut,
    expectedOutRobust: parseNullableNonNegativeNumber(record.expected_out_robust) ?? expectedOut,
    minOutAtSlippage: requirePresentNonNegativeNumber(
      record.min_out_at_slippage,
      "min_out_at_slippage"
    ),
    slippageBps:
      parseNullableNonNegativeNumber(record.slippage_bps) ?? defaultSlippageBps,
    networkFeeMicroalgo: parseNullableNonNegativeNumber(record.network_fee_microalgo) ?? 0,
    deposits: asObjectArray(record.deposits).flatMap((deposit) => {
      const assetId = parseSafeNonNegativeInteger(deposit.asset_id);
      const amount = parseNullableNonNegativeNumber(deposit.amount);
      if (assetId === null || amount === null) {
        return [];
      }
      return [{ assetId, amount }];
    }),
    lp: lpRecord === null ? null : parseLpQuoteExtras(lpRecord),
    legs: parseHogswapLegs(record.legs),
    pathBreakdown: parseHogswapPathBreakdown(record.path_breakdown),
    coverAlgoFee: record.cover_algo_fee === true,
    requestedOut: parseNullableNonNegativeNumber(record.requested_out),
    maxInAtSlippage: parseNullableNonNegativeNumber(record.max_in_at_slippage),
    routerFeeBpsNominal:
      parseNullableNonNegativeNumber(record.router_fee_bps_nominal) ??
      defaults.routerFeeBpsNominal,
    routerFeeBpsEffective:
      parseNullableNonNegativeNumber(record.router_fee_bps_effective) ??
      defaults.routerFeeBpsEffective,
    routerFeeAmount:
      parseNullableNonNegativeNumber(record.router_fee_amount) ?? defaults.routerFeeAmount,
    routerFeeAmountUndiscounted:
      parseNullableNonNegativeNumber(record.router_fee_amount_undiscounted) ??
      defaults.routerFeeAmountUndiscounted,
    routerFeeAsset: parseSafeNonNegativeInteger(record.router_fee_asset),
    hogHoldingsMicro: parseNullableNonNegativeNumber(record.hog_holdings_micro),
    hogDiscountPct: parseNullableNonNegativeNumber(record.hog_discount_pct),
    quotedAtMs: resolveDependencies().now(),
    raw: record
  };
}

function parseHogswapLegs(value: unknown): HogswapQuoteLeg[] {
  return asObjectArray(value).flatMap((leg) => {
    const poolId = parseSafePositiveInteger(leg.pool_id);
    const dexKind = parseSafeNonNegativeInteger(leg.dex_kind);
    const assetIn = parseSafeNonNegativeInteger(leg.asset_in);
    const assetOut = parseSafeNonNegativeInteger(leg.asset_out);
    const plannedIn = parseNullableNonNegativeNumber(leg.planned_in);
    const plannedOut = parseNullableNonNegativeNumber(leg.planned_out);
    if (
      poolId === null ||
      dexKind === null ||
      assetIn === null ||
      assetOut === null ||
      plannedIn === null ||
      plannedOut === null
    ) {
      return [];
    }
    return [
      {
        poolId,
        dexKind,
        dexName: typeof leg.dex_name === "string" ? leg.dex_name : "",
        assetIn,
        assetOut,
        plannedIn,
        plannedOut
      }
    ];
  });
}

function parseHogswapPathBreakdown(value: unknown): HogswapPathBreakdown[] {
  return asObjectArray(value).flatMap((row) => {
    const assets = Array.isArray(row.assets)
      ? row.assets
          .map((asset) => parseSafeNonNegativeInteger(asset))
          .filter((asset): asset is number => asset !== null)
      : [];
    const inputAmount = parseNullableNonNegativeNumber(row.input_amount);
    const outputAmount = parseNullableNonNegativeNumber(row.output_amount);
    if (assets.length === 0 || inputAmount === null || outputAmount === null) {
      return [];
    }
    return [{ assets, inputAmount, outputAmount }];
  });
}

function parseLpQuoteExtras(record: Record<string, unknown>): HogswapLpQuoteExtras {
  return {
    mode: typeof record.mode === "string" ? record.mode : "LP_MINT",
    poolAppId: parseSafePositiveInteger(record.pool_app_id) ?? 0,
    tierIndex: parseNonNegativeInteger(record.tier_index) ?? 0,
    lpAssetId: parseSafePositiveInteger(record.lp_asset_id) ?? 0,
    requiresMultiDeposit: record.requires_multi_deposit === true,
    expectedLpOut: parseNullableNonNegativeNumber(record.expected_lp_out) ?? 0,
    usedPoolRatio: record.used_pool_ratio === true,
    targetAsset: parseSafeNonNegativeInteger(record.target_asset) ?? 0,
    expectedAOut: parseNullableNonNegativeNumber(record.expected_a_out) ?? 0,
    expectedBOut: parseNullableNonNegativeNumber(record.expected_b_out) ?? 0
  };
}

export function parseHogswapExecute(payload: unknown): HogswapExecuteResult {
  const record = asRecord(payload);
  if (record === null) {
    throw new HogswapClientError("HOGSWAP execute response is not an object.");
  }
  const quoteId = typeof record.quote_id === "string" ? record.quote_id.trim() : "";
  if (quoteId.length === 0) {
    throw new HogswapClientError("HOGSWAP execute is missing quote_id.");
  }
  const unsignedGroup = asObjectArray(record.unsigned_group).map((entry, index) => {
    const txnB64 = typeof entry.txn_b64 === "string" ? entry.txn_b64 : "";
    if (txnB64.length === 0) {
      throw new HogswapClientError(
        `HOGSWAP execute unsigned_group[${index}] is missing txn_b64.`
      );
    }
    return {
      txnB64,
      description: typeof entry.description === "string" ? entry.description : ""
    };
  });
  if (unsignedGroup.length === 0) {
    throw new HogswapClientError("HOGSWAP execute returned an empty unsigned_group.");
  }
  const routerAppId = parseSafePositiveInteger(record.router_app_id);
  if (routerAppId === null) {
    throw new HogswapClientError("HOGSWAP execute is missing router_app_id.");
  }
  const groupIdB64 = typeof record.group_id_b64 === "string" ? record.group_id_b64 : "";
  return {
    quoteId,
    unsignedGroup,
    routerAppId,
    groupIdB64,
    assetIn: parseSafeNonNegativeInteger(record.asset_in),
    assetOut: parseSafeNonNegativeInteger(record.asset_out),
    amountIn: parseNullableNonNegativeNumber(record.amount_in),
    minOutAtSlippage: parseNullableNonNegativeNumber(record.min_out_at_slippage),
    networkFeeMicroalgo: parseNullableNonNegativeNumber(record.network_fee_microalgo),
    notes: Array.isArray(record.notes)
      ? record.notes.filter((note): note is string => typeof note === "string")
      : [],
    raw: record
  };
}

function requirePresentNonNegativeInteger(value: unknown, field: string): number {
  const parsed = parseSafeNonNegativeInteger(value);
  if (parsed === null) {
    throw new HogswapClientError(`HOGSWAP quote is missing ${field}.`);
  }
  return parsed;
}

function requirePresentNonNegativeNumber(value: unknown, field: string): number {
  const parsed = parseNullableNonNegativeNumber(value);
  if (parsed === null) {
    throw new HogswapClientError(`HOGSWAP quote is missing ${field}.`);
  }
  return parsed;
}

function numberFromBigInt(value: bigint, field: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new HogswapClientError(`${field} exceeds JSON-safe integer range.`);
  }
  return Number(value);
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

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
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
