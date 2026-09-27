export type PdexJsonInteger = number | bigint | string;
export type PdexStateRecord = Record<string, unknown>;
export interface V2MarketState extends PdexStateRecord {
    market_id?: PdexJsonInteger;
    symbol?: string;
    market_family?: string;
    builder_family?: string;
    is_single_token_market?: boolean | PdexJsonInteger;
    index_asset_id?: PdexJsonInteger;
    long_asset_id?: PdexJsonInteger;
    short_asset_id?: PdexJsonInteger;
    backing_asset_id?: PdexJsonInteger;
    collateral_asset_ids?: PdexJsonInteger[];
    position_token_scale?: PdexJsonInteger;
    position_conversion_scale?: PdexJsonInteger;
    index_price?: PdexJsonInteger;
    index_price_min?: PdexJsonInteger;
    index_price_max?: PdexJsonInteger;
    long_price?: PdexJsonInteger;
    long_price_min?: PdexJsonInteger;
    long_price_max?: PdexJsonInteger;
    short_price?: PdexJsonInteger;
    short_price_min?: PdexJsonInteger;
    short_price_max?: PdexJsonInteger;
    oracle_timestamp?: PdexJsonInteger;
    virtual_long_oi_usd?: PdexJsonInteger;
    virtual_short_oi_usd?: PdexJsonInteger;
}
export interface V2PoolState extends PdexStateRecord {
    pool_id?: PdexJsonInteger;
    market_id?: PdexJsonInteger;
    pool_asset_id?: PdexJsonInteger;
    long_asset_id?: PdexJsonInteger;
    short_asset_id?: PdexJsonInteger;
    long_pool_amount?: PdexJsonInteger;
    short_pool_amount?: PdexJsonInteger;
    swap_impact_pool_long_amount?: PdexJsonInteger;
    swap_impact_pool_short_amount?: PdexJsonInteger;
    lp_supply?: PdexJsonInteger;
    pool_value_usd?: PdexJsonInteger;
    raw_pool_value_usd?: PdexJsonInteger;
    marked_pool_value_usd?: PdexJsonInteger;
    pending_borrowing_total_usd?: PdexJsonInteger;
}
export interface V2TraderState extends PdexStateRecord {
    owner?: string;
    trading_app_name?: string;
    storage_available_microalgo?: PdexJsonInteger;
    storage_locked_microalgo?: PdexJsonInteger;
    two_token_storage_available_microalgo?: PdexJsonInteger;
    two_token_storage_locked_microalgo?: PdexJsonInteger;
    next_order_id?: PdexJsonInteger;
}
export interface V2PositionState extends PdexStateRecord {
    position_id?: PdexJsonInteger;
    owner?: string;
    market_id?: PdexJsonInteger;
    pool_id?: PdexJsonInteger;
    side?: PdexJsonInteger;
    size_usd?: PdexJsonInteger;
    size_usdc?: PdexJsonInteger;
    collateral_amount?: PdexJsonInteger;
    collateral_usd?: PdexJsonInteger;
    collateral_asset_id?: PdexJsonInteger;
    collateral_asset_ids?: PdexJsonInteger[];
    backing_asset_id?: PdexJsonInteger;
    builder_family?: string;
    market_family?: string;
    is_single_token_market?: boolean | PdexJsonInteger;
    swap_available?: boolean | PdexJsonInteger;
}
export interface V2OrderState extends PdexStateRecord {
    schema_version?: PdexJsonInteger;
    position_id?: PdexJsonInteger;
    owner?: string;
    owner_order_id?: PdexJsonInteger;
    order_id?: PdexJsonInteger;
    market_id?: PdexJsonInteger;
    pool_id?: PdexJsonInteger;
    side?: PdexJsonInteger;
    order_type?: PdexJsonInteger;
    size_usd_delta?: PdexJsonInteger;
    size_usd?: PdexJsonInteger;
    collateral_amount?: PdexJsonInteger;
    collateral_asset_id?: PdexJsonInteger;
    keeper_fee_asset_id?: PdexJsonInteger;
    keeper_fee_amount?: PdexJsonInteger;
    trigger_price?: PdexJsonInteger;
    acceptable_price?: PdexJsonInteger;
    min_output_amount?: PdexJsonInteger;
    time_in_force?: PdexJsonInteger;
    expiry_time?: PdexJsonInteger;
    status?: string | PdexJsonInteger;
}
export interface V2LpState extends PdexStateRecord {
    owner?: string;
    market_id?: PdexJsonInteger;
    pool_id?: PdexJsonInteger;
    share_amount?: PdexJsonInteger;
    shares?: PdexJsonInteger;
    estimated_value_usd?: PdexJsonInteger;
    last_deposit_timestamp?: PdexJsonInteger;
}
export interface V2PositionMarginState extends PdexStateRecord {
    market_id?: PdexJsonInteger;
    collateral_asset_id?: PdexJsonInteger;
    side?: PdexJsonInteger;
    equity_usd?: PdexJsonInteger;
    initial_margin_required_usd?: PdexJsonInteger;
    maintenance_margin_required_usd?: PdexJsonInteger;
    initial_margin_breached?: boolean | PdexJsonInteger;
    liquidatable?: boolean | PdexJsonInteger;
    liquidation_price_estimate?: PdexJsonInteger;
    index_price?: PdexJsonInteger;
    entry_price?: PdexJsonInteger;
    pnl_usd?: PdexJsonInteger;
    failure_reasons?: unknown[];
}
export interface V2AccountMarginState extends PdexStateRecord {
    equity_usd?: PdexJsonInteger;
    initial_margin_required_usd?: PdexJsonInteger;
    maintenance_margin_required_usd?: PdexJsonInteger;
    initial_margin_breached_count?: PdexJsonInteger;
    liquidatable_count?: PdexJsonInteger;
    generated_at?: PdexJsonInteger;
    expires_at?: PdexJsonInteger;
    indexed_round?: PdexJsonInteger;
    positions?: V2PositionMarginState[];
}
export interface V2AccountActivityItemState extends PdexStateRecord {
    activity_key?: string;
    root_tx_id?: string;
    source_tx_id?: string;
    round?: PdexJsonInteger;
    occurred_at?: PdexJsonInteger;
    action_type?: string;
    event_type?: string;
    market_id?: PdexJsonInteger;
    pool_id?: PdexJsonInteger;
    vault_id?: PdexJsonInteger;
    owner_order_id?: PdexJsonInteger;
    detail?: PdexStateRecord;
}
export interface PdexAssetDisplay {
    assetId: number;
    symbol: string;
    displayName: string;
    decimals: number;
}
export interface PdexCatalog {
    indexMarkets: Map<number, PdexStateRecord>;
    custodyAssets: Map<number, PdexAssetDisplay>;
    marketDefinitions: Map<number, PdexStateRecord>;
}
export interface PdexPriceSnapshot {
    index?: bigint;
    indexMin?: bigint;
    indexMax?: bigint;
    long?: bigint;
    longMin?: bigint;
    longMax?: bigint;
    short?: bigint;
    shortMin?: bigint;
    shortMax?: bigint;
    timestamp?: number;
}
export interface PdexMarket {
    marketId: string;
    symbol: string;
    displayName: string;
    baseSymbol: string;
    quoteSymbol: string;
    builderFamily: string;
    singleToken: boolean;
    defaultPoolId: string;
    indexAssetId: number;
    longAssetId: number;
    shortAssetId: number;
    backingAssetId: number;
    collateralAssetIds: number[];
    positionTokenScale?: bigint;
    positionConversionScale?: bigint;
    virtualLongOpenInterestUsd: bigint;
    virtualShortOpenInterestUsd: bigint;
    prices: PdexPriceSnapshot;
    raw: V2MarketState;
}
export interface PdexPool {
    poolId: string;
    marketId: string;
    poolAssetId: string;
    longAssetId: number;
    shortAssetId: number;
    longAmount: bigint;
    shortAmount: bigint;
    swapImpactLongAmount: bigint;
    swapImpactShortAmount: bigint;
    lpSupply: bigint;
    poolValueUsd?: bigint;
    rawPoolValueUsd?: bigint;
    markedPoolValueUsd?: bigint;
    pendingBorrowingTotalUsd?: bigint;
    raw: V2PoolState;
}
export interface PdexPosition {
    owner: string;
    marketId: string;
    poolId: string;
    side: number;
    sizeUsd: bigint;
    collateralAmount: bigint;
    collateralAssetId: number;
    collateralAssetIds: number[];
    backingAssetId: number;
    builderFamily: string;
    singleToken: boolean;
    swapAvailable: boolean;
    raw: V2PositionState;
}
export interface PdexOrder {
    owner: string;
    orderId: string;
    marketId: string;
    poolId: string;
    side: number;
    orderType: number;
    sizeUsd: bigint;
    collateralAmount: bigint;
    collateralAssetId: number;
    keeperFeeAssetId: number;
    keeperFeeAmount: bigint;
    triggerPrice: bigint;
    acceptablePrice: bigint;
    minOutputAmount: bigint;
    timeInForce: number;
    expiryTime: bigint;
    status: string;
    raw: V2OrderState;
}
export interface PdexLiquidityPosition {
    owner: string;
    marketId: string;
    poolId: string;
    shares: bigint;
    estimatedValueUsd?: bigint;
    lastDepositTimestamp?: bigint;
    raw: V2LpState;
}
export interface PdexPositionMargin {
    marketId: string;
    collateralAssetId: number;
    side: number;
    equityUsd: bigint;
    initialMarginRequiredUsd: bigint;
    maintenanceMarginRequiredUsd: bigint;
    initialMarginBreached: boolean;
    liquidatable: boolean;
    liquidationPriceEstimate?: bigint;
    indexPrice?: bigint;
    entryPrice?: bigint;
    pnlUsd?: bigint;
    failureReasons: string[];
    raw: V2PositionMarginState;
}
export interface PdexAccountMargin {
    equityUsd: bigint;
    initialMarginRequiredUsd: bigint;
    maintenanceMarginRequiredUsd: bigint;
    initialMarginBreachedCount: number;
    liquidatableCount: number;
    generatedAt: number;
    expiresAt: number;
    indexedRound: number;
    positions: PdexPositionMargin[];
    raw: V2AccountMarginState;
}
export interface PdexAccountActivity {
    activityKey: string;
    txId: string;
    round: number;
    occurredAt: number;
    actionType: string;
    eventType: string;
    marketId?: string;
    poolId?: string;
    vaultId?: string;
    orderId?: string;
    detail: PdexStateRecord;
    raw: V2AccountActivityItemState;
}
export interface PdexAccountActivityPage {
    activities: PdexAccountActivity[];
    nextCursor?: string;
}
export interface PdexMarketSummary {
    markets: PdexMarket[];
    pools: PdexPool[];
    catalog: PdexCatalog;
    indexedRound?: number;
}
export declare function pdexRecord(value: unknown): PdexStateRecord;
export declare function pdexRecords(value: unknown): PdexStateRecord[];
export declare function pdexString(value: unknown, fallback?: string): string;
export declare function pdexNumber(value: unknown, fallback?: number): number;
export declare function pdexBigInt(value: unknown, fallback?: bigint): bigint;
export declare function pdexOptionalBigInt(value: unknown): bigint | undefined;
export declare function pdexBoolean(value: unknown, fallback?: boolean): boolean;
export declare function normalizeV2Catalog(value: unknown): PdexCatalog;
export declare function normalizeV2Market(value: V2MarketState, options?: {
    pool?: V2PoolState;
    catalog?: PdexCatalog;
}): PdexMarket;
export declare function normalizeV2Pool(value: V2PoolState): PdexPool;
export declare function normalizeV2MarketSummary(value: PdexStateRecord): PdexMarketSummary;
export declare function normalizeV2Position(value: V2PositionState): PdexPosition;
export declare function normalizeV2Order(value: V2OrderState): PdexOrder;
export declare function normalizeV2LiquidityPosition(value: V2LpState): PdexLiquidityPosition;
export declare function normalizeV2PositionMargin(value: V2PositionMarginState): PdexPositionMargin;
export declare function normalizeV2AccountMargin(value: V2AccountMarginState): PdexAccountMargin;
export declare function normalizeV2AccountActivity(value: PdexStateRecord): PdexAccountActivityPage;
//# sourceMappingURL=readModels.d.ts.map