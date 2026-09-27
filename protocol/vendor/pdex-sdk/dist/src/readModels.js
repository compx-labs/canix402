export function pdexRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
}
export function pdexRecords(value) {
    return Array.isArray(value)
        ? value.filter((item) => Boolean(item) && typeof item === "object" && !Array.isArray(item))
        : [];
}
export function pdexString(value, fallback = "") {
    if (value === undefined || value === null)
        return fallback;
    const parsed = String(value);
    return parsed.length ? parsed : fallback;
}
export function pdexNumber(value, fallback = 0) {
    if (value === undefined || value === null || value === "")
        return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
export function pdexBigInt(value, fallback = 0n) {
    if (value === undefined || value === null || value === "")
        return fallback;
    if (typeof value === "bigint")
        return value;
    if (typeof value === "number")
        return Number.isSafeInteger(value) ? BigInt(value) : fallback;
    if (typeof value !== "string" || !/^-?\d+$/.test(value.trim()))
        return fallback;
    return BigInt(value.trim());
}
export function pdexOptionalBigInt(value) {
    if (value === undefined || value === null || value === "")
        return undefined;
    if (typeof value === "bigint")
        return value;
    if (typeof value === "number")
        return Number.isSafeInteger(value) ? BigInt(value) : undefined;
    if (typeof value !== "string" || !/^-?\d+$/.test(value.trim()))
        return undefined;
    return BigInt(value.trim());
}
export function pdexBoolean(value, fallback = false) {
    if (typeof value === "boolean")
        return value;
    if (typeof value === "number")
        return value !== 0;
    if (typeof value === "bigint")
        return value !== 0n;
    if (typeof value === "string" && value.length) {
        return !["0", "false", "no", "none", "null"].includes(value.toLowerCase());
    }
    return fallback;
}
export function normalizeV2Catalog(value) {
    const catalog = pdexRecord(value);
    const custodyAssets = new Map();
    for (const [key, entryValue] of Object.entries(pdexRecord(catalog.custody_assets))) {
        const entry = pdexRecord(entryValue);
        const assetId = safeNonNegativeInteger(entry.asset_id ?? key);
        if (assetId === undefined)
            continue;
        const symbol = pdexString(entry.symbol, assetId === 0 ? "ALGO" : `Asset #${assetId}`);
        custodyAssets.set(assetId, {
            assetId,
            symbol,
            displayName: pdexString(entry.display_name, symbol),
            decimals: pdexNumber(entry.decimals, 6),
        });
    }
    if (!custodyAssets.has(0)) {
        custodyAssets.set(0, { assetId: 0, symbol: "ALGO", displayName: "ALGO", decimals: 6 });
    }
    return {
        indexMarkets: recordMap(catalog.index_markets),
        custodyAssets,
        marketDefinitions: recordMap(catalog.market_definitions),
    };
}
export function normalizeV2Market(value, options = {}) {
    const record = value;
    const pool = options.pool ?? {};
    const marketId = pdexString(record.market_id, "0");
    const indexAssetId = pdexNumber(record.index_asset_id);
    const definition = options.catalog?.marketDefinitions.get(pdexNumber(marketId)) ?? {};
    const indexMarket = options.catalog?.indexMarkets.get(indexAssetId) ?? {};
    const symbol = pdexString(definition.symbol, pdexString(record.symbol, pdexString(indexMarket.display_name, `Market ${marketId}`)));
    const [symbolBase = symbol, symbolQuote = "USD"] = symbol.split("/");
    const longAssetId = pdexNumber(record.long_asset_id, indexAssetId);
    const collateralAssetIds = Array.isArray(record.collateral_asset_ids)
        ? uniqueNumbers(record.collateral_asset_ids.map((assetId) => pdexNumber(assetId)))
        : [];
    const shortAssetId = pdexNumber(record.short_asset_id, collateralAssetIds[0] ?? 0);
    const conversionScale = pdexOptionalBigInt(record.position_conversion_scale);
    const tokenScale = pdexOptionalBigInt(record.position_token_scale)
        ?? (conversionScale !== undefined && conversionScale % 1000000n === 0n
            ? conversionScale / 1000000n
            : undefined);
    return {
        marketId,
        symbol,
        displayName: pdexString(definition.display_name, symbol),
        baseSymbol: pdexString(indexMarket.symbol, symbolBase),
        quoteSymbol: pdexString(indexMarket.quote_symbol, symbolQuote),
        builderFamily: pdexString(record.builder_family, pdexString(record.market_family, "two_token")),
        singleToken: pdexBoolean(record.is_single_token_market),
        defaultPoolId: pdexString(pool.pool_id, marketId),
        indexAssetId,
        longAssetId,
        shortAssetId,
        backingAssetId: pdexNumber(record.backing_asset_id, longAssetId),
        collateralAssetIds,
        positionTokenScale: tokenScale,
        positionConversionScale: conversionScale,
        virtualLongOpenInterestUsd: pdexBigInt(record.virtual_long_oi_usd),
        virtualShortOpenInterestUsd: pdexBigInt(record.virtual_short_oi_usd),
        prices: {
            index: pdexOptionalBigInt(record.index_price),
            indexMin: pdexOptionalBigInt(record.index_price_min),
            indexMax: pdexOptionalBigInt(record.index_price_max),
            long: pdexOptionalBigInt(record.long_price),
            longMin: pdexOptionalBigInt(record.long_price_min),
            longMax: pdexOptionalBigInt(record.long_price_max),
            short: pdexOptionalBigInt(record.short_price),
            shortMin: pdexOptionalBigInt(record.short_price_min),
            shortMax: pdexOptionalBigInt(record.short_price_max),
            timestamp: record.oracle_timestamp === undefined ? undefined : pdexNumber(record.oracle_timestamp),
        },
        raw: record,
    };
}
export function normalizeV2Pool(value) {
    return {
        poolId: pdexString(value.pool_id, pdexString(value.market_id, "0")),
        marketId: pdexString(value.market_id, "0"),
        poolAssetId: pdexString(value.pool_asset_id, "0"),
        longAssetId: pdexNumber(value.long_asset_id),
        shortAssetId: pdexNumber(value.short_asset_id),
        longAmount: pdexBigInt(value.long_pool_amount),
        shortAmount: pdexBigInt(value.short_pool_amount),
        swapImpactLongAmount: pdexBigInt(value.swap_impact_pool_long_amount),
        swapImpactShortAmount: pdexBigInt(value.swap_impact_pool_short_amount),
        lpSupply: pdexBigInt(value.lp_supply),
        poolValueUsd: pdexOptionalBigInt(value.pool_value_usd),
        rawPoolValueUsd: pdexOptionalBigInt(value.raw_pool_value_usd),
        markedPoolValueUsd: pdexOptionalBigInt(value.marked_pool_value_usd),
        pendingBorrowingTotalUsd: pdexOptionalBigInt(value.pending_borrowing_total_usd),
        raw: value,
    };
}
export function normalizeV2MarketSummary(value) {
    const rawMarkets = pdexRecords(value.markets);
    const rawPools = pdexRecords(value.pools);
    const poolsByMarket = new Map(rawPools.map((pool) => [pdexString(pool.market_id), pool]));
    const catalog = normalizeV2Catalog(value.product_catalog);
    return {
        markets: rawMarkets.map((market) => normalizeV2Market(market, {
            pool: poolsByMarket.get(pdexString(market.market_id)),
            catalog,
        })),
        pools: rawPools.map(normalizeV2Pool),
        catalog,
        indexedRound: value.last_indexed_round === undefined ? undefined : pdexNumber(value.last_indexed_round),
    };
}
export function normalizeV2Position(value) {
    const collateralAssetIds = Array.isArray(value.collateral_asset_ids)
        ? uniqueNumbers(value.collateral_asset_ids.map((assetId) => pdexNumber(assetId)))
        : [];
    return {
        owner: pdexString(value.owner),
        marketId: pdexString(value.market_id, "0"),
        poolId: pdexString(value.pool_id, pdexString(value.market_id, "0")),
        side: pdexNumber(value.side),
        sizeUsd: pdexBigInt(value.size_usd ?? value.size_usdc),
        collateralAmount: pdexBigInt(value.collateral_amount ?? value.collateral_usd),
        collateralAssetId: pdexNumber(value.collateral_asset_id),
        collateralAssetIds,
        backingAssetId: pdexNumber(value.backing_asset_id),
        builderFamily: pdexString(value.builder_family, pdexString(value.market_family, "two_token")),
        singleToken: pdexBoolean(value.is_single_token_market),
        swapAvailable: pdexBoolean(value.swap_available),
        raw: value,
    };
}
export function normalizeV2Order(value) {
    return {
        owner: pdexString(value.owner),
        orderId: pdexString(value.owner_order_id ?? value.order_id, "0"),
        marketId: pdexString(value.market_id, "0"),
        poolId: pdexString(value.pool_id, pdexString(value.market_id, "0")),
        side: pdexNumber(value.side),
        orderType: pdexNumber(value.order_type),
        sizeUsd: pdexBigInt(value.size_usd_delta ?? value.size_usd),
        collateralAmount: pdexBigInt(value.collateral_amount),
        collateralAssetId: pdexNumber(value.collateral_asset_id),
        keeperFeeAssetId: pdexNumber(value.keeper_fee_asset_id, pdexNumber(value.collateral_asset_id)),
        keeperFeeAmount: pdexBigInt(value.keeper_fee_amount),
        triggerPrice: pdexBigInt(value.trigger_price),
        acceptablePrice: pdexBigInt(value.acceptable_price),
        minOutputAmount: pdexBigInt(value.min_output_amount),
        timeInForce: pdexNumber(value.time_in_force),
        expiryTime: pdexBigInt(value.expiry_time),
        status: pdexString(value.status),
        raw: value,
    };
}
export function normalizeV2LiquidityPosition(value) {
    return {
        owner: pdexString(value.owner),
        marketId: pdexString(value.market_id, "0"),
        poolId: pdexString(value.pool_id, pdexString(value.market_id, "0")),
        shares: pdexBigInt(value.share_amount ?? value.shares),
        estimatedValueUsd: pdexOptionalBigInt(value.estimated_value_usd),
        lastDepositTimestamp: pdexOptionalBigInt(value.last_deposit_timestamp),
        raw: value,
    };
}
export function normalizeV2PositionMargin(value) {
    return {
        marketId: pdexString(value.market_id, "0"),
        collateralAssetId: pdexNumber(value.collateral_asset_id),
        side: pdexNumber(value.side),
        equityUsd: pdexBigInt(value.equity_usd),
        initialMarginRequiredUsd: pdexBigInt(value.initial_margin_required_usd),
        maintenanceMarginRequiredUsd: pdexBigInt(value.maintenance_margin_required_usd),
        initialMarginBreached: pdexBoolean(value.initial_margin_breached),
        liquidatable: pdexBoolean(value.liquidatable),
        liquidationPriceEstimate: pdexOptionalBigInt(value.liquidation_price_estimate),
        indexPrice: pdexOptionalBigInt(value.index_price),
        entryPrice: pdexOptionalBigInt(value.entry_price),
        pnlUsd: pdexOptionalBigInt(value.pnl_usd),
        failureReasons: Array.isArray(value.failure_reasons) ? value.failure_reasons.map(String).filter(Boolean) : [],
        raw: value,
    };
}
export function normalizeV2AccountMargin(value) {
    return {
        equityUsd: pdexBigInt(value.equity_usd),
        initialMarginRequiredUsd: pdexBigInt(value.initial_margin_required_usd),
        maintenanceMarginRequiredUsd: pdexBigInt(value.maintenance_margin_required_usd),
        initialMarginBreachedCount: pdexNumber(value.initial_margin_breached_count),
        liquidatableCount: pdexNumber(value.liquidatable_count),
        generatedAt: pdexNumber(value.generated_at),
        expiresAt: pdexNumber(value.expires_at),
        indexedRound: pdexNumber(value.indexed_round),
        positions: pdexRecords(value.positions).map((position) => normalizeV2PositionMargin(position)),
        raw: value,
    };
}
export function normalizeV2AccountActivity(value) {
    return {
        activities: pdexRecords(value.activities).map((activityValue) => {
            const activity = activityValue;
            return {
                activityKey: pdexString(activity.activity_key),
                txId: pdexString(activity.root_tx_id, pdexString(activity.source_tx_id)),
                round: pdexNumber(activity.round),
                occurredAt: pdexNumber(activity.occurred_at),
                actionType: pdexString(activity.action_type),
                eventType: pdexString(activity.event_type),
                marketId: optionalString(activity.market_id),
                poolId: optionalString(activity.pool_id),
                vaultId: optionalString(activity.vault_id),
                orderId: optionalString(activity.owner_order_id),
                detail: pdexRecord(activity.detail),
                raw: activity,
            };
        }),
        nextCursor: optionalString(value.next_cursor),
    };
}
function optionalString(value) {
    if (value === undefined || value === null || value === "")
        return undefined;
    return String(value);
}
function recordMap(value) {
    const result = new Map();
    for (const [key, entry] of Object.entries(pdexRecord(value))) {
        const record = pdexRecord(entry);
        const id = safeNonNegativeInteger(record.market_id ?? record.asset_id ?? key);
        if (id !== undefined)
            result.set(id, record);
    }
    return result;
}
function safeNonNegativeInteger(value) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
function uniqueNumbers(values) {
    return [...new Set(values.filter((value) => Number.isSafeInteger(value) && value >= 0))];
}
//# sourceMappingURL=readModels.js.map