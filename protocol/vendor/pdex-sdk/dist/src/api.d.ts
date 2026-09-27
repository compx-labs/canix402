import { type ProtocolManifest } from "./manifest.js";
import { type OraclePayload } from "./oracle.js";
import type { V2AccountMarginState, V2AccountActivityItemState, V2LpState, V2MarketState, V2OrderState, V2PoolState, V2PositionState, V2TraderState } from "./readModels.js";
export interface PdexApiClientOptions {
    baseUrl: string;
    fetchImpl?: typeof fetch;
    accountSessionToken?: string | AccountSessionTokenProvider;
    publicArtifactBaseUrl?: string;
    network?: string;
}
export type AccountSessionTokenProvider = () => string | undefined | Promise<string | undefined>;
export interface AccountSessionMessageInput {
    address: string;
    network: string;
    genesisId: string;
    genesisHash: string;
    origin: string;
    nonce: string;
    issuedAt: number;
    expiresAt: number;
    audience?: string;
    scopes?: readonly string[];
}
export interface AccountSessionRequest {
    address: string;
    message: string;
    signature: string;
}
export interface AccountSessionResponse extends BackendStateRecord {
    /** Direct on-chain signer bound at login; address remains the account owner. */
    authorizing_address?: string;
    session_token?: string;
    token_type?: "Bearer" | string;
    address: string;
    scopes: string[];
    network: string;
    issued_at: number;
    expires_at: number;
    seconds_until_expiry?: number;
}
export interface BackendV2OraclePayload {
    protocol_version: 2;
    oracle_message_version: 3;
    price_scale: number | string;
    market_id: number;
    app_id: number;
    index_asset_id: number;
    long_asset_id: number;
    short_asset_id: number;
    index_price_min: string;
    index_price_max: string;
    long_price_min: string;
    long_price_max: string;
    short_price_min: string;
    short_price_max: string;
    timestamp: number;
    message_hex: string;
    signature_hex: string;
    pubkey_hex: string;
    message_hash?: string;
    max_age_seconds?: number;
    max_future_skew_seconds?: number;
    valid_from_timestamp?: number;
    valid_until_timestamp?: number;
    source?: Record<string, unknown>;
}
export interface V2OraclePayloadBundleResponse extends BackendStateRecord {
    schema_version?: number;
    type?: "v2_oracle_payload_bundle_current" | string;
    oracle_message_version?: number;
    price_scale?: number | string;
    data_only?: boolean;
    network?: string;
    manifest_sha256?: string;
    updated_at?: number;
    expires_at?: number;
    current_path?: string;
    payloads?: Record<string, BackendV2OraclePayload>;
}
export type PriceCandlePeriod = "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w" | "1M";
export type PriceCandleTuple = [time: number, open: number, high: number, low: number, close: number];
export interface PriceCandlesRequest {
    marketId?: number | bigint | string;
    period: PriceCandlePeriod | string;
    limit?: number | bigint | string;
    to?: number | bigint | string;
    symbol?: string;
}
export interface PriceCandlesResponse extends BackendStateRecord {
    marketId: string;
    marketSlug?: string;
    indexSymbol?: string;
    source: string;
    pythSymbol?: string;
    pythChannel?: string;
    period: PriceCandlePeriod | string;
    resolution?: string;
    order: "asc" | "desc";
    candles: PriceCandleTuple[];
    updatedAt?: number;
    cache?: {
        status?: string;
        ttlSeconds?: number;
        bucketCount?: number;
    };
}
export interface V2LatestPriceResponse extends BackendStateRecord {
    schema_version?: number;
    type?: "v2_latest_price" | string;
    oracle_message_version?: number;
    price_scale?: number | string;
    data_only?: boolean;
    network?: string;
    manifest_sha256?: string;
    market_id: number;
    generated_at?: number;
    oracle_timestamp?: number;
    valid_from_timestamp?: number;
    valid_until_timestamp?: number;
    index_asset_id?: number;
    long_asset_id?: number;
    short_asset_id?: number;
    index_price_min?: string;
    index_price_max?: string;
    index_price?: string;
    long_price_min?: string;
    long_price_max?: string;
    long_price?: string;
    short_price_min?: string;
    short_price_max?: string;
    short_price?: string;
    artifact_hash?: string;
    artifact_path?: string;
    current_path?: string;
    source?: Record<string, unknown>;
}
export interface V2LatestPriceBundleResponse extends BackendStateRecord {
    schema_version?: number;
    type?: "v2_latest_price_bundle_current" | string;
    oracle_message_version?: number;
    price_scale?: number | string;
    data_only?: boolean;
    network?: string;
    manifest_sha256?: string;
    updated_at?: number;
    expires_at?: number;
    current_path?: string;
    prices?: Record<string, V2LatestPriceResponse>;
}
export type V2OracleTarget = "trading" | "admin" | "admin_ops" | "swap" | "swap_ops" | "single_token_ops" | "single_token_trading" | "cva_vault" | "market_yield_vault" | "market_xalgo_yield_vault" | "market_folks_yield_vault" | "order_ops" | "orders";
export type BackendStateRecord = Record<string, unknown>;
export type MarketState = V2MarketState;
export type PoolState = V2PoolState;
export type TraderState = V2TraderState;
export type PositionState = V2PositionState;
export type LimitOrderState = V2OrderState;
export type LpState = V2LpState;
export type QuoteResponse = BackendStateRecord;
export type LiquidityPerformancePeriod = "7d" | "30d" | "90d" | "total";
export interface V2PageRequest {
    limit?: number | bigint | string;
    cursor?: string;
}
export interface V2AccountTradesRequest extends V2PageRequest {
    marketId?: number | bigint | string;
}
export interface V2AccountTradesResponse extends BackendStateRecord {
    type?: "v2_account_trades" | string;
    owner?: string;
    market_id?: string;
    limit?: number;
    cursor?: string;
    next_cursor?: string | null;
    trades?: BackendStateRecord[];
}
export interface V2AccountActivityResponse extends BackendStateRecord {
    type?: "v2_account_activity" | string;
    owner?: string;
    limit?: number;
    cursor?: string;
    next_cursor?: string | null;
    activities?: V2AccountActivityItemState[];
}
export interface V2LiquidityPerformanceResponse extends BackendStateRecord {
    product_kind?: "market_pool" | "cva" | string;
    product_id?: number | string;
    period?: LiquidityPerformancePeriod | string;
    sample_interval_seconds?: number;
    benchmark?: BackendStateRecord;
    summary?: BackendStateRecord;
    points?: BackendStateRecord[];
}
export interface V2StaticMetadataResponse extends BackendStateRecord {
    schema_version?: number;
    metadata_kind?: string;
    network?: string;
    artifact_hash?: string;
    current_path?: string;
    data_only?: boolean;
}
export interface V2AccountState {
    trader: TraderState;
    positions: PositionState[];
    orders: LimitOrderState[];
    lps: LpState[];
    margin: V2AccountMarginState;
}
export interface DeploymentState {
    apps?: Record<string, number | null>;
    assets?: Record<string, number | null>;
}
export interface V2SdkBootstrapState extends BackendStateRecord {
    schema_version?: number;
    network?: string;
    manifest_sha256?: string;
    app_ids?: Record<string, number>;
    app_addresses?: Record<string, string>;
    assets?: Record<string, number>;
    feature_flags?: Record<string, unknown>;
    data_only?: boolean;
}
export interface V2SdkResourcesState extends BackendStateRecord {
    schema_version?: number;
    network?: string;
    manifest_sha256?: string;
    app_ids?: Record<string, number>;
    app_addresses?: Record<string, string>;
    assets?: Record<string, number>;
    box_prefixes?: Record<string, string>;
    data_only?: boolean;
}
export interface V2MarketSummaryResponse extends BackendStateRecord {
    schema_version?: number;
    type?: "v2_market_summary" | string;
    data_only?: boolean;
    network?: string;
    manifest_sha256?: string;
    last_indexed_round?: number;
    markets?: MarketState[];
    pools?: PoolState[];
    product_catalog?: BackendStateRecord;
}
export interface V2OrderPolicyResponse extends BackendStateRecord {
    schema_version?: number;
    type?: "v2_order_policy" | string;
    data_only?: boolean;
    network?: string;
    manifest_sha256?: string;
    last_indexed_round?: number;
    order_policy?: BackendStateRecord;
}
export declare class PdexApiClient {
    readonly baseUrl: string;
    readonly publicArtifactBaseUrl?: string;
    readonly network?: string;
    private readonly fetchImpl;
    private accountSessionToken?;
    constructor(options: PdexApiClientOptions | string);
    setAccountSessionToken(token: string | AccountSessionTokenProvider | undefined): void;
    health(): Promise<{
        ok: boolean;
    }>;
    ready(): Promise<BackendStateRecord>;
    loadProtocol(version?: number): Promise<ProtocolManifest>;
    v2Markets(): Promise<MarketState[]>;
    v2Market(marketId: number | bigint | string): Promise<MarketState>;
    v2Pools(): Promise<PoolState[]>;
    v2Pool(poolId: number | bigint | string): Promise<PoolState>;
    v2PoolPerformance(poolId: number | bigint | string, period?: LiquidityPerformancePeriod): Promise<V2LiquidityPerformanceResponse>;
    v2MarketSummary(): Promise<V2MarketSummaryResponse>;
    v2OrderPolicy(): Promise<V2OrderPolicyResponse>;
    v2StaticMetadataCurrent(kind?: string): Promise<V2StaticMetadataResponse>;
    v2StaticMetadataArtifact(kind: string, artifactHash: string): Promise<V2StaticMetadataResponse>;
    deployment(network: string): Promise<DeploymentState>;
    v2SdkBootstrap(): Promise<V2SdkBootstrapState>;
    v2SdkResources(): Promise<V2SdkResourcesState>;
    v2PriceCandles(input: PriceCandlesRequest): Promise<PriceCandlesResponse>;
    v2LatestPrice(marketId: number | bigint | string): Promise<V2LatestPriceResponse>;
    createAccountSession(input: AccountSessionRequest): Promise<AccountSessionResponse>;
    logoutAccountSession(): Promise<{
        ok: boolean;
    }>;
    v2Trader(address: string): Promise<TraderState>;
    v2Positions(address: string): Promise<PositionState[]>;
    v2Orders(owner?: string): Promise<LimitOrderState[]>;
    v2Order(owner: string, ownerOrderId: number | bigint | string): Promise<LimitOrderState>;
    v2AccountOrders(address: string): Promise<LimitOrderState[]>;
    v2AccountTrades(address: string, input?: V2AccountTradesRequest): Promise<V2AccountTradesResponse>;
    v2AccountActivity(address: string, input?: V2PageRequest): Promise<V2AccountActivityResponse>;
    v2Lps(address: string): Promise<LpState[]>;
    margin(address: string): Promise<V2AccountMarginState>;
    v2Account(address: string): Promise<V2AccountState>;
    v2QuoteOpen(input: BackendStateRecord): Promise<QuoteResponse>;
    v2QuoteDecrease(input: BackendStateRecord): Promise<QuoteResponse>;
    v2QuoteDecreaseWithSwap(input: BackendStateRecord): Promise<QuoteResponse>;
    v2QuoteAdjustMargin(input: BackendStateRecord): Promise<QuoteResponse>;
    v2QuoteLpDeposit(input: BackendStateRecord): Promise<QuoteResponse>;
    v2QuoteLpWithdraw(input: BackendStateRecord): Promise<QuoteResponse>;
    v2MarketYieldStrategies(): Promise<BackendStateRecord[]>;
    v2MarketYieldStrategy(marketId: number | bigint | string, assetId: number | bigint | string): Promise<BackendStateRecord>;
    v2MarketYieldObservations(): Promise<BackendStateRecord[]>;
    v2MarketYieldObservation(marketId: number | bigint | string, assetId: number | bigint | string): Promise<BackendStateRecord>;
    v2MarketYieldResourceRegistry(): Promise<BackendStateRecord>;
    v2MarketYieldActionRecallPlan(input: BackendStateRecord): Promise<QuoteResponse>;
    v2MarketYieldHealth(): Promise<BackendStateRecord>;
    v2QuoteLpWithdrawWithSwap(input: BackendStateRecord): Promise<QuoteResponse>;
    v2QuoteSwap(input: BackendStateRecord): Promise<QuoteResponse>;
    v2QuoteSwapRoute(input: BackendStateRecord): Promise<QuoteResponse>;
    v2QuoteLiquidation(input: BackendStateRecord): Promise<QuoteResponse>;
    v2QuoteAdl(input: BackendStateRecord): Promise<QuoteResponse>;
    v2QuoteSingleTokenLpDeposit(input: BackendStateRecord): Promise<QuoteResponse>;
    v2QuoteSingleTokenLpWithdraw(input: BackendStateRecord): Promise<QuoteResponse>;
    v2QuoteSingleTokenOpen(input: BackendStateRecord): Promise<QuoteResponse>;
    v2QuoteSingleTokenDecrease(input: BackendStateRecord): Promise<QuoteResponse>;
    v2QuoteSingleTokenLiquidation(input: BackendStateRecord): Promise<QuoteResponse>;
    v2QuoteSingleTokenAdl(input: BackendStateRecord): Promise<QuoteResponse>;
    v2QuoteOrderOpenLimit(input: BackendStateRecord): Promise<QuoteResponse>;
    v2QuoteOrderDecrease(input: BackendStateRecord): Promise<QuoteResponse>;
    v2QuoteOrderExecute(input: BackendStateRecord): Promise<QuoteResponse>;
    v2AnalyzeOrder(input: BackendStateRecord): Promise<QuoteResponse>;
    v2CvaVaults(): Promise<BackendStateRecord[]>;
    v2CvaVault(vaultId: number | bigint | string): Promise<BackendStateRecord>;
    v2CvaPerformance(vaultId: number | bigint | string, period?: LiquidityPerformancePeriod): Promise<V2LiquidityPerformanceResponse>;
    v2CvaAllocations(vaultId: number | bigint | string): Promise<BackendStateRecord[]>;
    v2CvaAccount(owner: string): Promise<BackendStateRecord>;
    v2QuoteCvaDeposit(input: BackendStateRecord): Promise<QuoteResponse>;
    v2QuoteCvaWithdraw(input: BackendStateRecord): Promise<QuoteResponse>;
    v2QuoteCvaWithdrawRoute(input: BackendStateRecord): Promise<QuoteResponse>;
    v2QuoteCvaAllocate(input: BackendStateRecord): Promise<QuoteResponse>;
    v2QuoteCvaRebalance(input: BackendStateRecord): Promise<QuoteResponse>;
    v2AccountMargin(address: string): Promise<V2AccountMarginState>;
    v2OraclePayload(input: {
        marketId: number | bigint | string;
        appId?: number | bigint | string;
        target?: V2OracleTarget | string;
        assetId?: number | bigint | string;
        asset?: string;
        indexAssetId?: number | bigint | string;
        longAssetId?: number | bigint | string;
        shortAssetId?: number | bigint | string;
    }): Promise<BackendV2OraclePayload>;
    private getV2OraclePayloadFromBackend;
    v2OracleArgs(input: Parameters<PdexApiClient["v2OraclePayload"]>[0]): Promise<OraclePayload>;
    private get;
    private post;
    private getPublicArtifactJson;
    private v2LatestPriceBundleArtifactKey;
    private v2OraclePayloadBundleArtifactKey;
    private v2OraclePayloadCacheKey;
    private headers;
}
export declare function createPdexApiClient(options: PdexApiClientOptions | string): PdexApiClient;
export declare function buildAccountSessionMessage(input: AccountSessionMessageInput): string;
export declare function validateBackendV2OraclePayload(payload: BackendV2OraclePayload): void;
export declare function validateLatestPricePayload(payload: V2LatestPriceResponse): void;
//# sourceMappingURL=api.d.ts.map