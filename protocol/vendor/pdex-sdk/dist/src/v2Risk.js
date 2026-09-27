import { concat, uint64Bytes } from "./codec.js";
export const V2_MATH_FACTOR_SCALE = 1000000000000n;
const IMPACT_PACK_FLAG = 1000000000000000000n;
const IMPACT_PACK_COMPONENT_SCALE = 1000000n;
const IMPACT_PACK_POS_EXP_SCALE = 1000000000000n;
const IMPACT_PACK_NEG_EXP_SCALE = 1000000000000000n;
const IMPACT_PACK_EXP_MOD = 1000n;
const V2_BPS = 10000n;
const V2_MAX_BORROWING_FACTOR_MILLI_BPS = 2000n;
export const V2_DYNAMIC_OI_MARGIN_CONFIG_VERSION = 1n;
export const V2_DYNAMIC_OI_MARGIN_CONFIG_FLAG_ENABLED = 1n;
export const V2_DYNAMIC_OI_MARGIN_CONFIG_SIZE = 32;
export const V2_DYNAMIC_OI_MARGIN_CONFIG_FIELDS = [
    "dynamic_oi_margin_version",
    "dynamic_oi_margin_flags",
    "dynamic_oi_margin_long_factor_scaled",
    "dynamic_oi_margin_short_factor_scaled",
];
export const V2_MARKET_RISK_FIELDS = [
    "min_position_size_usd",
    "min_collateral_usd",
    "initial_margin_bps",
    "maintenance_margin_bps",
    "max_open_interest_long",
    "max_open_interest_short",
    "max_pool_amount_long",
    "max_pool_amount_short",
    "max_pool_usd_for_deposit_long",
    "max_pool_usd_for_deposit_short",
    "reserve_factor_long_bps",
    "reserve_factor_short_bps",
    "max_pnl_factor_for_deposits_bps",
    "max_pnl_factor_for_withdrawals_bps",
    "max_pnl_factor_for_traders_bps",
    "max_pnl_factor_for_adl_bps",
    "min_pnl_factor_after_adl_bps",
    "position_impact_factor_bps",
    "max_position_impact_bps",
    "swap_impact_factor_bps",
    "max_swap_impact_bps",
    "open_fee_bps",
    "close_fee_bps",
    "liquidation_fee_bps",
    "max_liquidation_impact_bps",
    "funding_factor_milli_bps",
    "funding_interval_seconds",
    "base_borrowing_factor_long_milli_bps",
    "base_borrowing_factor_short_milli_bps",
    "full_usage_borrowing_factor_long_milli_bps",
    "full_usage_borrowing_factor_short_milli_bps",
    "optimal_usage_factor_long_bps",
    "optimal_usage_factor_short_bps",
];
export function encodeV2DynamicOiMarginConfig(input) {
    const enabled = Boolean(input.enabled ?? input.dynamic_oi_margin_enabled ?? false);
    const flags = enabled ? V2_DYNAMIC_OI_MARGIN_CONFIG_FLAG_ENABLED : 0n;
    const longFactor = bigint(input.long_factor_scaled ?? input.dynamic_oi_margin_long_factor_scaled ?? 0n);
    const shortFactor = bigint(input.short_factor_scaled ?? input.dynamic_oi_margin_short_factor_scaled ?? 0n);
    if (flags === 0n && (longFactor !== 0n || shortFactor !== 0n)) {
        throw new Error("disabled dynamic OI config requires zero factors");
    }
    if (flags === V2_DYNAMIC_OI_MARGIN_CONFIG_FLAG_ENABLED && longFactor === 0n && shortFactor === 0n) {
        throw new Error("enabled dynamic OI config requires at least one non-zero factor");
    }
    return concat([
        uint64Bytes(V2_DYNAMIC_OI_MARGIN_CONFIG_VERSION),
        uint64Bytes(flags),
        uint64Bytes(longFactor),
        uint64Bytes(shortFactor),
    ]);
}
export function decodeV2DynamicOiMarginConfig(data) {
    if (data.byteLength !== V2_DYNAMIC_OI_MARGIN_CONFIG_SIZE) {
        throw new Error(`dynamic OI config expects ${V2_DYNAMIC_OI_MARGIN_CONFIG_SIZE} bytes, got ${data.byteLength}`);
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const version = view.getBigUint64(0);
    const flags = view.getBigUint64(8);
    const longFactor = view.getBigUint64(16);
    const shortFactor = view.getBigUint64(24);
    if (version !== V2_DYNAMIC_OI_MARGIN_CONFIG_VERSION)
        throw new Error("bad dynamic OI config version");
    if (flags !== 0n && flags !== V2_DYNAMIC_OI_MARGIN_CONFIG_FLAG_ENABLED)
        throw new Error("bad dynamic OI config flags");
    if (flags === 0n && (longFactor !== 0n || shortFactor !== 0n)) {
        throw new Error("disabled dynamic OI config requires zero factors");
    }
    if (flags === V2_DYNAMIC_OI_MARGIN_CONFIG_FLAG_ENABLED && longFactor === 0n && shortFactor === 0n) {
        throw new Error("enabled dynamic OI config requires at least one non-zero factor");
    }
    return {
        dynamic_oi_margin_version: version,
        dynamic_oi_margin_flags: flags,
        dynamic_oi_margin_enabled: flags !== 0n,
        dynamic_oi_margin_long_factor_scaled: longFactor,
        dynamic_oi_margin_short_factor_scaled: shortFactor,
    };
}
export function readV2DynamicOiMarginConfig(input) {
    const nested = input.dynamic_oi_margin;
    const source = nested && typeof nested === "object" ? nested : input;
    const missing = [];
    for (const field of V2_DYNAMIC_OI_MARGIN_CONFIG_FIELDS) {
        if (source[field] === undefined || source[field] === null)
            missing.push(field);
    }
    if (missing.length > 0)
        return { ok: false, missing, values: {} };
    try {
        const raw = concat(V2_DYNAMIC_OI_MARGIN_CONFIG_FIELDS.map((field) => uint64Bytes(bigint(source[field]))));
        return { ok: true, missing: [], values: decodeV2DynamicOiMarginConfig(raw) };
    }
    catch (error) {
        return { ok: false, missing: [error.message], values: {} };
    }
}
export function encodeV2MarketRisk(input) {
    const values = Object.fromEntries(V2_MARKET_RISK_FIELDS.map((field) => [field, requiredRiskValue(input, field)]));
    validateV2MarketRisk(values);
    return concat(V2_MARKET_RISK_FIELDS.map((field) => uint64Bytes(values[field])));
}
export function validateV2MarketRisk(input) {
    const risk = Object.fromEntries(V2_MARKET_RISK_FIELDS.map((field) => [field, requiredRiskValue(input, field)]));
    for (const side of ["long", "short"]) {
        const base = risk[`base_borrowing_factor_${side}_milli_bps`];
        const full = risk[`full_usage_borrowing_factor_${side}_milli_bps`];
        if (base <= 0n)
            throw new Error(`base borrowing factor must be > 0 for ${side}`);
        if (full > V2_MAX_BORROWING_FACTOR_MILLI_BPS) {
            throw new Error(`borrowing factor exceeds maximum for ${side}`);
        }
        if (base > full) {
            throw new Error(`base borrowing factor must not exceed full usage for ${side}`);
        }
    }
    if (!(risk.max_pnl_factor_for_withdrawals_bps <= risk.min_pnl_factor_after_adl_bps
        && risk.min_pnl_factor_after_adl_bps <= risk.max_pnl_factor_for_adl_bps
        && risk.max_pnl_factor_for_adl_bps <= risk.max_pnl_factor_for_deposits_bps
        && risk.max_pnl_factor_for_deposits_bps <= risk.max_pnl_factor_for_traders_bps)) {
        throw new Error("bad pnl cap order");
    }
    const impactLimits = [
        ["position_impact_factor_bps", V2_BPS],
        ["max_position_impact_bps", V2_BPS],
        ["swap_impact_factor_bps", V2_BPS],
        ["max_swap_impact_bps", V2_BPS - 1n],
    ];
    const impactComponents = new Map();
    for (const [field, limit] of impactLimits) {
        const components = decodeV2ImpactSettingComponents(risk[field]);
        if (components[0] > limit || components[1] > limit)
            throw new Error(`bad ${field}`);
        impactComponents.set(field, components);
    }
    const maxPositionNegative = impactComponents.get("max_position_impact_bps")[1];
    const liquidationEnvelope = risk.liquidation_fee_bps
        + (risk.max_liquidation_impact_bps < maxPositionNegative
            ? risk.max_liquidation_impact_bps
            : maxPositionNegative);
    if (liquidationEnvelope < maxPositionNegative) {
        throw new Error("liquidation fee plus capped impact must cover voluntary close negative impact");
    }
    const maxLiquidationImpact = risk.max_liquidation_impact_bps;
    if (maxPositionNegative > maxLiquidationImpact
        && maxPositionNegative - maxLiquidationImpact >= risk.maintenance_margin_bps) {
        throw new Error("negative impact gap must be below maintenance margin");
    }
}
export function decodeV2ImpactSettingComponents(value) {
    const setting = bigint(value);
    let positive = setting;
    let negative = setting;
    let positiveExponent = 1n;
    let negativeExponent = 1n;
    if (setting >= IMPACT_PACK_FLAG) {
        const body = setting - IMPACT_PACK_FLAG;
        positive = body % IMPACT_PACK_COMPONENT_SCALE;
        negative = (body / IMPACT_PACK_COMPONENT_SCALE) % IMPACT_PACK_COMPONENT_SCALE;
        positiveExponent = (body / IMPACT_PACK_POS_EXP_SCALE) % IMPACT_PACK_EXP_MOD;
        negativeExponent = (body / IMPACT_PACK_NEG_EXP_SCALE) % IMPACT_PACK_EXP_MOD;
        if ((positiveExponent !== 1n && positiveExponent !== 2n)
            || (negativeExponent !== 1n && negativeExponent !== 2n)) {
            throw new Error("bad impact exponent");
        }
    }
    if (positive > negative)
        throw new Error("bad impact factor");
    return [positive, negative, positiveExponent, negativeExponent];
}
export function readV2MarketRisk(input) {
    const missing = [];
    const values = {};
    for (const field of V2_MARKET_RISK_FIELDS) {
        if (input[field] === undefined || input[field] === null) {
            missing.push(field);
            continue;
        }
        try {
            values[field] = bigint(input[field]);
        }
        catch {
            missing.push(field);
        }
    }
    return { ok: missing.length === 0, missing, values };
}
function requiredRiskValue(input, field) {
    const value = input[field];
    if (value === undefined || value === null) {
        throw new Error(`missing V2 market risk field: ${field}`);
    }
    return bigint(value);
}
function bigint(value) {
    if (typeof value === "bigint")
        return value;
    if (typeof value === "number")
        return BigInt(Math.trunc(value));
    if (typeof value === "string")
        return BigInt(value);
    return BigInt(value);
}
//# sourceMappingURL=v2Risk.js.map