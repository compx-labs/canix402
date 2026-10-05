import algosdk from "algosdk";

import {
  BONDING_ON_CURVE,
  HAYSTACK_BUY_BONDING_SHAPE_KEY,
  HAYSTACK_LAUNCH_LIST_CACHE_MS
} from "../execution/shapes/haystack/launch-constants.js";
import {
  bondingProgressPercent,
  multiplierLabel,
  priceInBondingToken,
  priceUsd,
  type HaystackLaunchTokenInfo
} from "../execution/shapes/haystack/launch-codec.js";
import {
  readTokenInfoBox,
  readTokenNumForAsset,
  searchIndexedLaunches,
  simulateLaunchAbi
} from "../execution/shapes/haystack/launch-chain.js";
import type { IndexedTokenLaunch } from "../execution/shapes/haystack/launch-indexer.js";
import {
  filterAndSortLaunches,
  resolveLaunchWindow,
  type HaystackLaunchListQuery,
  type HaystackLaunchListRow
} from "../execution/shapes/haystack/launch-query.js";
import { BONDING_TOKEN_PRICE_METHOD, USER_HOLDINGS_METHOD } from "../execution/shapes/haystack/launch-spec.js";
import { createExecutionAlgodClient } from "../execution/shapes/haystack/shared.js";

export class HaystackLaunchError extends Error {
  constructor(
    message: string,
    readonly kind: "validation" | "not-found" | "upstream",
    readonly details?: unknown
  ) {
    super(message);
    this.name = "HaystackLaunchError";
  }
}

export interface HaystackLaunchListData {
  launchedAfter: string;
  launchedBefore: string;
  order: "asc" | "desc";
  total: number;
  launches: HaystackLaunchListRow[];
}

export interface HaystackLaunchDetail {
  tokenNum: number;
  assetId: number;
  name: string;
  symbol: string;
  assetUrl: string;
  description: string;
  socialWebsite: string;
  socialX: string;
  socialTelegram: string;
  socialDiscord: string;
  creator: string;
  bondingTokenId: number;
  bondingOn: number;
  phase: "bonding" | "graduated";
  progressPercent: number;
  priceBonding: string;
  priceUsd: string | null;
  realTokenReserves: string;
  realBondingReserves: string;
  initialRealTokenReserves: string;
  virtualTokenReserves: string;
  virtualBondingReserves: string;
  bondingTargetUsd: string;
  priceMultiplier: string;
  poolAppId: number;
  lpTokenId: number;
  buyShapeKey: string | null;
  userHolding: string | null;
  note: string | null;
}

export interface HaystackLaunchServiceDependencies {
  now: () => number;
  searchLaunches: (afterIso: string, beforeIso: string) => Promise<IndexedTokenLaunch[]>;
  readToken: (tokenNum: number) => Promise<HaystackLaunchTokenInfo | null>;
  readTokenNumForAsset: (assetId: number) => Promise<number | null>;
  bondingTokenPrice: (bondingTokenId: number) => Promise<bigint | null>;
  userHolding: (tokenNum: number, address: string) => Promise<bigint>;
}

let dependencyOverrides: Partial<HaystackLaunchServiceDependencies> | undefined;
let listCache: { key: string; at: number; rows: HaystackLaunchListRow[] } | undefined;

export function setHaystackLaunchDependenciesForTests(
  overrides?: Partial<HaystackLaunchServiceDependencies>
): void {
  dependencyOverrides = overrides;
  listCache = undefined;
}

export function resetHaystackLaunchCacheForTests(): void {
  listCache = undefined;
}

function dependencies(): HaystackLaunchServiceDependencies {
  return {
    now: () => Date.now(),
    searchLaunches: defaultSearchLaunches,
    readToken: (tokenNum) => readTokenInfoBox(createExecutionAlgodClient(), tokenNum),
    readTokenNumForAsset: (assetId) =>
      readTokenNumForAsset(createExecutionAlgodClient(), assetId),
    bondingTokenPrice: defaultBondingTokenPrice,
    userHolding: defaultUserHolding,
    ...dependencyOverrides
  };
}

export async function listHaystackLaunches(
  query: HaystackLaunchListQuery
): Promise<HaystackLaunchListData> {
  const deps = dependencies();
  const now = deps.now();
  const window = resolveLaunchWindow(now, query);
  assertWindow(window.launchedAfter, window.launchedBefore);
  const bucket = Math.floor(now / HAYSTACK_LAUNCH_LIST_CACHE_MS);
  const cacheKey = `${window.launchedAfter}|${window.launchedBefore}|${bucket}`;
  let rows = listCache && listCache.key === cacheKey && now - listCache.at < HAYSTACK_LAUNCH_LIST_CACHE_MS
    ? listCache.rows
    : undefined;
  if (rows === undefined) {
    rows = await loadBondingRows(deps, window.launchedAfter, window.launchedBefore);
    listCache = { key: cacheKey, at: now, rows };
  }
  const page = filterAndSortLaunches(rows, query);
  return {
    launchedAfter: window.launchedAfter,
    launchedBefore: window.launchedBefore,
    order: page.order,
    total: page.total,
    launches: page.launches
  };
}

export async function getHaystackLaunch(params: {
  tokenNum?: number;
  assetId?: number;
  address?: string;
}): Promise<HaystackLaunchDetail> {
  const deps = dependencies();
  const tokenNum = await resolveTokenNum(deps, params.tokenNum, params.assetId);
  const info = await deps.readToken(tokenNum);
  if (info === null) {
    throw new HaystackLaunchError(`HayLaunch token ${tokenNum} was not found.`, "not-found", {
      tokenNum
    });
  }
  const oracle = await deps.bondingTokenPrice(info.bondingTokenId);
  const phase = info.bondingOn === BONDING_ON_CURVE ? "bonding" : "graduated";
  let userHolding: string | null = null;
  if (params.address) {
    userHolding = (await deps.userHolding(info.tokenNum, params.address)).toString();
  }
  return {
    ...presentToken(info, oracle),
    bondingOn: info.bondingOn,
    description: info.description,
    socialWebsite: info.socialWebsite,
    socialX: info.socialX,
    socialTelegram: info.socialTelegram,
    socialDiscord: info.socialDiscord,
    virtualTokenReserves: info.virtualTokenReserves.toString(),
    virtualBondingReserves: info.virtualBondingReserves.toString(),
    poolAppId: info.poolAppId,
    lpTokenId: info.lpTokenId,
    phase,
    buyShapeKey: phase === "bonding" ? HAYSTACK_BUY_BONDING_SHAPE_KEY : null,
    userHolding,
    note:
      phase === "graduated"
        ? "This token has graduated to its Pact pool. Buy it with POST /swaps/quote, not the bonding buy shape."
        : null
  };
}

async function loadBondingRows(
  deps: HaystackLaunchServiceDependencies,
  afterIso: string,
  beforeIso: string
): Promise<HaystackLaunchListRow[]> {
  let indexed: IndexedTokenLaunch[];
  try {
    indexed = await deps.searchLaunches(afterIso, beforeIso);
  } catch (error) {
    throw new HaystackLaunchError("Failed to read HayLaunch creates from the indexer.", "upstream", {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  const prices = new Map<number, bigint | null>();
  const rows: HaystackLaunchListRow[] = [];
  for (const launch of indexed) {
    const info = await deps.readToken(launch.tokenNum);
    if (info === null || info.bondingOn !== BONDING_ON_CURVE) {
      continue;
    }
    if (!prices.has(info.bondingTokenId)) {
      prices.set(info.bondingTokenId, await deps.bondingTokenPrice(info.bondingTokenId));
    }
    const oracle = prices.get(info.bondingTokenId) ?? null;
    rows.push({
      ...presentToken(info, oracle),
      launchedAt: launch.launchedAt,
      buyShapeKey: HAYSTACK_BUY_BONDING_SHAPE_KEY
    });
  }
  return rows;
}

function presentToken(
  info: HaystackLaunchTokenInfo,
  oracle: bigint | null
): Omit<HaystackLaunchListRow, "launchedAt" | "buyShapeKey"> {
  return {
    tokenNum: info.tokenNum,
    assetId: info.assetId,
    name: info.name,
    symbol: info.symbol,
    assetUrl: info.assetUrl,
    creator: info.tokenCreator,
    bondingTokenId: info.bondingTokenId,
    progressPercent: bondingProgressPercent(info),
    priceBonding: priceInBondingToken(info),
    priceUsd: oracle === null ? null : priceUsd(info, oracle),
    realTokenReserves: info.realTokenReserves.toString(),
    realBondingReserves: info.realBondingReserves.toString(),
    initialRealTokenReserves: info.initialRealTokenReserves.toString(),
    bondingTargetUsd: info.bondingTargetUsd.toString(),
    priceMultiplier: multiplierLabel(info.tokenPriceMultiplier)
  };
}

async function resolveTokenNum(
  deps: HaystackLaunchServiceDependencies,
  tokenNum: number | undefined,
  assetId: number | undefined
): Promise<number> {
  if (assetId !== undefined) {
    const mapped = await deps.readTokenNumForAsset(assetId);
    if (mapped === null) {
      throw new HaystackLaunchError(
        "That asset is not in the HayLaunch asset map yet. Pass tokenNum from the launch instead.",
        "not-found",
        { assetId }
      );
    }
    return mapped;
  }
  if (tokenNum === undefined) {
    throw new HaystackLaunchError("Pass tokenNum or assetId.", "validation");
  }
  return tokenNum;
}

function assertWindow(afterIso: string, beforeIso: string): void {
  const after = Date.parse(afterIso);
  const before = Date.parse(beforeIso);
  if (!Number.isFinite(after) || !Number.isFinite(before)) {
    throw new HaystackLaunchError("launchedAfter and launchedBefore must be ISO timestamps.", "validation");
  }
  if (after > before) {
    throw new HaystackLaunchError("launchedAfter must be at or before launchedBefore.", "validation");
  }
}

async function defaultSearchLaunches(afterIso: string, beforeIso: string): Promise<IndexedTokenLaunch[]> {
  return searchIndexedLaunches({
    indexer: createIndexerClient(),
    afterIso,
    beforeIso
  });
}

async function defaultBondingTokenPrice(bondingTokenId: number): Promise<bigint | null> {
  try {
    const value = await simulateLaunchAbi({
      algod: createExecutionAlgodClient(),
      method: BONDING_TOKEN_PRICE_METHOD,
      methodArgs: [bondingTokenId]
    });
    return BigInt(value as bigint | number | string);
  } catch {
    return null;
  }
}

async function defaultUserHolding(tokenNum: number, address: string): Promise<bigint> {
  const value = await simulateLaunchAbi({
    algod: createExecutionAlgodClient(),
    method: USER_HOLDINGS_METHOD,
    methodArgs: [tokenNum, address],
    sender: address
  });
  return BigInt(value as bigint | number | string);
}

function createIndexerClient(): algosdk.Indexer {
  return new algosdk.Indexer(
    process.env.X402_INDEXER_TOKEN ?? "",
    trimSlash(process.env.X402_INDEXER_URL ?? "https://mainnet-idx.algonode.cloud"),
    ""
  );
}

function trimSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
