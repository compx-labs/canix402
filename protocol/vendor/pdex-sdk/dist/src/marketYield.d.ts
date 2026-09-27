import type { PdexApiClient } from "./api.js";
import { type Uint64Like } from "./boxes.js";
import { type Receipt } from "./receipts.js";
export declare const MARKET_YIELD_RESOURCE_REGISTRY_SCHEMA_VERSION = 1;
export declare const MARKET_YIELD_RECALL_MODE_AUTO = "auto";
export declare const MARKET_YIELD_RECALL_MODE_FORCE_RECALL = "force_recall";
export declare const MARKET_YIELD_RECALL_MODE_RESOURCES_ONLY = "resources_only";
export declare const MARKET_YIELD_RECALL_MODE_DISABLED = "disabled";
export type MarketYieldActionRecallClient = Pick<PdexApiClient, "v2MarketYieldActionRecallPlan" | "v2MarketYieldResourceRegistry"> & {
    network?: string;
};
export interface PrepareV2ActionRecallInput {
    marketId: Uint64Like;
    expectedNetwork?: string;
    expectedMarketsAppId: Uint64Like;
    indexAssetId?: Uint64Like;
    /** Include every asset the action can pay, even if its preview output is zero. */
    assetIds: Uint64Like[];
    outputs?: Array<{
        assetId: Uint64Like;
        requiredHotAmount: Uint64Like;
    }>;
    actionFamily?: string;
    methodName?: string;
    marketYieldRegistry?: Record<string, unknown>;
}
export interface PreparedV2ActionRecall {
    yieldRecallMode: number;
    marketYieldRegistry: Record<string, unknown>;
    capsByAsset: Record<string, bigint>;
    capForAsset: (assetId: Uint64Like) => bigint;
}
export declare class YieldRecallUnavailableError extends Error {
    constructor(message: string);
}
/** Plan bounded, atomic recall even when the preview is fully funded by idle cash.
 * Missing or inconsistent metadata is an error, never evidence that yield is off.
 */
export declare function prepareV2ActionRecall(client: MarketYieldActionRecallClient, input: PrepareV2ActionRecallInput): Promise<PreparedV2ActionRecall>;
export declare const V2_YIELD_EXCHANGE_RATE_SCALE = 1000000n;
export declare const V2_YIELD_MAX_POOL_CALL_FEE_MICRO_ALGO = 10000;
export declare const PDEX_FOLKS_EXTERNAL_PROTOCOL_FEE_MICRO_ALGO = 0;
export declare const MARKET_YIELD_FOLKS_RECALL_FLAT_FEE_MICRO_ALGO: number;
export declare const MARKET_XALGO_YIELD_RECALL_FLAT_FEE_MICRO_ALGO: number;
export declare const MARKET_YIELD_RETURN_EVENT_TYPES: Set<string>;
export interface MarketYieldStrategyResourceConfig {
    market_id: number;
    asset_id: number;
    strategy_kind: number;
    folks_pool_app_id: number;
    folks_pool_manager_app_id: number;
    underlying_asset_id: number;
    receipt_asset_id: number;
    xalgo_consensus_app_id: number;
    xalgo_asset_id: number;
    xalgo_proposer_addresses: string[];
    xalgo_provider_fee_credit_per_call_microalgos: number;
}
export interface MarketYieldMarketResourceConfig {
    market_id: number;
    index_asset_id: number | null;
    pool_type: number | null;
    long_asset_id: number | null;
    short_asset_id: number | null;
}
export interface MarketYieldProtocolResourceRegistry {
    schema_version: number;
    registry_version: string;
    last_indexed_round: number;
    markets_app_id: number;
    market_yield_vault_app_id: number;
    strategies: MarketYieldStrategyResourceConfig[];
    markets: MarketYieldMarketResourceConfig[];
    markets_app_address: string;
    market_yield_vault_app_address: string;
    market_folks_yield_vault_app_id: number;
    market_folks_yield_vault_app_address: string;
    market_xalgo_yield_vault_app_id: number;
    market_xalgo_yield_vault_app_address: string;
    xalgo_consensus_app_id: number;
    xalgo_asset_id: number;
    xalgo_proposer_addresses: string[];
    action_recall_uses_router: boolean;
    base_heavy_call_flat_fee_micro_algos: number;
    market_yield_recall_flat_fee_micro_algos: number;
    registry_hash?: string;
}
export interface MarketYieldDynamicObservation {
    provider_available_underlying: number;
    observed_lending_utilization_bps: number;
    observed_pdex_share_bps: number;
    observed_receipt_exchange_rate: number;
    observed_timestamp: number;
    hot_balance?: number;
    required_hot_amount?: number;
}
export interface MarketYieldHotShortfall {
    required_hot_amount: number;
    hot_balance: number;
    shortfall: number;
}
export interface MarketYieldWithdrawalQuote {
    ownership_maximum: bigint;
    hot_funded: bigint;
    needed_recall: bigint;
    provider_recallable: bigint;
    protocol_recallable: bigint;
    maximum_fundable: bigint;
}
export interface MarketYieldResourceClosure {
    foreignApps: number[];
    foreignAssets: number[];
    accounts: string[];
    boxes: Array<[number, Uint8Array]>;
    boxesB64: string[];
    flatFeeMicroAlgo: bigint;
}
export declare class MarketYieldResourceRegistryCache {
    private readonly loader;
    private readonly maxAgeRounds?;
    private snapshot?;
    constructor(loader: () => MarketYieldProtocolResourceRegistry | Record<string, unknown>, maxAgeRounds?: number | undefined);
    get(options?: {
        currentRound?: number;
        forceRefresh?: boolean;
        expectedRegistryHash?: string;
    }): MarketYieldProtocolResourceRegistry;
    refresh(): MarketYieldProtocolResourceRegistry;
}
export declare function normalizeMarketYieldRegistry(input: MarketYieldProtocolResourceRegistry | Record<string, unknown>): MarketYieldProtocolResourceRegistry;
export declare function normalizeMarketYieldStrategy(input: Partial<MarketYieldStrategyResourceConfig> | Record<string, unknown>): MarketYieldStrategyResourceConfig;
export declare function normalizeMarketYieldMarket(input: Partial<MarketYieldMarketResourceConfig> | Record<string, unknown>): MarketYieldMarketResourceConfig;
export declare function marketYieldRegistryToJson(registryInput: MarketYieldProtocolResourceRegistry | Record<string, unknown>, includeHash?: boolean): Record<string, unknown>;
export declare function computeMarketYieldRegistryHash(registryInput: MarketYieldProtocolResourceRegistry | Record<string, unknown>): string;
export declare function estimateMarketYieldHotShortfall(input: {
    requiredHotAmount: Uint64Like;
    hotBalance: Uint64Like;
}): MarketYieldHotShortfall;
export declare function quoteMarketYieldWithdrawal(input: {
    ownershipMaximum: Uint64Like;
    hotAmount: Uint64Like;
    providerWithdrawable: Uint64Like;
    protocolRecallCapacityUnderlying: Uint64Like;
}): MarketYieldWithdrawalQuote;
export declare function marketYieldReceiptAmountForUnderlying(input: {
    underlyingAmount: Uint64Like;
    observedReceiptExchangeRate: Uint64Like;
}): bigint;
export declare function marketYieldFreshObservationFromObject(input: Record<string, unknown>): MarketYieldDynamicObservation;
export declare function buildMarketYieldResourceClosure(input: {
    registry: MarketYieldProtocolResourceRegistry | MarketYieldResourceRegistryCache | Record<string, unknown>;
    marketId: Uint64Like;
    assetId: Uint64Like;
    indexAssetId?: Uint64Like;
    includeVirtualInventory?: boolean;
    accounts?: string[];
    includeAppAddresses?: boolean;
}): MarketYieldResourceClosure;
export declare function decodeMarketYieldReturn(data: Uint8Array | string, options?: {
    appName?: string;
}): Receipt;
//# sourceMappingURL=marketYield.d.ts.map