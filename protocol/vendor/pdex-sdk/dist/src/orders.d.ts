import { type SuggestedParams, type Transaction } from "algosdk";
import { type BigNumberish, type V2DecreaseOrCloseInput, type PdexV2OrderOpsRefs } from "./transactions.js";
import type { AddressLike } from "./boxes.js";
export type V2OrderCategory = "Open Limit" | "Take Profit" | "Stop Loss" | "Unknown";
export type V2OrderStaleReason = "position_missing" | "position_replaced" | "legacy_retired" | "parent_pending" | "reduce_size_exceeds_position" | "pending_tp_total_exceeds_position" | "pending_sl_total_exceeds_position" | "order_expired" | "market_unavailable" | "oracle_unavailable" | "not_crossed" | "position_too_small" | "bad_order_price" | "target_trading_app_missing" | "unknown_position_state" | "opposite_side_open_limit_creates_separate_position";
export interface V2OrderPositionKey {
    owner: string;
    marketId: bigint;
    collateralAssetId: bigint;
    side: bigint;
    key: string;
}
export interface V2OrderPendingTotals {
    pendingTpSizeUsd: bigint;
    pendingSlSizeUsd: bigint;
    pendingSameKindSizeUsd: bigint;
    pendingReduceTotalForPositionUsd: bigint;
}
export type V2BracketStatus = "standalone" | "parent_pending" | "active" | "cancelled_with_parent" | "oco_sibling_cancelled";
export interface V2OrderLifecycleState {
    order: V2StateOrder;
    position?: V2StatePosition;
    positionKey: V2OrderPositionKey;
    positionExists: boolean;
    positionMatches: boolean;
    cleanupReason: "" | "position_missing" | "position_replaced" | "legacy_retired";
    positionSizeUsd: bigint;
    orderCategory: V2OrderCategory;
    isReduceOrder: boolean;
    isOpenLimit: boolean;
    linkMode: number;
    linkBaseOrderId: bigint;
    isBracketParent: boolean;
    isBracketChild: boolean;
    parentOrderId: bigint;
    siblingOrderId: bigint;
    parentPending: boolean;
    bracketStatus: V2BracketStatus;
    attachedTakeProfitOrderId: bigint;
    attachedStopLossOrderId: bigint;
    crossed: boolean;
    expired: boolean;
    stale: boolean;
    staleReason: V2OrderStaleReason | "";
    warnings: V2OrderStaleReason[];
    pendingTotals: V2OrderPendingTotals;
    executable: boolean;
    executionBlockers: V2OrderStaleReason[];
}
export type V2StateOrder = Record<string, unknown>;
export type V2StatePosition = Record<string, unknown>;
export interface V2AnalyzeNewOrderIntentInput {
    order: V2StateOrder;
    positions: V2StatePosition[];
    orders: V2StateOrder[];
    marketSnapshot?: Record<string, unknown>;
    excludeOwnerOrderId?: BigNumberish;
}
export interface V2CancelRelatedReduceOrdersPlan {
    relatedOrders: V2StateOrder[];
    groups: Transaction[][];
    warnings: string[];
}
export interface V2CloseWithOrderCleanupPlan {
    closeGroup: Transaction[];
    relatedOrders: V2StateOrder[];
    groups: Transaction[][];
    warnings: string[];
}
export declare function v2OrderCategory(orderKind: BigNumberish): V2OrderCategory;
export declare function v2OrderPositionKey(owner: AddressLike, marketId: BigNumberish, collateralAssetId: BigNumberish, side: BigNumberish): V2OrderPositionKey;
export declare function groupV2OrdersByPosition(orders: V2StateOrder[]): Map<string, V2StateOrder[]>;
export declare function v2OrdersForPosition(owner: AddressLike, marketId: BigNumberish, collateralAssetId: BigNumberish, side: BigNumberish, orders: V2StateOrder[]): V2StateOrder[];
export declare function analyzeV2NewOrderIntent(input: V2AnalyzeNewOrderIntentInput): V2OrderLifecycleState;
export declare function analyzeV2OrderLifecycle(order: V2StateOrder, positions: V2StatePosition[], orders: V2StateOrder[], marketSnapshot?: Record<string, unknown>, options?: {
    hypothetical?: boolean;
    excludeOwnerOrderId?: BigNumberish;
}): V2OrderLifecycleState;
export declare function planV2CancelRelatedReduceOrders(input: PdexV2OrderOpsRefs & {
    sender: AddressLike;
    owner?: AddressLike;
    marketId: BigNumberish;
    collateralAssetId: BigNumberish;
    side: BigNumberish;
    orders: V2StateOrder[];
    suggestedParams: SuggestedParams;
}): V2CancelRelatedReduceOrdersPlan;
export declare function planV2CloseWithOrderCleanup(input: V2DecreaseOrCloseInput & {
    orders: V2StateOrder[];
    suggestedParams: SuggestedParams;
    includeCancelOrders?: boolean;
}): V2CloseWithOrderCleanupPlan;
//# sourceMappingURL=orders.d.ts.map