import { type ProtocolManifest } from "./manifest.js";
export type AddressLike = string | Uint8Array;
export type Uint64Like = number | bigint | string;
export { decodeV2PendingImpactQty, V2_SIGNED_QTY_BIAS } from "./constants.js";
export declare const V2_MARKET_CORE_SCHEMA_VERSION = 3n;
export declare const V2_ORACLE_TO_USD_SCALE = 1000000n;
export declare const V2_ALLOWED_POSITION_TOKEN_SCALES: readonly bigint[];
export declare function accountBytes(value: AddressLike): Uint8Array;
export declare function v2MarketCoreBoxKey(marketId: Uint64Like): Uint8Array;
export declare function v2MarketRiskBoxKey(marketId: Uint64Like): Uint8Array;
export declare function v2DynamicOiMarginBoxKey(marketId: Uint64Like): Uint8Array;
export declare function v2MarketPoolBoxKey(marketId: Uint64Like): Uint8Array;
export declare function v2MarketOpenInterestBoxKey(marketId: Uint64Like): Uint8Array;
export declare function v2MarketFundingBorrowingBoxKey(marketId: Uint64Like): Uint8Array;
export declare function v2MarketAdaptiveFundingBoxKey(marketId: Uint64Like): Uint8Array;
export declare function v2VirtualPositionInventoryBoxKey(indexAssetId: Uint64Like): Uint8Array;
export declare function v2LpBoxKey(owner: AddressLike, marketId: Uint64Like): Uint8Array;
export declare function v2TraderBoxKey(owner: AddressLike): Uint8Array;
export declare function v2PositionBoxKey(owner: AddressLike, marketId: Uint64Like, collateralAssetId: Uint64Like, side: Uint64Like): Uint8Array;
export declare function v2OrderBoxKey(owner: AddressLike, orderId: Uint64Like): Uint8Array;
export declare function v2CvaUserBoxKey(owner: AddressLike): Uint8Array;
export declare function v2CvaMarketAllocationBoxKey(marketId: Uint64Like): Uint8Array;
export declare function v2YieldStorageKey(marketId: Uint64Like, assetId: Uint64Like): Uint8Array;
export declare function v2MarketYieldBoxKey(marketId: Uint64Like, assetId: Uint64Like): Uint8Array;
export declare function v2MarketYieldStrategyConfigBoxKey(marketId: Uint64Like, assetId: Uint64Like): Uint8Array;
export declare function v2MarketYieldStrategyRuntimeBoxKey(marketId: Uint64Like, assetId: Uint64Like): Uint8Array;
export declare function v2MarketXalgoStrategyConfigBoxKey(marketId: Uint64Like): Uint8Array;
export declare function v2MarketXalgoStrategyRuntimeBoxKey(marketId: Uint64Like): Uint8Array;
export declare function parseUint64Struct(data: Uint8Array, fields: string[]): Record<string, bigint>;
export type V2BoxFieldValue = bigint | string | Uint8Array;
export interface V2OrderStateV3 {
    /** Stored order schema version. */
    schema_version: bigint;
    /** Open-limit, take-profit, or stop-loss order kind. */
    order_kind: bigint;
    /** Pair or single-token Trading target. */
    target_kind: bigint;
    /** Market whose position the order changes. */
    market_id: bigint;
    /** Owner-scoped order identifier. */
    owner_order_id: bigint;
    /** Long or short position side. */
    side: bigint;
    /** Token held as position collateral. */
    collateral_asset_id: bigint;
    /** Requested USD position-size change; zero means full resting close. */
    size_usd_delta: bigint;
    /** Gross collateral escrowed for an open order. */
    collateral_amount: bigint;
    /** Oracle trigger price for resting execution. */
    trigger_price: bigint;
    /** User-signed execution-price bound. */
    acceptable_price: bigint;
    /** Asset used to compensate the executing keeper. */
    keeper_fee_asset_id: bigint;
    /** Keeper compensation escrowed with the order. */
    keeper_fee_amount: bigint;
    /** Optional close-output swap selection. */
    output_swap_mode: bigint;
    /** Minimum accepted primary output after all fees. */
    min_primary_output_amount: bigint;
    /** Minimum accepted secondary output after all fees. */
    min_secondary_output_amount: bigint;
    /** Optional order expiry timestamp. */
    expiry_time: bigint;
    /** Timestamp at which the order was created. */
    created_at: bigint;
    /** Time-in-force and linked-order state flags. */
    flags: bigint;
    /** User-authorized account that receives any paid builder fee. */
    builder_address: string;
    /** User-authorized builder fee rate in basis points. */
    builder_fee_bps: bigint;
}
export interface V2OrderStateV4 extends V2OrderStateV3 {
    /** Bound lifetime for active protection; waiting entries remain unbound. */
    position_id: bigint;
}
export type V2DecodedOrderState = V2OrderStateV3 | V2OrderStateV4;
export declare function parseTypedStruct(data: Uint8Array, fields: Array<{
    name: string;
    type?: string;
    size?: number;
}>): Record<string, any>;
export declare function parseBoxState(valueType: string, data: Uint8Array, manifest?: ProtocolManifest): Record<string, any>;
export declare function parseV2OrderState(data: Uint8Array, manifest?: ProtocolManifest): V2DecodedOrderState;
export declare function parseV2BoxState(boxFormat: string, data: Uint8Array, manifest?: ProtocolManifest): Record<string, any>;
export declare function parseV2MarketCoreState(data: Uint8Array, manifest?: ProtocolManifest): Record<string, bigint>;
export declare function positionScalesFromConversionScale(positionConversionScale: Uint64Like): Record<"position_token_scale" | "position_conversion_scale", bigint>;
export declare function readV2MarketPositionScales(market: Record<string, unknown>): Record<"position_token_scale" | "position_conversion_scale", bigint>;
export declare function parseV2MarketRiskState(data: Uint8Array, manifest?: ProtocolManifest): Record<string, bigint>;
export declare function parseV2MarketPoolState(data: Uint8Array, manifest?: ProtocolManifest): Record<string, bigint>;
export declare function parseV2MarketOpenInterestState(data: Uint8Array, manifest?: ProtocolManifest): Record<string, bigint>;
export declare function parseV2MarketFundingBorrowingState(data: Uint8Array, manifest?: ProtocolManifest): Record<string, bigint>;
export declare function parseV2MarketAdaptiveFundingState(data: Uint8Array, manifest?: ProtocolManifest): Record<string, bigint>;
export declare function parseV2LpState(data: Uint8Array, manifest?: ProtocolManifest): Record<string, bigint>;
export declare function parseV2TraderState(data: Uint8Array, manifest?: ProtocolManifest): Record<string, bigint>;
export declare function parseV2PositionState(data: Uint8Array, manifest?: ProtocolManifest): Record<string, bigint>;
export declare function parseV2CvaUserState(data: Uint8Array, manifest?: ProtocolManifest): Record<string, bigint>;
export declare function parseV2CvaMarketAllocationState(data: Uint8Array, manifest?: ProtocolManifest): Record<string, bigint>;
export declare function parseV2MarketYieldState(data: Uint8Array, manifest?: ProtocolManifest): Record<string, bigint>;
export declare function parseV2MarketYieldStrategyConfig(data: Uint8Array, manifest?: ProtocolManifest): Record<string, bigint>;
export declare function parseV2MarketYieldStrategyRuntime(data: Uint8Array, manifest?: ProtocolManifest): Record<string, bigint>;
//# sourceMappingURL=boxes.d.ts.map