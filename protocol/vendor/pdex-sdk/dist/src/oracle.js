import * as ed25519 from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { readUint64 } from "./codec.js";
ed25519.hashes.sha512 = sha512;
export const V2_ORACLE_MAGIC = new TextEncoder().encode("PDX2");
export const ORACLE_PRICE_SCALE = 1000000000000n;
export const MAX_ORACLE_PRICE = 1000000000000000000n;
export const V2_ORACLE_MESSAGE_VERSION = 3;
export const V2_ORACLE_MESSAGE_SIZE = 133;
export function verifyOraclePayload(message, signature, pubkey) {
    return ed25519.verify(signature, message, pubkey);
}
export function parsePrice12(value) {
    if (typeof value !== "string")
        throw new TypeError("Price12 human values must be decimal strings");
    const match = /^\+?(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(value.trim());
    if (!match)
        throw new Error("invalid Price12 decimal");
    const integerDigits = match[1];
    const fractionalDigits = match[2] ?? "";
    const exponent = Number.parseInt(match[3] ?? "0", 10);
    if (!Number.isSafeInteger(exponent))
        throw new Error("invalid Price12 exponent");
    const digits = `${integerDigits}${fractionalDigits}`.replace(/^0+(?=\d)/, "") || "0";
    const scaledExponent = exponent - fractionalDigits.length + 12;
    let raw;
    if (scaledExponent >= 0) {
        if (digits !== "0" && digits.length + scaledExponent > 19) {
            throw new Error("Price12 exceeds protocol price ceiling");
        }
        raw = BigInt(digits) * 10n ** BigInt(scaledExponent);
    }
    else {
        if (digits === "0")
            return 0n;
        if (-scaledExponent > digits.length) {
            throw new Error("Price12 decimal exceeds 12 decimal places");
        }
        const divisor = 10n ** BigInt(-scaledExponent);
        const unscaled = BigInt(digits);
        if (unscaled % divisor !== 0n)
            throw new Error("Price12 decimal exceeds 12 decimal places");
        raw = unscaled / divisor;
    }
    if (raw > MAX_ORACLE_PRICE)
        throw new Error("Price12 exceeds protocol price ceiling");
    return raw;
}
export function formatPrice12(value) {
    const raw = validateRawPrice12(value, { allowZero: true });
    const whole = raw / ORACLE_PRICE_SCALE;
    const fraction = raw % ORACLE_PRICE_SCALE;
    if (fraction === 0n)
        return whole.toString();
    return `${whole}.${fraction.toString().padStart(12, "0").replace(/0+$/, "")}`;
}
export function validateRawPrice12(value, options = {}) {
    if (typeof value === "number" && !Number.isSafeInteger(value)) {
        throw new TypeError("raw Price12 number must be a safe integer; use bigint or decimal string");
    }
    const raw = BigInt(value);
    if (raw < 0n || (raw === 0n && !options.allowZero))
        throw new Error("raw Price12 must be positive");
    if (raw > MAX_ORACLE_PRICE)
        throw new Error("raw Price12 exceeds protocol price ceiling");
    return raw;
}
export function decodeV2OracleSnapshotMessage(message) {
    if (message.byteLength !== V2_ORACLE_MESSAGE_SIZE)
        throw new Error("V2 oracle message must be 133 bytes");
    let cursor = 0;
    const take = (size) => {
        const value = message.slice(cursor, cursor + size);
        cursor += size;
        return value;
    };
    const takeUint64 = () => {
        const value = readUint64(message, cursor);
        cursor += 8;
        return value;
    };
    const magic = take(4);
    const messageVersion = take(1)[0];
    if (new TextDecoder().decode(magic) !== "PDX2")
        throw new Error("bad V2 oracle magic");
    if (messageVersion !== V2_ORACLE_MESSAGE_VERSION)
        throw new Error("bad V2 oracle version");
    return {
        magic,
        messageVersion,
        genesisHash: take(32),
        targetAppId: takeUint64(),
        marketId: takeUint64(),
        indexAssetId: takeUint64(),
        longAssetId: takeUint64(),
        shortAssetId: takeUint64(),
        indexMinPrice: takeUint64(),
        indexMaxPrice: takeUint64(),
        longMinPrice: takeUint64(),
        longMaxPrice: takeUint64(),
        shortMinPrice: takeUint64(),
        shortMaxPrice: takeUint64(),
        publishedAt: takeUint64(),
    };
}
export function oraclePayloadFromBackend(payload) {
    return {
        message: hexToBytes(payload.message_hex),
        signature: hexToBytes(payload.signature_hex),
        pubkey: payload.pubkey_hex ? hexToBytes(payload.pubkey_hex) : new Uint8Array(),
        timestamp: optionalNumber(payload.timestamp),
        maxAgeSeconds: optionalNumber(payload.max_age_seconds),
        maxFutureSkewSeconds: optionalNumber(payload.max_future_skew_seconds),
        validFromTimestamp: optionalNumber(payload.valid_from_timestamp),
        validUntilTimestamp: optionalNumber(payload.valid_until_timestamp),
    };
}
function optionalNumber(value) {
    if (value === undefined || value === "")
        return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
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
//# sourceMappingURL=oracle.js.map