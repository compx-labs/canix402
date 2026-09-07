import { PactClient } from "@pactfi/pactsdk";
import type { Algodv2 } from "algosdk";

import {
  addressToStringForPact,
  createPactBuilderAlgodClient,
  createPactCompatibleAlgodClient
} from "../execution/shapes/pact/pool-state.js";
import { toSdkAmount } from "../execution/shapes/pact/parse-input.js";
import type { ExecutionNetwork } from "../execution/types.js";

export const PACT_SMART_ROUTER_DEFAULT_API_BASE = "https://api.pact.fi/api";
export const PACT_SMART_ROUTER_MAX_HOPS = 3;
export const PACT_SMART_ROUTER_MAX_POOLS_PER_PAIR = 4;
export const PACT_SMART_ROUTER_MAX_NEIGHBORS = 12;
export const PACT_SMART_ROUTER_MAX_PATHS = 48;

/**
 * Spike result (NEO-351): `@pactfi/pactsdk` has no Smart Router helpers, and
 * public swagger (`GET /prices`) plus live probes of `/api/quote`, `/api/router`,
 * `router.pact.fi`, etc. do not expose a route-quote HTTP API. Canix quotes by:
 * 1. discovering pools via `GET {PACT_API_BASE_URL}/pools` (fallback `/pools/all`)
 * 2. per-hop `Pool.prepareSwap` against on-chain reserves
 * 3. a local 1–3 hop graph (best fee-tier pool per hop)
 */
export const PACT_SMART_ROUTER_QUOTE_SOURCE = {
  discoveryHttp: "GET {PACT_API_BASE_URL}/pools (paginated; fallback GET /pools/all)",
  hopQuote: "@pactfi/pactsdk Pool.prepareSwap (on-chain reserves via algod)",
  routeSolver: "Canix local graph: 1–3 hops, up to four fee-tier pools per pair",
  sdkRouterModule: false,
  publicQuoteHttp: false
} as const;

export type PactSmartRouterErrorKind =
  | "configuration"
  | "validation"
  | "upstream"
  | "no-route";

export class PactSmartRouterError extends Error {
  constructor(
    message: string,
    readonly kind: PactSmartRouterErrorKind,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "PactSmartRouterError";
  }
}

export interface PactRouterPool {
  poolAppId: number;
  primaryAssetId: number;
  secondaryAssetId: number;
  escrowAddress?: string;
  feeBps: number;
  tvlUsd: number;
  verified: boolean;
}

export interface PactRouterHop {
  poolAppId: number;
  poolEscrowAddress: string;
  fromAssetId: number;
  toAssetId: number;
  amountIn: bigint;
  amountOut: bigint;
  feeBps: number;
}

export interface PactSmartRouterQuote {
  fromAssetId: number;
  toAssetId: number;
  amountIn: bigint;
  amountOut: bigint;
  minAmountOut: bigint;
  maxSlippageBps: number;
  hops: PactRouterHop[];
  quoteSource: typeof PACT_SMART_ROUTER_QUOTE_SOURCE;
}

export interface QuotePactSmartRouterRequest {
  fromAssetId: number;
  toAssetId: number;
  amount: bigint;
  maxSlippageBps: number;
  network?: ExecutionNetwork;
  algod?: Algodv2;
}

interface PactSmartRouterDependencies {
  fetch: typeof fetch;
  fetchPools: () => Promise<PactRouterPool[]>;
  quoteHop: (params: {
    pool: PactRouterPool;
    fromAssetId: number;
    amountIn: bigint;
    network: ExecutionNetwork;
    algod?: Algodv2;
  }) => Promise<PactRouterHop | null>;
}

let dependencyOverrides: Partial<PactSmartRouterDependencies> | undefined;

export function setPactSmartRouterDependenciesForTests(
  overrides?: Partial<PactSmartRouterDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): PactSmartRouterDependencies {
  return {
    fetch: globalThis.fetch.bind(globalThis),
    fetchPools: defaultFetchPools,
    quoteHop: defaultQuoteHop,
    ...dependencyOverrides
  };
}

export function resolvePactSmartRouterAppId(override?: number): number {
  if (override !== undefined) {
    if (!Number.isInteger(override) || override <= 0) {
      throw new PactSmartRouterError(
        "routerAppId must be a positive integer application id.",
        "validation",
        { routerAppId: override }
      );
    }
    return override;
  }
  const raw = process.env.PACT_SMART_ROUTER_APP_ID;
  if (raw === undefined || raw.trim() === "") {
    throw new PactSmartRouterError(
      "PACT_SMART_ROUTER_APP_ID is not configured. Pass routerAppId on the shape input or set the env var. Canix does not ship a guessed mainnet Smart Router app id.",
      "configuration"
    );
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new PactSmartRouterError(
      "PACT_SMART_ROUTER_APP_ID must be a positive integer application id.",
      "configuration",
      { value: raw }
    );
  }
  return parsed;
}

export function applyPactSmartRouterMinOut(
  amountOut: bigint,
  maxSlippageBps: number
): bigint {
  if (maxSlippageBps <= 0) {
    return amountOut;
  }
  return (amountOut * BigInt(10_000 - maxSlippageBps)) / 10_000n;
}

export async function quotePactSmartRouter(
  request: QuotePactSmartRouterRequest
): Promise<PactSmartRouterQuote> {
  if (request.fromAssetId === request.toAssetId) {
    throw new PactSmartRouterError(
      "fromAssetId and toAssetId must be different assets.",
      "validation",
      { fromAssetId: request.fromAssetId, toAssetId: request.toAssetId }
    );
  }
  if (request.amount <= 0n) {
    throw new PactSmartRouterError("amount must be greater than zero.", "validation");
  }

  const dependencies = resolveDependencies();
  const network = request.network ?? "mainnet";
  const pools = await dependencies.fetchPools();
  const assetPaths = findAssetPaths(pools, request.fromAssetId, request.toAssetId);
  if (assetPaths.length === 0) {
    throw new PactSmartRouterError(
      "No Pact Smart Router path of 1–3 hops connects the requested assets.",
      "no-route",
      { fromAssetId: request.fromAssetId, toAssetId: request.toAssetId }
    );
  }

  let best: PactRouterHop[] | undefined;
  let bestOut = -1n;

  for (const assets of assetPaths) {
    const hops = await quoteAssetPath({
      assets,
      pools,
      amountIn: request.amount,
      network,
      algod: request.algod,
      quoteHop: dependencies.quoteHop
    });
    if (hops === undefined) {
      continue;
    }
    const out = hops[hops.length - 1]?.amountOut ?? 0n;
    if (out > bestOut) {
      bestOut = out;
      best = hops;
    }
  }

  if (best === undefined || bestOut <= 0n) {
    throw new PactSmartRouterError(
      "Pact Smart Router found candidate pools but every hop quote failed (empty pool or insufficient liquidity).",
      "no-route",
      { fromAssetId: request.fromAssetId, toAssetId: request.toAssetId }
    );
  }

  return {
    fromAssetId: request.fromAssetId,
    toAssetId: request.toAssetId,
    amountIn: request.amount,
    amountOut: bestOut,
    minAmountOut: applyPactSmartRouterMinOut(bestOut, request.maxSlippageBps),
    maxSlippageBps: request.maxSlippageBps,
    hops: best,
    quoteSource: PACT_SMART_ROUTER_QUOTE_SOURCE
  };
}

export function findAssetPaths(
  pools: readonly PactRouterPool[],
  fromAssetId: number,
  toAssetId: number
): number[][] {
  const { neighbors, poolsByPair } = buildPoolGraph(pools);
  const paths: number[][] = [];

  const visit = (current: number, trail: number[], visited: Set<number>): void => {
    if (paths.length >= PACT_SMART_ROUTER_MAX_PATHS) {
      return;
    }
    if (trail.length >= PACT_SMART_ROUTER_MAX_HOPS + 1) {
      return;
    }
    const nextAssets = neighbors.get(current) ?? [];
    for (const next of nextAssets) {
      if (visited.has(next)) {
        continue;
      }
      const pairPools = poolsByPair.get(pairKey(current, next));
      if (pairPools === undefined || pairPools.length === 0) {
        continue;
      }
      const nextTrail = [...trail, next];
      if (next === toAssetId) {
        paths.push(nextTrail);
        if (paths.length >= PACT_SMART_ROUTER_MAX_PATHS) {
          return;
        }
        continue;
      }
      visited.add(next);
      visit(next, nextTrail, visited);
      visited.delete(next);
    }
  };

  visit(fromAssetId, [fromAssetId], new Set([fromAssetId]));
  return paths;
}

function buildPoolGraph(pools: readonly PactRouterPool[]): {
  neighbors: Map<number, number[]>;
  poolsByPair: Map<string, PactRouterPool[]>;
} {
  const poolsByPair = new Map<string, PactRouterPool[]>();
  for (const pool of pools) {
    if (pool.primaryAssetId === pool.secondaryAssetId) {
      continue;
    }
    const key = pairKey(pool.primaryAssetId, pool.secondaryAssetId);
    const list = poolsByPair.get(key) ?? [];
    list.push(pool);
    poolsByPair.set(key, list);
  }

  for (const [key, list] of poolsByPair) {
    list.sort((left, right) => right.tvlUsd - left.tvlUsd || right.poolAppId - left.poolAppId);
    poolsByPair.set(key, list.slice(0, PACT_SMART_ROUTER_MAX_POOLS_PER_PAIR));
  }

  const neighborScores = new Map<number, Map<number, number>>();
  const bump = (from: number, to: number, tvlUsd: number): void => {
    const inner = neighborScores.get(from) ?? new Map<number, number>();
    inner.set(to, Math.max(inner.get(to) ?? 0, tvlUsd));
    neighborScores.set(from, inner);
  };

  for (const pool of [...poolsByPair.values()].flat()) {
    bump(pool.primaryAssetId, pool.secondaryAssetId, pool.tvlUsd);
    bump(pool.secondaryAssetId, pool.primaryAssetId, pool.tvlUsd);
  }

  const neighbors = new Map<number, number[]>();
  for (const [assetId, inner] of neighborScores) {
    const ranked = [...inner.entries()]
      .sort((left, right) => right[1] - left[1] || right[0] - left[0])
      .slice(0, PACT_SMART_ROUTER_MAX_NEIGHBORS)
      .map(([other]) => other);
    neighbors.set(assetId, ranked);
  }

  return { neighbors, poolsByPair };
}

async function quoteAssetPath(params: {
  assets: readonly number[];
  pools: readonly PactRouterPool[];
  amountIn: bigint;
  network: ExecutionNetwork;
  algod?: Algodv2;
  quoteHop: PactSmartRouterDependencies["quoteHop"];
}): Promise<PactRouterHop[] | undefined> {
  const { poolsByPair } = buildPoolGraph(params.pools);
  const hops: PactRouterHop[] = [];
  let amount = params.amountIn;

  for (let index = 0; index < params.assets.length - 1; index += 1) {
    const fromAssetId = params.assets[index];
    const toAssetId = params.assets[index + 1];
    if (fromAssetId === undefined || toAssetId === undefined) {
      return undefined;
    }
    const candidates = poolsByPair.get(pairKey(fromAssetId, toAssetId)) ?? [];
    let bestHop: PactRouterHop | undefined;
    for (const pool of candidates) {
      const hop = await params.quoteHop({
        pool,
        fromAssetId,
        amountIn: amount,
        network: params.network,
        ...(params.algod === undefined ? {} : { algod: params.algod })
      });
      if (hop === null || hop.toAssetId !== toAssetId || hop.amountOut <= 0n) {
        continue;
      }
      if (bestHop === undefined || hop.amountOut > bestHop.amountOut) {
        bestHop = hop;
      }
    }
    if (bestHop === undefined) {
      return undefined;
    }
    hops.push(bestHop);
    amount = bestHop.amountOut;
  }

  return hops.length > 0 ? hops : undefined;
}

function pairKey(left: number, right: number): string {
  return left < right ? `${left}:${right}` : `${right}:${left}`;
}

async function defaultFetchPools(): Promise<PactRouterPool[]> {
  const base = trimTrailingSlash(
    process.env.PACT_API_BASE_URL ?? PACT_SMART_ROUTER_DEFAULT_API_BASE
  );
  const apiKey = process.env.PACT_API_KEY;
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  const fetchImpl = resolveDependencies().fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const fromPaged = await fetchPagedPools(
      `${base}/pools`,
      headers,
      controller.signal,
      fetchImpl
    );
    if (fromPaged.length > 0) {
      return fromPaged;
    }
    return await fetchPoolList(
      `${base}/pools/all?deprecated=false`,
      headers,
      controller.signal,
      fetchImpl
    );
  } catch (error) {
    if (error instanceof PactSmartRouterError) {
      throw error;
    }
    throw new PactSmartRouterError("Failed to fetch Pact pools for Smart Router discovery.", "upstream", {
      cause: error instanceof Error ? error.message : String(error)
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPagedPools(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  fetchImpl: typeof fetch
): Promise<PactRouterPool[]> {
  const collected: PactRouterPool[] = [];
  const limit = 200;
  let offset = 0;

  while (offset <= 5_000) {
    const separator = url.includes("?") ? "&" : "?";
    const pageUrl = `${url}${separator}limit=${limit}&offset=${offset}&deprecated=false`;
    const page = await fetchPoolList(pageUrl, headers, signal, fetchImpl);
    collected.push(...page);
    if (page.length < limit) {
      break;
    }
    offset += limit;
  }

  return dedupePools(collected);
}

async function fetchPoolList(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  fetchImpl: typeof fetch
): Promise<PactRouterPool[]> {
  const response = await fetchImpl(url, { headers, signal });
  if (!response.ok) {
    throw new PactSmartRouterError(
      `Pact pool discovery returned HTTP ${response.status}.`,
      "upstream",
      { url, status: response.status }
    );
  }
  const payload: unknown = await response.json();
  const records = extractPoolRecords(payload);
  return records
    .map(normalizeRouterPool)
    .filter((pool): pool is PactRouterPool => pool !== null);
}

function extractPoolRecords(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload !== null && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.results)) {
      return record.results;
    }
    if (Array.isArray(record.pools)) {
      return record.pools;
    }
  }
  return [];
}

function normalizeRouterPool(raw: unknown): PactRouterPool | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (record.is_deprecated === true) {
    return null;
  }
  const poolAppId = toPositiveInt(record.on_chain_id ?? record.id);
  const primaryAssetId = assetIdFromField(record.primary_asset);
  const secondaryAssetId = assetIdFromField(record.secondary_asset);
  if (poolAppId === null || primaryAssetId === null || secondaryAssetId === null) {
    return null;
  }
  const escrow =
    typeof record.address === "string" && record.address.length > 0 ? record.address : undefined;
  const feeBps = toNonNegativeInt(record.fee_bps) ?? 0;
  const tvlUsd = toFiniteNumber(record.tvl_usd) ?? 0;
  return {
    poolAppId,
    primaryAssetId,
    secondaryAssetId,
    ...(escrow === undefined ? {} : { escrowAddress: escrow }),
    feeBps,
    tvlUsd,
    verified: record.is_verified === true
  };
}

function assetIdFromField(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number" || typeof value === "string") {
    return toNonNegativeInt(value);
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return toNonNegativeInt(record.algoid ?? record.on_chain_id ?? record.index);
  }
  return null;
}

function toPositiveInt(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  if (parsed === null || !Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function toNonNegativeInt(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  if (parsed === null || !Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function dedupePools(pools: PactRouterPool[]): PactRouterPool[] {
  const byId = new Map<number, PactRouterPool>();
  for (const pool of pools) {
    const existing = byId.get(pool.poolAppId);
    if (existing === undefined || pool.tvlUsd > existing.tvlUsd) {
      byId.set(pool.poolAppId, pool);
    }
  }
  return [...byId.values()];
}

async function defaultQuoteHop(params: {
  pool: PactRouterPool;
  fromAssetId: number;
  amountIn: bigint;
  network: ExecutionNetwork;
  algod?: Algodv2;
}): Promise<PactRouterHop | null> {
  try {
    const amount = toSdkAmount(params.amountIn, "amount");
    const pactClient = new PactClient(
      createPactCompatibleAlgodClient(
        params.algod ?? createPactBuilderAlgodClient()
      ) as unknown as ConstructorParameters<typeof PactClient>[0],
      { network: params.network }
    );
    const pool = await pactClient.fetchPoolById(params.pool.poolAppId);
    const deposited =
      params.fromAssetId === pool.primaryAsset.index
        ? pool.primaryAsset
        : params.fromAssetId === pool.secondaryAsset.index
          ? pool.secondaryAsset
          : undefined;
    if (deposited === undefined) {
      return null;
    }
    const swap = pool.prepareSwap({
      asset: deposited,
      amount,
      slippagePct: 0
    });
    if (swap.effect.amountReceived <= 0) {
      return null;
    }
    return {
      poolAppId: pool.appId,
      poolEscrowAddress: addressToStringForPact(pool.getEscrowAddress(), "pool.escrowAddress"),
      fromAssetId: swap.assetDeposited.index,
      toAssetId: swap.assetReceived.index,
      amountIn: BigInt(swap.effect.amountDeposited),
      amountOut: BigInt(swap.effect.amountReceived),
      feeBps: pool.feeBps
    };
  } catch {
    return null;
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
