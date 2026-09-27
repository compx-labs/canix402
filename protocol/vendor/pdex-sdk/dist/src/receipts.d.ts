export { concat, readUint64, uint64Bytes } from "./codec.js";
export interface Receipt {
    eventVersion: bigint;
    eventType: string;
    eventTypeId: bigint;
    flags: bigint;
    fields: Record<string, bigint | string>;
}
export declare function encodeReceipt(eventType: string | number | bigint, flags: number | bigint, fields: Record<string, number | bigint | string | Uint8Array>, manifest?: import("./manifest.js").ProtocolManifest): Uint8Array;
export declare function decodeReceipt(data: Uint8Array, manifest?: import("./manifest.js").ProtocolManifest): Receipt;
export declare function decodeReceiptFromConfirmation(confirmation: Record<string, unknown>, manifest?: import("./manifest.js").ProtocolManifest): Receipt | undefined;
export declare function decodeReceiptWithOptions(data: Uint8Array, options?: {
    manifest?: any;
    appName?: string;
}): Receipt;
export declare function hasFlag(receipt: Receipt, flagName: string, manifest?: import("./manifest.js").ProtocolManifest): boolean;
//# sourceMappingURL=receipts.d.ts.map