import { analyzeV2OrderLifecycle } from "@pdex/sdk/orderLifecycle";
import { V2_ORDER_KIND } from "@pdex/sdk/constants";

import {
  MallowUpstreamError,
  loadMallowBookForRequest,
  type MallowAccountOrder,
  type MallowAccountPosition
} from "../execution/shapes/mallow/book.js";
import { MALLOW_USDC_ASSET_ID } from "../execution/shapes/mallow/constants.js";
import { amount6ToDecimal } from "../execution/shapes/mallow/math.js";
import type { PositionMarketRecord } from "./position-execution-shapes.js";
import type { ProtocolPositionsCollection } from "./protocol-positions.js";

const ORPHAN_REASONS = new Set(["position_missing", "position_replaced", "legacy_retired"]);

const COMPLETE_COVERAGE = {
  suppliedUsdComplete: true,
  borrowedUsdComplete: true,
  rewardsUsdComplete: true
};

const MARGIN_CAVEAT = "Value is USDC margin, not marked equity.";

function kindNumber(kind: MallowAccountOrder["orderKind"]): number {
  if (kind === "takeProfit") {
    return V2_ORDER_KIND.DECREASE_TAKE_PROFIT;
  }
  if (kind === "stopLoss") {
    return V2_ORDER_KIND.DECREASE_STOP_LOSS;
  }
  return V2_ORDER_KIND.OPEN_LIMIT;
}

function sideNumber(side: MallowAccountPosition["side"]): number {
  return side === "short" ? 2 : 1;
}

function usdcValue(amount: bigint): number {
  return Number(amount6ToDecimal(amount));
}

function positionRow(position: MallowAccountPosition): PositionMarketRecord | undefined {
  if (position.sizeUsd <= 0n || position.market === undefined) {
    return undefined;
  }
  const amount = position.collateralAmount;
  return {
    protocol: "mallow",
    positionType: "supplied",
    positionId: `mallow:position:${position.market}:${position.side}:${position.positionId}`,
    opportunityId: null,
    assetId: MALLOW_USDC_ASSET_ID,
    assetSymbol: "USDC",
    amountRaw: amount.toString(),
    amount: amount6ToDecimal(amount),
    usdValue: usdcValue(amount),
    caveats: [MARGIN_CAVEAT],
    notes: `${position.market}/USD ${position.side}, size ${amount6ToDecimal(position.sizeUsd)}`,
    inputHints: {
      mallowMarket: position.market,
      mallowSide: position.side,
      pexPositionId: position.positionId
    }
  };
}

function orderAnalysisRecord(order: MallowAccountOrder): Record<string, unknown> {
  return {
    ...order.raw,
    owner: order.owner,
    owner_order_id: order.ownerOrderId,
    market_id: order.marketId,
    collateral_asset_id: order.collateralAssetId,
    side: sideNumber(order.side),
    order_kind: kindNumber(order.orderKind),
    size_usd_delta: order.sizeUsd.toString(),
    link_mode: order.linkMode,
    link_base_order_id: order.linkBaseOrderId.toString(),
    schema_version: order.schemaVersion || (order.positionId !== null ? 4 : 0),
    ...(order.positionId !== null ? { position_id: order.positionId } : {})
  };
}

function positionAnalysisRecord(position: MallowAccountPosition): Record<string, unknown> {
  return {
    owner: position.owner,
    market_id: position.marketId,
    collateral_asset_id: position.collateralAssetId,
    side: sideNumber(position.side),
    position_id: position.positionId,
    size_usd: position.sizeUsd.toString()
  };
}

function orphaned(order: MallowAccountOrder, positions: readonly MallowAccountPosition[], orders: readonly MallowAccountOrder[]): boolean {
  try {
    const analysis = analyzeV2OrderLifecycle(
      orderAnalysisRecord(order),
      positions.map(positionAnalysisRecord),
      orders.map(orderAnalysisRecord)
    );
    const reason = analysis.cleanupReason || analysis.staleReason;
    return ORPHAN_REASONS.has(reason);
  } catch {
    return false;
  }
}

function orderLabel(kind: MallowAccountOrder["orderKind"]): string {
  if (kind === "takeProfit") {
    return "take-profit";
  }
  if (kind === "stopLoss") {
    return "stop-loss";
  }
  return "open limit";
}

function orderRow(
  order: MallowAccountOrder,
  positions: readonly MallowAccountPosition[],
  orders: readonly MallowAccountOrder[]
): PositionMarketRecord | undefined {
  if (!order.market) {
    return undefined;
  }
  const locked = order.collateralAmount > 0n ? order.collateralAmount : order.keeperFeeAmount;
  const caveats = ["Value is locked USDC, not marked equity."];
  if (orphaned(order, positions, orders)) {
    caveats.push("This order is orphaned. The position it protected is gone.");
  }
  return {
    protocol: "mallow",
    positionType: "supplied",
    positionId: `mallow:order:${order.ownerOrderId}`,
    opportunityId: null,
    assetId: MALLOW_USDC_ASSET_ID,
    assetSymbol: "USDC",
    amountRaw: locked.toString(),
    amount: amount6ToDecimal(locked),
    usdValue: usdcValue(locked),
    caveats,
    notes: `${order.market}/USD ${order.side} ${orderLabel(order.orderKind)}`,
    inputHints: {
      ownerOrderId: order.ownerOrderId,
      mallowMarket: order.market,
      mallowSide: order.side
    }
  };
}

export function mallowWalletRows(
  positions: readonly MallowAccountPosition[],
  orders: readonly MallowAccountOrder[]
): PositionMarketRecord[] {
  const rows: PositionMarketRecord[] = [];
  for (const position of positions) {
    const row = positionRow(position);
    if (row) {
      rows.push(row);
    }
  }
  for (const order of orders) {
    const row = orderRow(order, positions, orders);
    if (row) {
      rows.push(row);
    }
  }
  return rows;
}

/**
 * Open Mallow perps and resting orders for one wallet. A proxy failure is a
 * warning with no rows. Coverage stays complete so the rest of the wallet
 * snapshot keeps its USD totals.
 */
export async function collectMallowPositions(address: string): Promise<ProtocolPositionsCollection> {
  try {
    const book = await loadMallowBookForRequest();
    const [positions, orders] = await Promise.all([book.positions(address), book.orders(address)]);
    return {
      positions: mallowWalletRows(positions, orders),
      warnings: [],
      coverage: COMPLETE_COVERAGE
    };
  } catch (error) {
    const detail =
      error instanceof MallowUpstreamError || error instanceof Error
        ? error.message
        : "Mallow positions are unavailable.";
    return {
      positions: [],
      warnings: [`Mallow positions are unavailable: ${detail}`],
      coverage: COMPLETE_COVERAGE
    };
  }
}
