import { appendV2TransactionGroupTransactions, buildV2CancelOrderTransactions, buildV2DecreaseOrCloseTransactions, v2TransactionGroupResult, SIDE, V2_ORDER_LINK_MODE, V2_ORDER_KIND, v2OrderPriceCoherenceFailure, v2ExpectedLinkedChildOrderId, v2OrderLinkBase, v2OrderLinkMode, v2SiblingLinkedChildOrderId, } from "./transactions.js";
const MAX_TXN_GROUP_SIZE = 16;
export function v2OrderCategory(orderKind) {
    const kind = Number(orderKind);
    if (kind === V2_ORDER_KIND.OPEN_LIMIT)
        return "Open Limit";
    if (kind === V2_ORDER_KIND.DECREASE_TAKE_PROFIT)
        return "Take Profit";
    if (kind === V2_ORDER_KIND.DECREASE_STOP_LOSS)
        return "Stop Loss";
    return "Unknown";
}
export function v2OrderPositionKey(owner, marketId, collateralAssetId, side) {
    const key = `${String(owner)}:${bigint(marketId)}:${bigint(collateralAssetId)}:${bigint(side)}`;
    return {
        owner: String(owner),
        marketId: bigint(marketId),
        collateralAssetId: bigint(collateralAssetId),
        side: bigint(side),
        key,
    };
}
export function groupV2OrdersByPosition(orders) {
    const grouped = new Map();
    for (const order of orders) {
        const key = v2OrderKeyFromOrder(order).key;
        const list = grouped.get(key) ?? [];
        list.push(order);
        grouped.set(key, list);
    }
    return grouped;
}
export function v2OrdersForPosition(owner, marketId, collateralAssetId, side, orders) {
    const key = v2OrderPositionKey(owner, marketId, collateralAssetId, side).key;
    return orders.filter((order) => v2OrderKeyFromOrder(order).key === key);
}
export function analyzeV2NewOrderIntent(input) {
    return analyzeV2OrderLifecycle(input.order, input.positions, input.orders, input.marketSnapshot, {
        hypothetical: true,
        excludeOwnerOrderId: input.excludeOwnerOrderId,
    });
}
export function analyzeV2OrderLifecycle(order, positions, orders, marketSnapshot, options = {}) {
    const mergedOrder = { ...(marketSnapshot ?? {}), ...order };
    const key = v2OrderKeyFromOrder(mergedOrder);
    const orderKind = Number(get(mergedOrder, "order_kind", "orderKind"));
    const ownerOrderId = bigint(get(mergedOrder, "owner_order_id", "ownerOrderId", "order_id", "orderId"));
    const position = positions.find((candidate) => v2PositionKeyFromPosition(candidate).key === key.key);
    const positionSizeUsd = position ? positionSize(position) : 0n;
    const isOpenLimit = orderKind === V2_ORDER_KIND.OPEN_LIMIT;
    const isReduceOrder = orderKind === V2_ORDER_KIND.DECREASE_TAKE_PROFIT || orderKind === V2_ORDER_KIND.DECREASE_STOP_LOSS;
    const linkMode = orderLinkMode(mergedOrder);
    const linkBaseOrderId = orderLinkBaseOrderId(mergedOrder);
    const isBracketParent = linkMode === V2_ORDER_LINK_MODE.BRACKET_PARENT;
    const isBracketChild = linkMode === V2_ORDER_LINK_MODE.CHILD_WAIT_PARENT || linkMode === V2_ORDER_LINK_MODE.CHILD_ACTIVE;
    const parentOrderId = isBracketChild ? linkBaseOrderId : 0n;
    const siblingOrderId = isBracketChild && linkBaseOrderId > 0n
        ? v2SiblingLinkedChildOrderId(linkBaseOrderId, orderKind)
        : 0n;
    const parentExists = isBracketChild && orders.some((candidate) => orderOwnerId(candidate) === linkBaseOrderId && v2OrderKeyFromOrder(candidate).key === key.key);
    const schemaVersion = Number(get(mergedOrder, "schema_version", "schemaVersion")) || (options.hypothetical ? 4 : 0);
    const legacy = schemaVersion === 3;
    // V4 children become active only through an explicit on-chain binding.
    const parentPending = linkMode === V2_ORDER_LINK_MODE.CHILD_WAIT_PARENT && (schemaVersion !== 3 || parentExists);
    const currentId = position ? positionIdentity(position) : undefined;
    // An unsigned new intent may use the supplied current state. Stored/signed orders never rebind.
    if (options.hypothetical && mergedOrder.position_id === undefined && mergedOrder.positionId === undefined && currentId !== undefined) {
        mergedOrder.position_id = currentId;
    }
    const boundId = positionIdentity(mergedOrder);
    const positionMatches = Boolean(position) && !parentPending && (legacy || (schemaVersion === 4 && boundId !== undefined && currentId !== undefined && boundId === currentId));
    let cleanupReason = "";
    if (isReduceOrder && !parentPending && (legacy || (schemaVersion === 4 && boundId !== undefined))) {
        if (!position)
            cleanupReason = "position_missing";
        else if (!legacy && currentId !== undefined && currentId !== boundId)
            cleanupReason = "position_replaced";
    }
    const bracketStatus = bracketStatusFor(linkMode, parentPending);
    const expired = orderExpired(mergedOrder);
    const crossed = orderCrossed(mergedOrder);
    const pendingTotals = pendingReduceTotals({
        owner: key.owner,
        marketId: key.marketId,
        collateralAssetId: key.collateralAssetId,
        side: key.side,
        orders,
        positionId: currentId,
        excludeOwnerOrderId: options.excludeOwnerOrderId ?? (options.hypothetical ? ownerOrderId : undefined),
        additionalOrder: options.hypothetical && isReduceOrder ? mergedOrder : undefined,
    });
    pendingTotals.pendingSameKindSizeUsd =
        orderKind === V2_ORDER_KIND.DECREASE_TAKE_PROFIT
            ? pendingTotals.pendingTpSizeUsd
            : orderKind === V2_ORDER_KIND.DECREASE_STOP_LOSS
                ? pendingTotals.pendingSlSizeUsd
                : 0n;
    const warnings = [];
    const blockers = [];
    const priceFailure = v2OrderPriceCoherenceFailure({
        orderKind,
        side: key.side,
        triggerPrice: bigint(get(mergedOrder, "trigger_price", "triggerPrice")),
        acceptablePrice: bigint(get(mergedOrder, "acceptable_price", "acceptablePrice")),
    });
    if (priceFailure)
        blockers.push(priceFailure);
    let staleReason = "";
    if (expired)
        blockers.push("order_expired");
    if (!crossed)
        blockers.push("not_crossed");
    if (parentPending)
        blockers.push("parent_pending");
    if (isReduceOrder && !parentPending) {
        if (options.hypothetical && !position) {
            blockers.push("position_missing");
            staleReason = "position_missing";
        }
        else if (!legacy && (schemaVersion !== 4 || boundId === undefined || (position && currentId === undefined))) {
            blockers.push("unknown_position_state");
            staleReason = "unknown_position_state";
        }
        else if (!position) {
            blockers.push("position_missing");
            staleReason = "position_missing";
        }
        else if (!positionMatches) {
            blockers.push("position_replaced");
            staleReason = "position_replaced";
        }
        else if (bigint(get(mergedOrder, "size_usd_delta", "sizeUsdDelta")) > positionSizeUsd) {
            blockers.push("reduce_size_exceeds_position");
            staleReason = "reduce_size_exceeds_position";
        }
        if (positionMatches && pendingTotals.pendingTpSizeUsd > positionSizeUsd)
            warnings.push("pending_tp_total_exceeds_position");
        if (positionMatches && pendingTotals.pendingSlSizeUsd > positionSizeUsd)
            warnings.push("pending_sl_total_exceeds_position");
    }
    if (isOpenLimit) {
        const minPositionSizeUsd = bigint(get(mergedOrder, "min_position_size_usd", "minPositionSizeUsd"));
        if (minPositionSizeUsd > 0n && bigint(get(mergedOrder, "size_usd_delta", "sizeUsdDelta")) < minPositionSizeUsd) {
            blockers.push("position_too_small");
        }
        const oppositeSide = key.side === BigInt(SIDE.LONG) ? BigInt(SIDE.SHORT) : key.side === BigInt(SIDE.SHORT) ? BigInt(SIDE.LONG) : 0n;
        if (oppositeSide > 0n) {
            const opposite = positions.find((candidate) => v2PositionKeyFromPosition(candidate).key ===
                v2OrderPositionKey(key.owner, key.marketId, key.collateralAssetId, oppositeSide).key);
            if (opposite)
                warnings.push("opposite_side_open_limit_creates_separate_position");
        }
    }
    const stale = staleReason !== "";
    const executable = crossed && !expired && !stale && blockers.length === 0;
    return {
        order: mergedOrder,
        position,
        positionKey: key,
        positionExists: Boolean(position),
        positionMatches,
        cleanupReason,
        positionSizeUsd,
        orderCategory: v2OrderCategory(orderKind),
        isReduceOrder,
        isOpenLimit,
        linkMode,
        linkBaseOrderId,
        isBracketParent,
        isBracketChild,
        parentOrderId,
        siblingOrderId,
        parentPending,
        bracketStatus,
        attachedTakeProfitOrderId: isBracketParent && linkBaseOrderId > 0n
            ? v2ExpectedLinkedChildOrderId(linkBaseOrderId, V2_ORDER_KIND.DECREASE_TAKE_PROFIT)
            : 0n,
        attachedStopLossOrderId: isBracketParent && linkBaseOrderId > 0n
            ? v2ExpectedLinkedChildOrderId(linkBaseOrderId, V2_ORDER_KIND.DECREASE_STOP_LOSS)
            : 0n,
        crossed,
        expired,
        stale,
        staleReason,
        warnings,
        pendingTotals,
        executable,
        executionBlockers: executable ? [] : blockers,
    };
}
export function planV2CancelRelatedReduceOrders(input) {
    const owner = String(input.owner ?? input.sender);
    const relatedOrders = v2OrdersForPosition(owner, input.marketId, input.collateralAssetId, input.side, input.orders)
        .filter((order) => isReduceOrderKind(Number(get(order, "order_kind", "orderKind"))));
    const cancelGroups = relatedOrders.map((order) => buildV2CancelOrderTransactions({
        ...input,
        sender: input.sender,
        ownerOrderId: get(order, "owner_order_id", "ownerOrderId", "order_id", "orderId"),
        collateralAssetId: get(order, "collateral_asset_id", "collateralAssetId"),
        keeperFeeAssetId: get(order, "keeper_fee_asset_id", "keeperFeeAssetId", "collateral_asset_id", "collateralAssetId"),
    }, input.suggestedParams));
    return {
        relatedOrders,
        groups: batchCancelGroups(cancelGroups),
        warnings: relatedOrders.length > 0 ? ["related_reduce_orders_require_owner_cancel"] : [],
    };
}
export function planV2CloseWithOrderCleanup(input) {
    const closeGroup = buildV2DecreaseOrCloseTransactions(input, input.suggestedParams);
    const cancelPlan = planV2CancelRelatedReduceOrders({
        ...input,
        owner: input.sender,
        orders: input.orders,
        suggestedParams: input.suggestedParams,
    });
    if (!input.includeCancelOrders || cancelPlan.groups.length === 0) {
        return {
            closeGroup,
            relatedOrders: cancelPlan.relatedOrders,
            groups: [closeGroup, ...cancelPlan.groups],
            warnings: cancelPlan.warnings,
        };
    }
    const firstCancelGroup = cancelPlan.groups[0] ?? [];
    if (closeGroup.length + firstCancelGroup.length <= MAX_TXN_GROUP_SIZE) {
        // Composition mutates transaction group IDs; keep the standalone close valid.
        const combined = appendV2TransactionGroupTransactions(v2TransactionGroupResult(buildV2DecreaseOrCloseTransactions(input, input.suggestedParams)), firstCancelGroup).transactions;
        return {
            closeGroup,
            relatedOrders: cancelPlan.relatedOrders,
            groups: [combined, ...cancelPlan.groups.slice(1)],
            warnings: cancelPlan.groups.length > 1 ? ["some_related_order_cancels_require_followup_group"] : [],
        };
    }
    return {
        closeGroup,
        relatedOrders: cancelPlan.relatedOrders,
        groups: [closeGroup, ...cancelPlan.groups],
        warnings: ["related_order_cancels_require_followup_group"],
    };
}
function pendingReduceTotals(input) {
    let pendingTpSizeUsd = 0n;
    let pendingSlSizeUsd = 0n;
    let standaloneTotal = 0n;
    const bracketTotals = new Map();
    const exclude = input.excludeOwnerOrderId === undefined ? undefined : bigint(input.excludeOwnerOrderId);
    const allOrders = input.additionalOrder === undefined ? input.orders : [...input.orders, input.additionalOrder];
    for (const order of allOrders) {
        const key = v2OrderKeyFromOrder(order);
        if (key.key !== v2OrderPositionKey(input.owner, input.marketId, input.collateralAssetId, input.side).key)
            continue;
        const ownerOrderId = orderOwnerId(order);
        if (order !== input.additionalOrder && exclude !== undefined && ownerOrderId === exclude)
            continue;
        if (orderExpired(order))
            continue;
        const legacy = Number(get(order, "schema_version", "schemaVersion")) === 3;
        if (!legacy && (input.positionId === undefined || positionIdentity(order) !== input.positionId))
            continue;
        if (!legacy && Number(get(order, "schema_version", "schemaVersion")) !== 4 && order !== input.additionalOrder)
            continue;
        if (orderLinkMode(order) === V2_ORDER_LINK_MODE.CHILD_WAIT_PARENT
            && (!legacy || allOrders.some((parent) => orderOwnerId(parent) === orderLinkBaseOrderId(order)
                && v2OrderKeyFromOrder(parent).key === key.key)))
            continue;
        const orderKind = Number(get(order, "order_kind", "orderKind"));
        const size = bigint(get(order, "size_usd_delta", "sizeUsdDelta"));
        const linkMode = orderLinkMode(order);
        const linkBaseOrderId = orderLinkBaseOrderId(order);
        const bracketBucket = linkBaseOrderId > 0n
            && (linkMode === V2_ORDER_LINK_MODE.CHILD_WAIT_PARENT || linkMode === V2_ORDER_LINK_MODE.CHILD_ACTIVE)
            ? getBracketBucket(bracketTotals, linkBaseOrderId)
            : undefined;
        if (orderKind === V2_ORDER_KIND.DECREASE_TAKE_PROFIT) {
            pendingTpSizeUsd += size;
            if (bracketBucket)
                bracketBucket.tp += size;
            else
                standaloneTotal += size;
        }
        if (orderKind === V2_ORDER_KIND.DECREASE_STOP_LOSS) {
            pendingSlSizeUsd += size;
            if (bracketBucket)
                bracketBucket.sl += size;
            else
                standaloneTotal += size;
        }
    }
    const bracketTotal = [...bracketTotals.values()].reduce((total, bucket) => total + (bucket.tp > bucket.sl ? bucket.tp : bucket.sl), 0n);
    return {
        pendingTpSizeUsd,
        pendingSlSizeUsd,
        pendingSameKindSizeUsd: 0n,
        pendingReduceTotalForPositionUsd: standaloneTotal + bracketTotal,
    };
}
function getBracketBucket(buckets, linkBaseOrderId) {
    const key = String(linkBaseOrderId);
    const existing = buckets.get(key);
    if (existing)
        return existing;
    const bucket = { tp: 0n, sl: 0n };
    buckets.set(key, bucket);
    return bucket;
}
function orderOwnerId(order) {
    return bigint(get(order, "owner_order_id", "ownerOrderId", "order_id", "orderId"));
}
function orderLinkMode(order) {
    const explicit = getOptional(order, "link_mode", "linkMode");
    if (explicit !== undefined)
        return Number(explicit);
    const flags = bigint(get(order, "flags", "link_flags", "linkFlags"));
    if (flags <= 0n)
        return V2_ORDER_LINK_MODE.STANDALONE;
    return v2OrderLinkMode(flags);
}
function orderLinkBaseOrderId(order) {
    const explicit = getOptional(order, "link_base_order_id", "linkBaseOrderId", "link_base", "linkBase");
    if (explicit !== undefined)
        return bigint(explicit);
    const flags = bigint(get(order, "flags", "link_flags", "linkFlags"));
    if (flags <= 0n)
        return 0n;
    return v2OrderLinkBase(flags);
}
function bracketStatusFor(linkMode, parentPending) {
    if (linkMode === V2_ORDER_LINK_MODE.STANDALONE)
        return "standalone";
    if (parentPending)
        return "parent_pending";
    return "active";
}
function v2OrderKeyFromOrder(order) {
    return v2OrderPositionKey(String(get(order, "owner")), bigint(get(order, "market_id", "marketId")), bigint(get(order, "collateral_asset_id", "collateralAssetId")), bigint(get(order, "side")));
}
function v2PositionKeyFromPosition(position) {
    return v2OrderPositionKey(String(get(position, "owner")), bigint(get(position, "market_id", "marketId")), bigint(get(position, "collateral_asset_id", "collateralAssetId")), bigint(get(position, "side")));
}
function orderCrossed(order) {
    const trigger = bigint(get(order, "trigger_price", "triggerPrice"));
    if (trigger <= 0n)
        return false;
    const side = Number(get(order, "side"));
    const kind = Number(get(order, "order_kind", "orderKind"));
    const min = bigint(get(order, "index_price_min", "indexPriceMin", "index_price", "indexPrice"));
    const max = bigint(get(order, "index_price_max", "indexPriceMax", "index_price", "indexPrice"));
    if (min <= 0n || max <= 0n)
        return false;
    if (kind === V2_ORDER_KIND.OPEN_LIMIT) {
        if (side === SIDE.LONG)
            return max <= trigger;
        if (side === SIDE.SHORT)
            return min >= trigger;
    }
    if (kind === V2_ORDER_KIND.DECREASE_TAKE_PROFIT) {
        if (side === SIDE.LONG)
            return min >= trigger;
        if (side === SIDE.SHORT)
            return max <= trigger;
    }
    if (kind === V2_ORDER_KIND.DECREASE_STOP_LOSS) {
        if (side === SIDE.LONG)
            return min <= trigger;
        if (side === SIDE.SHORT)
            return max >= trigger;
    }
    return false;
}
function orderExpired(order, nowSeconds = currentTimeFromOrder(order)) {
    const expiry = bigint(get(order, "expiry_time", "expiryTime"));
    return expiry > 0n && BigInt(nowSeconds) >= expiry;
}
function currentTimeFromOrder(order) {
    const value = order.current_time ?? order.currentTime;
    if (value !== undefined && value !== null && value !== "")
        return Number(bigint(value));
    return Math.floor(Date.now() / 1000);
}
function positionIdentity(record) {
    const value = record.position_id ?? record.positionId;
    if (value === undefined || value === null || value === "" || typeof value === "boolean")
        return undefined;
    if (typeof value === "number" && !Number.isSafeInteger(value))
        return undefined;
    try {
        const id = BigInt(value);
        return id >= 0n && id < (1n << 48n) ? id : undefined;
    }
    catch {
        return undefined;
    }
}
function positionSize(position) {
    return bigint(get(position, "size_usd", "sizeUsd", "size_usdc", "sizeUsdc"));
}
function isReduceOrderKind(orderKind) {
    return orderKind === V2_ORDER_KIND.DECREASE_TAKE_PROFIT || orderKind === V2_ORDER_KIND.DECREASE_STOP_LOSS;
}
function batchCancelGroups(cancelGroups) {
    const groups = [];
    for (const cancelGroup of cancelGroups) {
        const previous = groups[groups.length - 1];
        if (!previous || previous.length + cancelGroup.length > MAX_TXN_GROUP_SIZE) {
            groups.push(cancelGroup);
        }
        else {
            groups[groups.length - 1] = appendV2TransactionGroupTransactions(v2TransactionGroupResult(previous), cancelGroup).transactions;
        }
    }
    return groups;
}
function get(record, ...keys) {
    for (const key of keys) {
        const value = record[key];
        if (value !== undefined && value !== null && value !== "")
            return value;
    }
    return 0;
}
function getOptional(record, ...keys) {
    for (const key of keys) {
        const value = record[key];
        if (value !== undefined && value !== null && value !== "")
            return value;
    }
    return undefined;
}
function bigint(value) {
    if (typeof value === "bigint")
        return value;
    if (typeof value === "number")
        return BigInt(Math.trunc(value));
    if (typeof value === "string" && value.trim() !== "")
        return BigInt(value);
    return 0n;
}
//# sourceMappingURL=orders.js.map