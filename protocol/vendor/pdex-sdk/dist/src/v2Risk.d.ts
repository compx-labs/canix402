import type { BigNumberish } from "./constants.js";
export declare const V2_MATH_FACTOR_SCALE = 1000000000000n;
export declare const V2_DYNAMIC_OI_MARGIN_CONFIG_VERSION = 1n;
export declare const V2_DYNAMIC_OI_MARGIN_CONFIG_FLAG_ENABLED = 1n;
export declare const V2_DYNAMIC_OI_MARGIN_CONFIG_SIZE = 32;
export declare const V2_DYNAMIC_OI_MARGIN_CONFIG_FIELDS: readonly ["dynamic_oi_margin_version", "dynamic_oi_margin_flags", "dynamic_oi_margin_long_factor_scaled", "dynamic_oi_margin_short_factor_scaled"];
export type V2DynamicOiMarginConfigField = (typeof V2_DYNAMIC_OI_MARGIN_CONFIG_FIELDS)[number];
export type V2DynamicOiMarginConfigInput = Partial<Record<V2DynamicOiMarginConfigField, BigNumberish> & {
    enabled: boolean;
    dynamic_oi_margin_enabled: boolean;
    long_factor_scaled: BigNumberish;
    short_factor_scaled: BigNumberish;
}>;
export type V2DynamicOiMarginConfigValues = Record<V2DynamicOiMarginConfigField, bigint> & {
    dynamic_oi_margin_enabled: boolean;
};
export declare const V2_MARKET_RISK_FIELDS: readonly ["min_position_size_usd", "min_collateral_usd", "initial_margin_bps", "maintenance_margin_bps", "max_open_interest_long", "max_open_interest_short", "max_pool_amount_long", "max_pool_amount_short", "max_pool_usd_for_deposit_long", "max_pool_usd_for_deposit_short", "reserve_factor_long_bps", "reserve_factor_short_bps", "max_pnl_factor_for_deposits_bps", "max_pnl_factor_for_withdrawals_bps", "max_pnl_factor_for_traders_bps", "max_pnl_factor_for_adl_bps", "min_pnl_factor_after_adl_bps", "position_impact_factor_bps", "max_position_impact_bps", "swap_impact_factor_bps", "max_swap_impact_bps", "open_fee_bps", "close_fee_bps", "liquidation_fee_bps", "max_liquidation_impact_bps", "funding_factor_milli_bps", "funding_interval_seconds", "base_borrowing_factor_long_milli_bps", "base_borrowing_factor_short_milli_bps", "full_usage_borrowing_factor_long_milli_bps", "full_usage_borrowing_factor_short_milli_bps", "optimal_usage_factor_long_bps", "optimal_usage_factor_short_bps"];
export type V2MarketRiskField = (typeof V2_MARKET_RISK_FIELDS)[number];
export type V2MarketRiskInput = Partial<Record<V2MarketRiskField, BigNumberish>>;
export type V2MarketRiskValues = Record<V2MarketRiskField, bigint>;
export declare function encodeV2DynamicOiMarginConfig(input: V2DynamicOiMarginConfigInput): Uint8Array;
export declare function decodeV2DynamicOiMarginConfig(data: Uint8Array): V2DynamicOiMarginConfigValues;
export declare function readV2DynamicOiMarginConfig(input: Record<string, unknown>): {
    ok: boolean;
    missing: Array<V2DynamicOiMarginConfigField | string>;
    values: Partial<V2DynamicOiMarginConfigValues>;
};
export declare function encodeV2MarketRisk(input: V2MarketRiskInput): Uint8Array;
export declare function validateV2MarketRisk(input: V2MarketRiskInput): void;
export declare function decodeV2ImpactSettingComponents(value: BigNumberish): [bigint, bigint, bigint, bigint];
export declare function readV2MarketRisk(input: Record<string, unknown>): {
    ok: boolean;
    missing: V2MarketRiskField[];
    values: Partial<V2MarketRiskValues>;
};
//# sourceMappingURL=v2Risk.d.ts.map