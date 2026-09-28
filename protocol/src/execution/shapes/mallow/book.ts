import { pdexBigInt } from "@pdex/sdk";
import { V2_ORDER_KIND } from "@pdex/sdk/constants";
import { loadPdexContext, pdexMarketAssetRefs, type PdexContext } from "@pdex/sdk/integration";
import type { MarketYieldActionRecallClient } from "@pdex/sdk/marketYield";
import type { PdexMarket, PdexPool } from "@pdex/sdk/readModels";
import { v2OrderLinkBase, v2OrderLinkMode, type PdexV2AppRefs, type V2MarketAssetRefs } from "@pdex/sdk/transactions";

import { MALLOW_MARKETS, MALLOW_USDC_ASSET_ID, type MallowMarketSymbol, type MallowSide } from "./constants.js";
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

export interface MallowAccountPosition {
  positionId: string;
  owner: string;
  market: MallowMarketSymbol;
  marketId: string;
  side: MallowSide;
  sizeUsd: bigint;
  collateralAmount: bigint;
  collateralAssetId: number;
}

export type MallowOrderKind = "openLimit" | "takeProfit" | "stopLoss";

export interface MallowAccountOrder {
  ownerOrderId: string;
  owner: string;
  /** Null when the order is not an ALGO/BTC position that posts USDC. */
  market: MallowMarketSymbol | null;
  marketId: string;
  side: MallowSide;
  orderKind: MallowOrderKind;
  sizeUsd: bigint;
  collateralAmount: bigint;
  collateralAssetId: number;
  keeperFeeAmount: bigint;
  keeperFeeAssetId: number;
  linkMode: number;
  linkBaseOrderId: bigint;
  positionId: string | null;
  schemaVersion: number;
  raw: Record<string, unknown>;
}

export interface MallowBook {
  markets: MallowMarketRow[];
  marketYieldRegistry?: Record<string, unknown>;
  quoteOpenLimit: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  quoteDecrease: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  orderOracle: (marketId: string, orderOpsAppId: number) => Promise<MallowOracleArgs>;
  tradingOracle: (marketId: string, tradingAppId: number) => Promise<MallowOracleArgs>;
  positions: (address: string) => Promise<MallowAccountPosition[]>;
  orders: (address: string) => Promise<MallowAccountOrder[]>;
  recallClient: MarketYieldActionRecallClient;
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
    quoteDecrease: async (body) => {
      const quote = await context.client.v2QuoteDecrease(body);
      return asRecord(quote);
    },
    orderOracle: async (marketId, appId) => {
      const oracle = await context.client.v2OracleArgs({
        marketId,
        appId,
        target: "order_ops"
      });
      return { message: oracle.message, signature: oracle.signature };
    },
    tradingOracle: async (marketId, appId) => {
      const oracle = await context.client.v2OracleArgs({
        marketId,
        appId,
        target: "trading"
      });
      return { message: oracle.message, signature: oracle.signature };
    },
    positions: async (address) => {
      try {
        const payload = await context.client.v2Positions(address);
        return selectMallowPositions(rows, payload);
      } catch (error) {
        if (error instanceof MallowUpstreamError) {
          throw error;
        }
        throw new MallowUpstreamError("Mallow positions are unavailable.", { cause: error });
      }
    },
    orders: async (address) => {
      try {
        const payload = await context.client.v2AccountOrders(address);
        return selectMallowOrders(rows, payload);
      } catch (error) {
        if (error instanceof MallowUpstreamError) {
          throw error;
        }
        throw new MallowUpstreamError("Mallow orders are unavailable.", { cause: error });
      }
    },
    recallClient: context.client
  };
}

function positionRecords(payload: unknown): Record<string, unknown>[] {
  const rows = Array.isArray(payload)
    ? payload
    : asRecord(payload).positions;
  if (!Array.isArray(rows)) {
    const data = asRecord(payload).data;
    return Array.isArray(data) ? data.filter(isRecord) : [];
  }
  return rows.filter(isRecord);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function positionSide(value: unknown): MallowSide | undefined {
  if (value === "long" || value === 1 || value === "1") {
    return "long";
  }
  if (value === "short" || value === 2 || value === "2") {
    return "short";
  }
  const side = pdexBigInt(value, 0n);
  if (side === 1n) {
    return "long";
  }
  if (side === 2n) {
    return "short";
  }
  return undefined;
}

/**
 * Keep ALGO and BTC positions that post USDC. Other markets and collateral
 * assets are omitted. A verified position id of zero is kept.
 */
export function selectMallowPositions(
  markets: readonly MallowMarketRow[],
  payload: unknown
): MallowAccountPosition[] {
  const ready = new Map(
    markets.flatMap((row) => (row.status === "ok" ? [[row.marketId, row] as const] : []))
  );
  const positions: MallowAccountPosition[] = [];
  for (const raw of positionRecords(payload)) {
    const marketId = String(pdexBigInt(raw.market_id, 0n));
    const market = ready.get(marketId);
    const side = positionSide(raw.side);
    const positionId = pdexBigInt(raw.position_id, -1n);
    const collateralAssetId = Number(pdexBigInt(raw.collateral_asset_id, 0n));
    if (!market || !side || positionId < 0n || collateralAssetId !== MALLOW_USDC_ASSET_ID) {
      continue;
    }
    positions.push({
      positionId: positionId.toString(),
      owner: typeof raw.owner === "string" ? raw.owner : "",
      market: market.market,
      marketId,
      side,
      sizeUsd: pdexBigInt(raw.size_usd ?? raw.size_usdc, 0n),
      collateralAmount: pdexBigInt(raw.collateral_amount ?? raw.collateral_usd, 0n),
      collateralAssetId
    });
  }
  return positions;
}

function orderRecords(payload: unknown): Record<string, unknown>[] {
  const rows = Array.isArray(payload) ? payload : asRecord(payload).orders;
  if (!Array.isArray(rows)) {
    const data = asRecord(payload).data;
    return Array.isArray(data) ? data.filter(isRecord) : [];
  }
  return rows.filter(isRecord);
}

function orderKind(raw: Record<string, unknown>): MallowOrderKind | undefined {
  const kind = Number(pdexBigInt(raw.order_kind ?? raw.orderKind ?? raw.order_type ?? raw.orderType, 0n));
  if (kind === V2_ORDER_KIND.OPEN_LIMIT) {
    return "openLimit";
  }
  if (kind === V2_ORDER_KIND.DECREASE_TAKE_PROFIT) {
    return "takeProfit";
  }
  if (kind === V2_ORDER_KIND.DECREASE_STOP_LOSS) {
    return "stopLoss";
  }
  return undefined;
}

function linkFields(raw: Record<string, unknown>): { linkMode: number; linkBaseOrderId: bigint } {
  const explicitMode = raw.link_mode ?? raw.linkMode;
  const explicitBase = raw.link_base_order_id ?? raw.linkBaseOrderId ?? raw.link_base ?? raw.linkBase;
  const flags = pdexBigInt(raw.flags ?? raw.link_flags ?? raw.linkFlags, 0n);
  const linkMode =
    explicitMode !== undefined && explicitMode !== null && explicitMode !== ""
      ? Number(pdexBigInt(explicitMode, 0n))
      : flags > 0n
        ? v2OrderLinkMode(flags)
        : 0;
  const linkBaseOrderId =
    explicitBase !== undefined && explicitBase !== null && explicitBase !== ""
      ? pdexBigInt(explicitBase, 0n)
      : flags > 0n
        ? v2OrderLinkBase(flags)
        : 0n;
  return { linkMode, linkBaseOrderId };
}

/**
 * Keep open limits, take-profits, and stop-losses. An order outside ALGO/BTC
 * USDC is returned with `market: null` so a cancel can refuse it.
 */
export function selectMallowOrders(
  markets: readonly MallowMarketRow[],
  payload: unknown
): MallowAccountOrder[] {
  const ready = new Map(
    markets.flatMap((row) => (row.status === "ok" ? [[row.marketId, row] as const] : []))
  );
  const orders: MallowAccountOrder[] = [];
  for (const raw of orderRecords(payload)) {
    const kind = orderKind(raw);
    const side = positionSide(raw.side);
    const ownerOrderId = pdexBigInt(raw.owner_order_id ?? raw.ownerOrderId ?? raw.order_id ?? raw.orderId, 0n);
    if (!kind || !side || ownerOrderId <= 0n) {
      continue;
    }
    const marketId = String(pdexBigInt(raw.market_id ?? raw.marketId, 0n));
    const market = ready.get(marketId);
    const collateralAssetId = Number(pdexBigInt(raw.collateral_asset_id ?? raw.collateralAssetId, 0n));
    const supported = Boolean(market) && collateralAssetId === MALLOW_USDC_ASSET_ID;
    const positionId = pdexBigInt(raw.position_id ?? raw.positionId, -1n);
    const links = linkFields(raw);
    orders.push({
      ownerOrderId: ownerOrderId.toString(),
      owner: typeof raw.owner === "string" ? raw.owner : "",
      market: supported && market ? market.market : null,
      marketId,
      side,
      orderKind: kind,
      sizeUsd: pdexBigInt(raw.size_usd_delta ?? raw.sizeUsdDelta ?? raw.size_usd ?? raw.sizeUsd, 0n),
      collateralAmount: pdexBigInt(raw.collateral_amount ?? raw.collateralAmount, 0n),
      collateralAssetId,
      keeperFeeAmount: pdexBigInt(raw.keeper_fee_amount ?? raw.keeperFeeAmount, 0n),
      keeperFeeAssetId: Number(pdexBigInt(raw.keeper_fee_asset_id ?? raw.keeperFeeAssetId, BigInt(collateralAssetId))),
      linkMode: links.linkMode,
      linkBaseOrderId: links.linkBaseOrderId,
      positionId: positionId >= 0n ? positionId.toString() : null,
      schemaVersion: Number(pdexBigInt(raw.schema_version ?? raw.schemaVersion, 0n)),
      raw
    });
  }
  return orders;
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
