import { buildSourceMetadata } from "../services/source-metadata.js";
import { OpportunityMarketRecord } from "../types/opportunity.js";
import { createBaseEvmClient } from "../execution/evm.js";
import {
  isEvmAddress,
  isNativeEthAsset,
  normalizeEvmAddress
} from "../execution/evm.js";
import { getAppLogger } from "../observability/logger.js";
import { skipLiveCatalogInTests } from "./offline-test-runtime.js";
import {
  AerodromeLp,
  AerodromeSugarDecodeError,
  BASE_MULTICALL3,
  decodeLpSugarAll,
  decodeSugarCount,
  decodeTryAggregate,
  encodeSugarAllCall,
  encodeSugarCountCall,
  encodeTryAggregateCall
} from "./aerodrome-sugar.js";

export const DEFAULT_AERODROME_SUGAR_ADDRESS =
  "0x69dd9db6d8f8e7d83887a704f447b1a584b599a1";
export const AERODROME_POOL_FACTORY =
  "0x420dd381b31aef6683db6b902084cb0ffece40da";
export const AERODROME_ROUTER =
  "0xcf77a3ba9a5ca399b7c97c74d54e5b1beb874e43";
export const AERODROME_VOTER =
  "0x16613524e02ad97edfef371bc883f2f5d6c480a5";
export const AERODROME_AERO =
  "0x940181a94a35a4569e4529a3cdfb74e38fd98631";
export const AERODROME_FARM_OPPORTUNITY_ID_PREFIX = "aerodrome-farm-";
export const DEFAULT_AERODROME_PRICE_URL = "https://coins.llama.fi/prices/current";
export const DEFAULT_AERODROME_MIN_TVL_USD = 50_000;
export const DEFAULT_AERODROME_PAGE_SIZE = 200;
export const DEFAULT_AERODROME_CATALOG_TTL_SEC = 600;
export const DEFAULT_AERODROME_MULTICALL_PAGES = 8;

/** How long a failed refresh keeps serving the previous snapshot before trying again. */
const AERODROME_STALE_CATALOG_MS = 60_000;
const SUGAR_CALL_TIMEOUT_MS = 20_000;
const SUGAR_MAX_ATTEMPTS = 5;
const SUGAR_RETRY_BASE_MS = 400;
const SUGAR_PAGE_GAP_MS = 250;

const SECONDS_PER_YEAR = 31_536_000n;
const PRICE_BATCH = 30;

export interface AerodromeTokenPrice {
  usd: number;
  symbol: string;
  decimals: number;
}

export interface AerodromePoolSnapshot {
  pool: string;
  gauge: string;
  stable: boolean;
  assetPair: string;
  lpDecimals: number;
  totalSupply: bigint;
  tvlUsd: number;
}

export class AerodromeAdapterError extends Error {
  public readonly cause?: unknown;

  public constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "AerodromeAdapterError";
    this.cause = cause;
  }
}

export interface AerodromeAdapterDependencies {
  listPools: () => Promise<AerodromeLp[]>;
  fetchPrices: (tokens: readonly string[]) => Promise<Map<string, AerodromeTokenPrice>>;
  minTvlUsd: number;
  nowMs: () => number;
  catalogTtlMs: number;
}

interface CatalogCache {
  expiresAt: number;
  records: OpportunityMarketRecord[];
  snapshots: AerodromePoolSnapshot[];
}

let dependencyOverrides: Partial<AerodromeAdapterDependencies> | undefined;
let catalogCache: CatalogCache | undefined;
let catalogRefresh: Promise<CatalogCache> | undefined;

export function setAerodromeAdapterDependenciesForTests(
  overrides?: Partial<AerodromeAdapterDependencies>
): void {
  dependencyOverrides = overrides;
  catalogCache = undefined;
  catalogRefresh = undefined;
}

export function aerodromeFarmOpportunityId(pool: string): string {
  return `${AERODROME_FARM_OPPORTUNITY_ID_PREFIX}${normalizeEvmAddress(pool)}`;
}

export function parseAerodromePoolAddress(opportunityId: string): string | null {
  if (!opportunityId.startsWith(AERODROME_FARM_OPPORTUNITY_ID_PREFIX)) {
    return null;
  }
  const address = opportunityId.slice(AERODROME_FARM_OPPORTUNITY_ID_PREFIX.length);
  return isEvmAddress(address) ? normalizeEvmAddress(address) : null;
}

export async function fetchAerodromeOpportunities(): Promise<OpportunityMarketRecord[]> {
  return (await loadCatalog()).records;
}

export async function fetchAerodromePoolSnapshots(): Promise<AerodromePoolSnapshot[]> {
  return (await loadCatalog()).snapshots;
}

export function normalizeAerodromePool(
  lp: AerodromeLp,
  prices: ReadonlyMap<string, AerodromeTokenPrice>,
  fetchedAtIso: string = new Date().toISOString(),
  options: { minTvlUsd?: number } = {}
): OpportunityMarketRecord | null {
  const classified = classifyAerodromePool(lp, prices, fetchedAtIso, options.minTvlUsd);
  return classified?.record ?? null;
}

function resolveDependencies(): AerodromeAdapterDependencies {
  const skipLive = skipLiveCatalogInTests(dependencyOverrides);
  return {
    listPools: skipLive ? rejectLiveAerodromeCatalog : listSugarPools,
    fetchPrices: skipLive ? rejectLiveAerodromePrices : fetchDefiLlamaPrices,
    minTvlUsd: readMinTvlUsd(),
    nowMs: () => Date.now(),
    catalogTtlMs: readCatalogTtlSec() * 1000,
    ...dependencyOverrides
  };
}

async function rejectLiveAerodromeCatalog(): Promise<AerodromeLp[]> {
  throw new AerodromeAdapterError(
    "Live Aerodrome catalog is disabled in CI/tests."
  );
}

async function rejectLiveAerodromePrices(): Promise<Map<string, AerodromeTokenPrice>> {
  throw new AerodromeAdapterError(
    "Live Aerodrome prices are disabled in CI/tests."
  );
}

async function loadCatalog(): Promise<CatalogCache> {
  const deps = resolveDependencies();
  const now = deps.nowMs();
  if (catalogCache !== undefined && catalogCache.expiresAt > now) {
    return catalogCache;
  }
  if (catalogRefresh !== undefined) {
    return catalogRefresh;
  }

  const refresh = refreshCatalog(deps, now).finally(() => {
    if (catalogRefresh === refresh) {
      catalogRefresh = undefined;
    }
  });
  catalogRefresh = refresh;
  // A full Sugar scan takes long enough to trip request timeouts. Serve the
  // previous snapshot immediately and let this refresh replace it.
  if (catalogCache !== undefined) {
    return catalogCache;
  }
  return refresh;
}

async function refreshCatalog(
  deps: AerodromeAdapterDependencies,
  now: number
): Promise<CatalogCache> {
  try {
    const loaded = await buildCatalog(deps, now);
    if (deps.catalogTtlMs > 0) {
      catalogCache = loaded;
    }
    return loaded;
  } catch (error) {
    if (catalogCache !== undefined && deps.catalogTtlMs > 0) {
      catalogCache = {
        ...catalogCache,
        expiresAt: deps.nowMs() + AERODROME_STALE_CATALOG_MS
      };
      getAppLogger().warn(
        {
          event: "aerodrome_catalog_stale",
          err: error instanceof Error ? error.message : String(error)
        },
        "Aerodrome catalog refresh failed; serving the previous snapshot"
      );
      return catalogCache;
    }
    throw error;
  }
}

async function buildCatalog(
  deps: AerodromeAdapterDependencies,
  now: number
): Promise<CatalogCache> {
  const fetchedAt = new Date(now).toISOString();
  const pools = await deps.listPools();
  const candidates = pools.filter(isStructurallyListed);
  const tokens = uniqueTokens(candidates);
  const prices = tokens.length === 0 ? new Map() : await deps.fetchPrices(tokens);
  const records: OpportunityMarketRecord[] = [];
  const snapshots: AerodromePoolSnapshot[] = [];
  for (const lp of candidates) {
    const classified = classifyAerodromePool(lp, prices, fetchedAt, deps.minTvlUsd);
    if (classified === null) {
      continue;
    }
    records.push(classified.record);
    snapshots.push(classified.snapshot);
  }

  return {
    expiresAt: now + deps.catalogTtlMs,
    records,
    snapshots
  };
}

function classifyAerodromePool(
  lp: AerodromeLp,
  prices: ReadonlyMap<string, AerodromeTokenPrice>,
  fetchedAtIso: string,
  minTvlUsd: number = DEFAULT_AERODROME_MIN_TVL_USD
): { record: OpportunityMarketRecord; snapshot: AerodromePoolSnapshot } | null {
  if (!isStructurallyListed(lp)) {
    return null;
  }
  const token0 = normalizeEvmAddress(lp.token0);
  const token1 = normalizeEvmAddress(lp.token1);
  const pool = normalizeEvmAddress(lp.lp);
  const gauge = normalizeEvmAddress(lp.gauge);
  const price0 = prices.get(token0);
  const price1 = prices.get(token1);
  const emissionsToken = normalizeEvmAddress(lp.emissionsToken);
  const emissionsPrice = prices.get(emissionsToken);
  if (price0 === undefined || price1 === undefined || emissionsPrice === undefined) {
    return null;
  }

  const tvlUsd = tokenUsd(lp.reserve0, price0) + tokenUsd(lp.reserve1, price1);
  const stakedTvlUsd = tokenUsd(lp.staked0, price0) + tokenUsd(lp.staked1, price1);
  if (!Number.isFinite(tvlUsd) || tvlUsd < minTvlUsd || stakedTvlUsd <= 0) {
    return null;
  }

  const emissionsUsdPerYear = tokenUsd(lp.emissions * SECONDS_PER_YEAR, emissionsPrice);
  const apy = (emissionsUsdPerYear / stakedTvlUsd) * 100;
  if (!Number.isFinite(apy) || apy < 0) {
    return null;
  }

  const stable = lp.type === 0;
  const assetPair = `${price0.symbol}/${price1.symbol}`;
  const notes = [
    `${stable ? "stable" : "volatile"} Aerodrome pool`,
    `staked LPs earn ${emissionsPrice.symbol} emissions`,
    "trading fees accrue to voters, not stakers"
  ].join("; ");

  return {
    record: {
      protocol: "aerodrome",
      opportunityType: "farm",
      opportunityId: aerodromeFarmOpportunityId(pool),
      assetPair,
      chain: "base",
      assetAddresses: [token0, token1],
      poolId: pool,
      apy,
      yieldBasis: "apy",
      tvlUsd,
      ...buildSourceMetadata({
        fetchedAtIso,
        contextNotes: [notes]
      })
    },
    snapshot: {
      pool,
      gauge,
      stable,
      assetPair,
      lpDecimals: lp.decimals,
      totalSupply: lp.liquidity,
      tvlUsd
    }
  };
}

function isStructurallyListed(lp: AerodromeLp): boolean {
  if (lp.type !== 0 && lp.type !== -1) {
    return false;
  }
  if (!lp.gaugeAlive || lp.emissions <= 0n) {
    return false;
  }
  if (
    !isEvmAddress(lp.lp) ||
    !isEvmAddress(lp.token0) ||
    !isEvmAddress(lp.token1) ||
    !isEvmAddress(lp.gauge) ||
    !isEvmAddress(lp.emissionsToken) ||
    !isEvmAddress(lp.factory)
  ) {
    return false;
  }
  if (
    isNativeEthAsset(lp.token0) ||
    isNativeEthAsset(lp.token1) ||
    isNativeEthAsset(lp.gauge) ||
    isNativeEthAsset(lp.emissionsToken)
  ) {
    return false;
  }
  if (normalizeEvmAddress(lp.factory) !== AERODROME_POOL_FACTORY) {
    return false;
  }
  if (!Number.isInteger(lp.decimals) || lp.decimals < 0 || lp.decimals > 36) {
    return false;
  }
  return true;
}

function uniqueTokens(pools: readonly AerodromeLp[]): string[] {
  const tokens = new Set<string>();
  for (const lp of pools) {
    tokens.add(normalizeEvmAddress(lp.token0));
    tokens.add(normalizeEvmAddress(lp.token1));
    tokens.add(normalizeEvmAddress(lp.emissionsToken));
  }
  return [...tokens];
}

function tokenUsd(amount: bigint, price: AerodromeTokenPrice): number {
  if (amount <= 0n || price.usd < 0 || !Number.isInteger(price.decimals)) {
    return 0;
  }
  const scale = 10n ** BigInt(price.decimals);
  const whole = amount / scale;
  const fraction = amount % scale;
  return (Number(whole) + Number(fraction) / Number(scale)) * price.usd;
}

export interface SugarPoolReadOptions {
  sugar: string;
  pageSize: number;
  pagesPerCall: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Walk `LpSugar.count()` and read `all(limit, offset, 1)` through Multicall3.
 * A full scan is tens of thousands of pools. Batching keeps the public Base
 * RPC under its rate limit, and a reverted page is split and retried.
 */
export async function readAerodromeSugarPools(
  call: (to: string, data: string) => Promise<string>,
  options: SugarPoolReadOptions
): Promise<AerodromeLp[]> {
  const sleep = options.sleep ?? delay;
  const pageSize = BigInt(options.pageSize);
  const pagesPerCall = options.pagesPerCall;
  let count: bigint;
  try {
    count = decodeSugarCount(
      await withTransientRetries(() => call(options.sugar, encodeSugarCountCall()), sleep)
    );
  } catch (error) {
    throw sugarFailure("Aerodrome Sugar count() failed.", error);
  }

  const offsets: bigint[] = [];
  for (let offset = 0n; offset < count; offset += pageSize) {
    offsets.push(offset);
  }

  const pools: AerodromeLp[] = [];
  for (let index = 0; index < offsets.length; index += pagesPerCall) {
    if (index > 0) {
      await sleep(SUGAR_PAGE_GAP_MS);
    }
    const chunk = offsets.slice(index, index + pagesPerCall);
    pools.push(...(await readSugarChunk(call, options.sugar, pageSize, chunk, sleep)));
  }
  return pools;
}

async function listSugarPools(): Promise<AerodromeLp[]> {
  const client = createBaseEvmClient(undefined, fetch, { timeoutMs: SUGAR_CALL_TIMEOUT_MS });
  return readAerodromeSugarPools((to, data) => client.call(to, data), {
    sugar: readSugarAddress(),
    pageSize: readPageSize(),
    pagesPerCall: readMulticallPages()
  });
}

async function readSugarChunk(
  call: (to: string, data: string) => Promise<string>,
  sugar: string,
  pageSize: bigint,
  offsets: readonly bigint[],
  sleep: (ms: number) => Promise<void>
): Promise<AerodromeLp[]> {
  if (offsets.length === 1) {
    return readSugarPage(call, sugar, pageSize, offsets[0] as bigint, sleep);
  }

  try {
    const encoded = await withTransientRetries(
      () =>
        call(
          BASE_MULTICALL3,
          encodeTryAggregateCall(
            offsets.map((offset) => ({
              target: sugar,
              data: encodeSugarAllCall(pageSize, offset)
            }))
          )
        ),
      sleep
    );
    const parts = decodeTryAggregate(encoded);
    if (parts.length !== offsets.length) {
      throw new AerodromeSugarDecodeError("Multicall page count did not match the request.");
    }
    const pools: AerodromeLp[] = [];
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const offset = offsets[index] as bigint;
      if (part === undefined || !part.success) {
        pools.push(...(await readSugarPage(call, sugar, pageSize, offset, sleep)));
        continue;
      }
      try {
        pools.push(...decodeLpSugarAll(part.returnData));
      } catch (error) {
        if (!(error instanceof AerodromeSugarDecodeError)) {
          throw error;
        }
        pools.push(...(await readSugarPage(call, sugar, pageSize, offset, sleep)));
      }
    }
    return pools;
  } catch (error) {
    if (error instanceof AerodromeAdapterError) {
      throw error;
    }
    if (isTransientFailure(error)) {
      throw sugarFailure("Aerodrome Sugar all() failed.", error);
    }
    const midpoint = Math.ceil(offsets.length / 2);
    const left = await readSugarChunk(
      call,
      sugar,
      pageSize,
      offsets.slice(0, midpoint),
      sleep
    );
    const right = await readSugarChunk(call, sugar, pageSize, offsets.slice(midpoint), sleep);
    return [...left, ...right];
  }
}

async function readSugarPage(
  call: (to: string, data: string) => Promise<string>,
  sugar: string,
  pageSize: bigint,
  offset: bigint,
  sleep: (ms: number) => Promise<void>
): Promise<AerodromeLp[]> {
  try {
    const encoded = await withTransientRetries(
      () => call(sugar, encodeSugarAllCall(pageSize, offset)),
      sleep
    );
    return decodeLpSugarAll(encoded);
  } catch (error) {
    if (error instanceof AerodromeSugarDecodeError) {
      throw new AerodromeAdapterError(error.message, error);
    }
    throw sugarFailure("Aerodrome Sugar all() failed.", error);
  }
}

async function fetchDefiLlamaPrices(
  tokens: readonly string[]
): Promise<Map<string, AerodromeTokenPrice>> {
  const prices = new Map<string, AerodromeTokenPrice>();
  const base = (process.env.AERODROME_PRICE_URL?.trim() || DEFAULT_AERODROME_PRICE_URL).replace(
    /\/$/,
    ""
  );
  for (let index = 0; index < tokens.length; index += PRICE_BATCH) {
    const batch = tokens.slice(index, index + PRICE_BATCH);
    const url = `${base}/${batch.map((token) => `base:${token}`).join(",")}`;
    const payload = await getJson(url);
    const coins = isRecord(payload.coins) ? payload.coins : null;
    if (coins === null) {
      throw new AerodromeAdapterError("Aerodrome price response did not include coins.");
    }
    for (const [key, value] of Object.entries(coins)) {
      const price = readTokenPrice(value);
      const address = key.split(":")[1];
      if (price !== null && address !== undefined && isEvmAddress(address)) {
        prices.set(normalizeEvmAddress(address), price);
      }
    }
  }
  return prices;
}

async function getJson(url: string): Promise<Record<string, unknown>> {
  return withTransientRetries(() => getJsonOnce(url));
}

async function getJsonOnce(url: string): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new AerodromeAdapterError(
        `Aerodrome price request returned non-2xx status: ${response.status}`
      );
    }
    const payload = (await response.json()) as unknown;
    if (!isRecord(payload)) {
      throw new AerodromeAdapterError("Aerodrome price response was not an object.");
    }
    return payload;
  } catch (error) {
    if (error instanceof AerodromeAdapterError) {
      throw error;
    }
    throw sugarFailure("Aerodrome price request failed.", error);
  } finally {
    clearTimeout(timeout);
  }
}

function readTokenPrice(value: unknown): AerodromeTokenPrice | null {
  if (!isRecord(value)) {
    return null;
  }
  const usd = typeof value.price === "number" ? value.price : Number(value.price);
  const decimals = typeof value.decimals === "number" ? value.decimals : Number(value.decimals);
  const symbol = typeof value.symbol === "string" ? value.symbol.trim() : "";
  if (!Number.isFinite(usd) || usd < 0 || !Number.isInteger(decimals) || decimals < 0) {
    return null;
  }
  if (symbol.length === 0) {
    return null;
  }
  return { usd, decimals, symbol };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSugarAddress(): string {
  const configured = process.env.AERODROME_SUGAR_ADDRESS?.trim();
  const address =
    configured && configured.length > 0 ? configured : DEFAULT_AERODROME_SUGAR_ADDRESS;
  if (!isEvmAddress(address)) {
    throw new AerodromeAdapterError("AERODROME_SUGAR_ADDRESS is not an EVM address.");
  }
  return normalizeEvmAddress(address);
}

function readPageSize(): number {
  return readBoundedInteger(
    process.env.AERODROME_SUGAR_PAGE_SIZE,
    DEFAULT_AERODROME_PAGE_SIZE,
    1,
    200
  );
}

function readMulticallPages(): number {
  return readBoundedInteger(
    process.env.AERODROME_SUGAR_MULTICALL_PAGES,
    DEFAULT_AERODROME_MULTICALL_PAGES,
    1,
    DEFAULT_AERODROME_MULTICALL_PAGES
  );
}

function sugarFailure(message: string, error: unknown): AerodromeAdapterError {
  const detail = error instanceof Error ? error.message : String(error);
  const text = detail.length > 0 && !message.includes(detail) ? `${message} ${detail}` : message;
  return new AerodromeAdapterError(text, error);
}

function isTransientFailure(error: unknown): boolean {
  return /\b(408|429|500|502|503|504)\b|timeout|timed out|aborted|rate limit|too many requests|ECONNRESET|fetch failed|EAI_AGAIN|socket|eth_call failed|no result/i.test(
    failureText(error)
  );
}

function failureText(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      parts.push(current.message);
      current = current.cause;
      continue;
    }
    parts.push(String(current));
    break;
  }
  return parts.join(" ");
}

async function withTransientRetries<T>(
  work: () => Promise<T>,
  sleep: (ms: number) => Promise<void> = delay
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < SUGAR_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      last = error;
      if (attempt === SUGAR_MAX_ATTEMPTS - 1 || !isTransientFailure(error)) {
        throw error;
      }
      await sleep(SUGAR_RETRY_BASE_MS * 2 ** attempt);
    }
  }
  throw last;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readMinTvlUsd(): number {
  const parsed = Number(process.env.AERODROME_MIN_TVL_USD);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return DEFAULT_AERODROME_MIN_TVL_USD;
}

function readCatalogTtlSec(): number {
  return readBoundedInteger(
    process.env.AERODROME_CATALOG_TTL_SEC,
    DEFAULT_AERODROME_CATALOG_TTL_SEC,
    0,
    86_400
  );
}

function readBoundedInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}
