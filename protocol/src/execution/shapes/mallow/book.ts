import { loadPdexContext, pdexMarketAssetRefs, type PdexContext } from "@pdex/sdk/integration";
import type { PdexMarket, PdexPool } from "@pdex/sdk/readModels";
import type { PdexV2AppRefs, V2MarketAssetRefs } from "@pdex/sdk/transactions";

import { MALLOW_MARKETS, MALLOW_USDC_ASSET_ID, type MallowMarketSymbol } from "./constants.js";
import { mallowPdexConfig } from "./config.js";
import {
  closeFeeBpsFromRaw,
  collateralPrice12,
  maxLeverageFromRaw,
  openFeeBpsFromRaw,
  type MarketPriceBand
} from "./math.js";
import { selectMallowMarket } from "./markets.js";

export class MallowUpstreamError extends Error {
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MallowUpstreamError";
  }
}

export interface MallowPreparedMarket {
  market: MallowMarketSymbol;
  marketId: string;
  poolId: string;
  symbol: string;
  baseSymbol: string;
  quoteSymbol: string;
  prices: MarketPriceBand;
  maxLeverage: number | null;
  collateralAssetId: number;
  openFeeBps: bigint;
  closeFeeBps: bigint;
  collateralPrice12: bigint;
  orderOpsAppId: number;
  appRefs: PdexV2AppRefs;
  assetRefs: V2MarketAssetRefs;
  raw: Record<string, unknown>;
  status: "ok";
}

export interface MallowUnavailableMarket {
  market: MallowMarketSymbol;
  status: "unavailable";
  reason: string;
}

export type MallowMarketRow = MallowPreparedMarket | MallowUnavailableMarket;

export interface MallowOracleArgs {
  message: Uint8Array;
  signature: Uint8Array;
}

export interface MallowBook {
  markets: MallowMarketRow[];
  marketYieldRegistry?: Record<string, unknown>;
  quoteOpenLimit: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  orderOracle: (marketId: string, orderOpsAppId: number) => Promise<MallowOracleArgs>;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function priceBand(market: PdexMarket): MarketPriceBand {
  const prices = market.prices;
  return {
    ...(prices.index && prices.index > 0n ? { index: prices.index } : {}),
    ...(prices.indexMin && prices.indexMin > 0n ? { indexMin: prices.indexMin } : {}),
    ...(prices.indexMax && prices.indexMax > 0n ? { indexMax: prices.indexMax } : {}),
    ...(prices.short && prices.short > 0n ? { short: prices.short } : {}),
    ...(prices.shortMin && prices.shortMin > 0n ? { shortMin: prices.shortMin } : {})
  };
}

function poolForMarket(pools: readonly PdexPool[], market: PdexMarket): PdexPool | undefined {
  return (
    pools.find((pool) => pool.marketId === market.marketId) ??
    pools.find((pool) => pool.poolId === market.defaultPoolId)
  );
}

function collateralAssetId(market: PdexMarket): number | undefined {
  if (market.collateralAssetIds.includes(MALLOW_USDC_ASSET_ID)) {
    return MALLOW_USDC_ASSET_ID;
  }
  return market.collateralAssetIds[0];
}

export function prepareMallowBook(context: PdexContext): MallowBook {
  const orderOpsAppId = Number(context.appIds.PDexV2OrderOps ?? 0);
  const rows: MallowMarketRow[] = MALLOW_MARKETS.map((symbol) => {
    const market = selectMallowMarket(context.markets, symbol);
    if (!market) {
      return { market: symbol, status: "unavailable", reason: "market-unavailable" };
    }
    const pool = poolForMarket(context.pools, market);
    if (!pool) {
      return { market: symbol, status: "unavailable", reason: "pool-unavailable" };
    }
    const collateral = collateralAssetId(market);
    if (collateral === undefined || collateral !== MALLOW_USDC_ASSET_ID) {
      return { market: symbol, status: "unavailable", reason: "usdc-collateral-unavailable" };
    }
    if (!Number.isFinite(orderOpsAppId) || orderOpsAppId <= 0) {
      return { market: symbol, status: "unavailable", reason: "order-ops-unavailable" };
    }
    const raw = asRecord(market.raw);
    const prices = priceBand(market);
    return {
      market: symbol,
      status: "ok",
      marketId: market.marketId,
      poolId: pool.poolId,
      symbol: market.symbol,
      baseSymbol: market.baseSymbol,
      quoteSymbol: market.quoteSymbol,
      prices,
      maxLeverage: maxLeverageFromRaw(raw),
      collateralAssetId: collateral,
      openFeeBps: openFeeBpsFromRaw(raw),
      closeFeeBps: closeFeeBpsFromRaw(raw),
      collateralPrice12: collateralPrice12({ prices, raw }),
      orderOpsAppId,
      appRefs: context.appRefs,
      assetRefs: pdexMarketAssetRefs(market),
      raw
    };
  });

  const registry = context.resources?.market_yield_resource_registry;
  const marketYieldRegistry =
    registry && typeof registry === "object" && !Array.isArray(registry)
      ? (registry as Record<string, unknown>)
      : undefined;

  return {
    markets: rows,
    ...(marketYieldRegistry ? { marketYieldRegistry } : {}),
    quoteOpenLimit: async (body) => {
      const quote = await context.client.v2QuoteOrderOpenLimit(body);
      return asRecord(quote);
    },
    orderOracle: async (marketId, appId) => {
      const oracle = await context.client.v2OracleArgs({
        marketId,
        appId,
        target: "order_ops"
      });
      return { message: oracle.message, signature: oracle.signature };
    }
  };
}

let bookLoaderOverride: (() => Promise<MallowBook>) | undefined;

export function setMallowBookLoaderForTests(loader?: () => Promise<MallowBook>): void {
  bookLoaderOverride = loader;
}

export function loadMallowBookForRequest(): Promise<MallowBook> {
  return (bookLoaderOverride ?? loadMallowBook)();
}

export async function loadMallowBook(): Promise<MallowBook> {
  const config = mallowPdexConfig();
  try {
    const context = await loadPdexContext({
      baseUrl: config.proxyUrl,
      publicArtifactBaseUrl: config.artifactUrl,
      network: "mainnet"
    });
    return prepareMallowBook(context);
  } catch (error) {
    if (error instanceof MallowUpstreamError) {
      throw error;
    }
    throw new MallowUpstreamError("Mallow market data is unavailable.", { cause: error });
  }
}

export function readyMarket(
  book: MallowBook,
  symbol: MallowMarketSymbol
): MallowPreparedMarket | MallowUnavailableMarket {
  return (
    book.markets.find((row) => row.market === symbol) ?? {
      market: symbol,
      status: "unavailable",
      reason: "market-unavailable"
    }
  );
}
