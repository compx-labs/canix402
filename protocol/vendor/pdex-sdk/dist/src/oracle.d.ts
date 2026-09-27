export declare const V2_ORACLE_MAGIC: Uint8Array<ArrayBuffer>;
export declare const ORACLE_PRICE_SCALE = 1000000000000n;
export declare const MAX_ORACLE_PRICE = 1000000000000000000n;
export declare const V2_ORACLE_MESSAGE_VERSION = 3;
export declare const V2_ORACLE_MESSAGE_SIZE = 133;
export type RawPrice12 = number | bigint | string;
export interface OraclePayload {
    message: Uint8Array;
    signature: Uint8Array;
    pubkey: Uint8Array;
    timestamp?: number;
    maxAgeSeconds?: number;
    maxFutureSkewSeconds?: number;
    validFromTimestamp?: number;
    validUntilTimestamp?: number;
}
export interface OracleMessageV3 {
    /** Domain separator identifying a PDex V2 signed oracle message. */
    magic: Uint8Array;
    /** Wire-format version governing the meaning and order of every later field. */
    messageVersion: number;
    /** Algorand genesis hash binding the signed message to one network. */
    genesisHash: Uint8Array;
    /** Application id whose call may consume this signed message. */
    targetAppId: bigint;
    /** Market id whose prices and asset identities follow. */
    marketId: bigint;
    /** Asset id of the market index, or zero for a non-ASA index. */
    indexAssetId: bigint;
    /** Asset id of the market's long-side backing token. */
    longAssetId: bigint;
    /** Asset id of the market's short-side backing token. */
    shortAssetId: bigint;
    /** Conservative lower Price12 bound for the index asset. */
    indexMinPrice: bigint;
    /** Conservative upper Price12 bound for the index asset. */
    indexMaxPrice: bigint;
    /** Conservative lower Price12 bound for the long backing asset. */
    longMinPrice: bigint;
    /** Conservative upper Price12 bound for the long backing asset. */
    longMaxPrice: bigint;
    /** Conservative lower Price12 bound for the short backing asset. */
    shortMinPrice: bigint;
    /** Conservative upper Price12 bound for the short backing asset. */
    shortMaxPrice: bigint;
    /** Unix timestamp at which the signed price snapshot was published. */
    publishedAt: bigint;
}
export declare function verifyOraclePayload(message: Uint8Array, signature: Uint8Array, pubkey: Uint8Array): boolean;
export declare function parsePrice12(value: string): bigint;
export declare function formatPrice12(value: RawPrice12): string;
export declare function validateRawPrice12(value: RawPrice12, options?: {
    allowZero?: boolean;
}): bigint;
export declare function decodeV2OracleSnapshotMessage(message: Uint8Array): OracleMessageV3;
export declare function oraclePayloadFromBackend(payload: {
    message_hex: string;
    signature_hex: string;
    pubkey_hex?: string;
    timestamp?: number | string;
    max_age_seconds?: number | string;
    max_future_skew_seconds?: number | string;
    valid_from_timestamp?: number | string;
    valid_until_timestamp?: number | string;
}): OraclePayload;
//# sourceMappingURL=oracle.d.ts.map