import { buildSourceMetadata } from "../services/source-metadata.js";
import { OpportunityMarketRecord } from "../types/opportunity.js";
import { createBaseEvmClient } from "../execution/evm.js";
import {
  isEvmAddress,
  isNativeEthAsset,
  normalizeEvmAddress
} from "../execution/evm.js";
import { skipLiveCatalogInTests } from "./offline-test-runtime.js";
import {
  AerodromeLp,
  AerodromeSugarDecodeError,
  decodeLpSugarAll,
  decodeSugarCount,
  encodeSugarAllCall,
  encodeSugarCountCall
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
export const DEFAULT_AERODROME_PAGE_SIZE = 100;
export const DEFAULT_AERODROME_CATALOG_TTL_SEC = 600;

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

export function setAerodromeAdapterDependenciesForTests(
  overrides?: Partial<AerodromeAdapterDependencies>
): void {
  dependencyOverrides = overrides;
  catalogCache = undefined;
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

  const loaded = {
    expiresAt: now + deps.catalogTtlMs,
    records,
    snapshots
  };
  if (deps.catalogTtlMs > 0) {
    catalogCache = loaded;
  }
  return loaded;
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

async function listSugarPools(): Promise<AerodromeLp[]> {
  const client = createBaseEvmClient();
  const sugar = readSugarAddress();
  const pageSize = BigInt(readPageSize());
  let count: bigint;
  try {
    count = decodeSugarCount(await client.call(sugar, encodeSugarCountCall()));
  } catch (error) {
    throw new AerodromeAdapterError("Aerodrome Sugar count() failed.", error);
  }

  const pools: AerodromeLp[] = [];
  for (let offset = 0n; offset < count; offset += pageSize) {
    let page: AerodromeLp[];
    try {
      const encoded = await client.call(sugar, encodeSugarAllCall(pageSize, offset));
      page = decodeLpSugarAll(encoded);
    } catch (error) {
      if (error instanceof AerodromeSugarDecodeError) {
        throw new AerodromeAdapterError(error.message, error);
      }
      throw new AerodromeAdapterError("Aerodrome Sugar all() failed.", error);
    }
    pools.push(...page);
  }
  return pools;
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
    throw new AerodromeAdapterError("Aerodrome price request failed.", error);
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
