import { decodeAddress, encodeAddress } from "algosdk";
import { loadManifest } from "./manifest.js";
import { concat, uint64Bytes } from "./codec.js";
import { decodeV2PendingImpactQty, V2_SIGNED_QTY_BIAS } from "./constants.js";
export { decodeV2PendingImpactQty, V2_SIGNED_QTY_BIAS } from "./constants.js";
export const V2_MARKET_CORE_SCHEMA_VERSION = 3n;
export const V2_ORACLE_TO_USD_SCALE = 1000000n;
export const V2_ALLOWED_POSITION_TOKEN_SCALES = Object.freeze(Array.from({ length: 13 }, (_, exponent) => 10n ** BigInt(exponent)));
export function accountBytes(value) {
    if (value instanceof Uint8Array) {
        if (value.byteLength !== 32)
            throw new Error("account bytes must be 32 bytes");
        return value;
    }
    const raw = /^[0-9a-fA-F]{64}$/.test(value)
        ? hexToBytes(value)
        : /^[A-Z2-7]{58}$/.test(value)
            ? decodeAddress(value).publicKey
            : base64ToBytes(value);
    if (raw.byteLength !== 32)
        throw new Error("account string must decode to 32 bytes");
    return new Uint8Array(raw);
}
export function v2MarketCoreBoxKey(marketId) {
    return concat([ascii("m2:"), uint64Bytes(bigint(marketId))]);
}
export function v2MarketRiskBoxKey(marketId) {
    return concat([ascii("mr2:"), uint64Bytes(bigint(marketId))]);
}
export function v2DynamicOiMarginBoxKey(marketId) {
    return concat([ascii("doi:"), uint64Bytes(bigint(marketId))]);
}
export function v2MarketPoolBoxKey(marketId) {
    return concat([ascii("mp2:"), uint64Bytes(bigint(marketId))]);
}
export function v2MarketOpenInterestBoxKey(marketId) {
    return concat([ascii("mo2:"), uint64Bytes(bigint(marketId))]);
}
export function v2MarketFundingBorrowingBoxKey(marketId) {
    return concat([ascii("mf2:"), uint64Bytes(bigint(marketId))]);
}
export function v2MarketAdaptiveFundingBoxKey(marketId) {
    return concat([ascii("ma2:"), uint64Bytes(bigint(marketId))]);
}
export function v2VirtualPositionInventoryBoxKey(indexAssetId) {
    return concat([ascii("vi2:"), uint64Bytes(bigint(indexAssetId))]);
}
export function v2LpBoxKey(owner, marketId) {
    return concat([ascii("ml2:"), uint64Bytes(bigint(marketId)), accountBytes(owner)]);
}
export function v2TraderBoxKey(owner) {
    return concat([ascii("t2:"), accountBytes(owner)]);
}
export function v2PositionBoxKey(owner, marketId, collateralAssetId, side) {
    return concat([
        ascii("p2:"),
        uint64Bytes(bigint(marketId)),
        uint64Bytes(bigint(collateralAssetId)),
        uint64Bytes(bigint(side)),
        accountBytes(owner),
    ]);
}
export function v2OrderBoxKey(owner, orderId) {
    return concat([ascii("o2:"), accountBytes(owner), uint64Bytes(bigint(orderId))]);
}
export function v2CvaUserBoxKey(owner) {
    return concat([ascii("gu2:"), accountBytes(owner)]);
}
export function v2CvaMarketAllocationBoxKey(marketId) {
    return concat([ascii("gm2:"), uint64Bytes(bigint(marketId))]);
}
export function v2YieldStorageKey(marketId, assetId) {
    return concat([uint64Bytes(bigint(marketId)), uint64Bytes(bigint(assetId))]);
}
export function v2MarketYieldBoxKey(marketId, assetId) {
    return concat([ascii("my2:"), v2YieldStorageKey(marketId, assetId)]);
}
export function v2MarketYieldStrategyConfigBoxKey(marketId, assetId) {
    return concat([ascii("yc2:"), v2YieldStorageKey(marketId, assetId)]);
}
export function v2MarketYieldStrategyRuntimeBoxKey(marketId, assetId) {
    return concat([ascii("yr2:"), v2YieldStorageKey(marketId, assetId)]);
}
export function v2MarketXalgoStrategyConfigBoxKey(marketId) {
    return concat([ascii("mxac:"), uint64Bytes(bigint(marketId))]);
}
export function v2MarketXalgoStrategyRuntimeBoxKey(marketId) {
    return concat([ascii("mxar:"), uint64Bytes(bigint(marketId))]);
}
export function parseUint64Struct(data, fields) {
    if (data.byteLength !== fields.length * 8) {
        throw new Error(`struct expects ${fields.length * 8} bytes`);
    }
    const out = {};
    fields.forEach((field, index) => {
        out[field] = new DataView(data.buffer, data.byteOffset + index * 8, 8).getBigUint64(0);
    });
    return out;
}
export function parseTypedStruct(data, fields) {
    const expected = fields.reduce((total, field) => total + Number(field.size ?? ({ address: 32, uint48: 6, uint16: 2 }[field.type ?? "uint64"] ?? 8)), 0);
    if (data.byteLength !== expected)
        throw new Error(`struct expects ${expected} bytes`);
    const out = {};
    let offset = 0;
    for (const field of fields) {
        const fieldType = field.type ?? "uint64";
        const size = Number(field.size ?? ({ address: 32, uint48: 6, uint16: 2 }[fieldType] ?? 8));
        const raw = data.slice(offset, offset + size);
        offset += size;
        if (fieldType === "uint64" || fieldType === "uint48" || fieldType === "uint16") {
            const width = { uint64: 8, uint48: 6, uint16: 2 }[fieldType];
            if (size !== width)
                throw new Error(`${fieldType} field ${field.name} must be ${width} bytes`);
            let value = 0n;
            for (const byte of raw)
                value = (value << 8n) | BigInt(byte);
            out[field.name] = value;
        }
        else if (fieldType === "address") {
            if (size !== 32)
                throw new Error(`address field ${field.name} must be 32 bytes`);
            out[field.name] = encodeAddress(raw);
        }
        else {
            out[field.name] = raw;
        }
    }
    return out;
}
export function parseBoxState(valueType, data, manifest = loadManifest()) {
    let fields = manifest.boxes.structs?.[valueType];
    if (!fields) {
        const format = Object.values(manifest.boxes.formats ?? {}).find((item) => item.value_type === valueType);
        fields = format?.fields;
    }
    if (!fields)
        throw new Error(`unknown box value type: ${valueType}`);
    return parseTypedStruct(data, fields);
}
export function parseV2OrderState(data, manifest = loadManifest(undefined, 2)) {
    return parseV2BoxState("order_state", data, manifest);
}
export function parseV2BoxState(boxFormat, data, manifest = loadManifest(undefined, 2)) {
    let fields = manifest.boxes.formats[boxFormat]?.fields;
    if (!fields)
        throw new Error(`unknown V2 box format: ${boxFormat}`);
    if (boxFormat === "order_state" && data.byteLength === 192 && fields.at(-1)?.name === "position_id") {
        fields = fields.slice(0, -1);
    }
    const parsed = parseTypedStruct(data, fields);
    if (boxFormat === "order_state") {
        const expectedSchema = data.byteLength === 192 ? 3n : data.byteLength === 200 ? 4n : undefined;
        if (expectedSchema === undefined || parsed.schema_version !== expectedSchema)
            throw new Error("order schema/length mismatch");
        if (parsed.position_id !== undefined && parsed.position_id >= 1n << 48n)
            throw new Error("position id out of range");
    }
    return parsed;
}
export function parseV2MarketCoreState(data, manifest) {
    const parsed = parseV2BoxState("market_core", data, manifest ?? loadManifest(undefined, 2));
    if (parsed.schema_version !== V2_MARKET_CORE_SCHEMA_VERSION) {
        throw new Error("unsupported V2 market core schema");
    }
    return {
        ...parsed,
        ...positionScalesFromConversionScale(parsed.position_conversion_scale),
    };
}
export function positionScalesFromConversionScale(positionConversionScale) {
    const conversionScale = strictUint64(positionConversionScale, "position conversion scale");
    if (conversionScale === 0n || conversionScale % V2_ORACLE_TO_USD_SCALE !== 0n) {
        throw new Error("invalid market position conversion scale");
    }
    const tokenScale = conversionScale / V2_ORACLE_TO_USD_SCALE;
    if (!V2_ALLOWED_POSITION_TOKEN_SCALES.includes(tokenScale)) {
        throw new Error("invalid market position token scale");
    }
    return {
        position_token_scale: tokenScale,
        position_conversion_scale: conversionScale,
    };
}
export function readV2MarketPositionScales(market) {
    const value = market.position_conversion_scale ?? market.positionConversionScale;
    if (value === undefined || value === null)
        throw new Error("market position conversion scale is required");
    return positionScalesFromConversionScale(value);
}
export function parseV2MarketRiskState(data, manifest) {
    return parseV2BoxState("market_risk", data, manifest ?? loadManifest(undefined, 2));
}
export function parseV2MarketPoolState(data, manifest) {
    return parseV2BoxState("market_pool", data, manifest ?? loadManifest(undefined, 2));
}
export function parseV2MarketOpenInterestState(data, manifest) {
    return parseV2BoxState("market_open_interest", data, manifest ?? loadManifest(undefined, 2));
}
export function parseV2MarketFundingBorrowingState(data, manifest) {
    return parseV2BoxState("market_funding_borrowing", data, manifest ?? loadManifest(undefined, 2));
}
export function parseV2MarketAdaptiveFundingState(data, manifest) {
    const parsed = parseV2BoxState("market_adaptive_funding", data, manifest ?? loadManifest(undefined, 2));
    if (parsed.schema_version !== 3n) {
        throw new Error("unsupported V2 adaptive funding schema");
    }
    const share = parsed.opposing_trader_share_bps;
    if (share === undefined || share < 0n || share > 10000n) {
        throw new Error("invalid opposing trader share");
    }
    return parsed;
}
export function parseV2LpState(data, manifest) {
    return parseV2BoxState("lp_state", data, manifest ?? loadManifest(undefined, 2));
}
export function parseV2TraderState(data, manifest) {
    return parseV2BoxState("trader_state", data, manifest ?? loadManifest(undefined, 2));
}
export function parseV2PositionState(data, manifest) {
    const parsed = parseV2BoxState("position_state", data, manifest ?? loadManifest(undefined, 2));
    return { ...parsed, ...decodeV2PendingImpactQty(parsed.pending_impact_qty_signed ?? V2_SIGNED_QTY_BIAS) };
}
export function parseV2CvaUserState(data, manifest) {
    return parseV2BoxState("cva_user_state", data, manifest ?? loadManifest(undefined, 2));
}
export function parseV2CvaMarketAllocationState(data, manifest) {
    return parseV2BoxState("cva_market_allocation", data, manifest ?? loadManifest(undefined, 2));
}
export function parseV2MarketYieldState(data, manifest) {
    return parseV2BoxState("market_yield_state", data, manifest ?? loadManifest(undefined, 2));
}
export function parseV2MarketYieldStrategyConfig(data, manifest) {
    return parseV2BoxState("market_yield_strategy_config", data, manifest ?? loadManifest(undefined, 2));
}
export function parseV2MarketYieldStrategyRuntime(data, manifest) {
    return parseV2BoxState("market_yield_strategy_runtime", data, manifest ?? loadManifest(undefined, 2));
}
function ascii(value) {
    return new TextEncoder().encode(value);
}
function hexToBytes(value) {
    if (value.length % 2 !== 0)
        throw new Error("hex string must have even length");
    const out = new Uint8Array(value.length / 2);
    for (let index = 0; index < out.length; index += 1) {
        out[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
    }
    return out;
}
function base64ToBytes(value) {
    const maybeBuffer = globalThis.Buffer;
    if (maybeBuffer)
        return new Uint8Array(maybeBuffer.from(value, "base64"));
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1)
        out[index] = binary.charCodeAt(index);
    return out;
}
function bigint(value) {
    return typeof value === "bigint" ? value : BigInt(value);
}
function strictUint64(value, name) {
    if (typeof value === "number" && !Number.isSafeInteger(value)) {
        throw new TypeError(`${name} number must be a safe integer; use bigint or decimal string`);
    }
    const parsed = BigInt(value);
    if (parsed < 0n || parsed >= 2n ** 64n)
        throw new RangeError(`${name} is outside uint64`);
    return parsed;
}
//# sourceMappingURL=boxes.js.map