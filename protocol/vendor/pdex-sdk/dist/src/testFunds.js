import { decodeAddress, makeAssetTransferTxnWithSuggestedParamsFromObject, makePaymentTxnWithSuggestedParamsFromObject, } from "algosdk";
export const TEST_FUNDS_RETURN_NOTE = "pex-test-funds-return-v1";
export function buildTestFundsAssetOptInTransaction(input) {
    decodeAddress(input.sender);
    const assetId = parsePositiveUint(input.assetId, "assetId");
    if (assetId > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("assetId exceeds the JavaScript safe-integer range");
    }
    return makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: input.sender,
        receiver: input.sender,
        amount: 0n,
        assetIndex: Number(assetId),
        suggestedParams: { ...input.suggestedParams },
    });
}
export function buildTestFundsAlgoReturnTransaction(input) {
    decodeAddress(input.sender);
    decodeAddress(input.receiver);
    if (input.sender === input.receiver) {
        throw new Error("test funds return sender and receiver must be different");
    }
    const amount = parsePositiveUint(input.amount, "amount");
    return makePaymentTxnWithSuggestedParamsFromObject({
        sender: input.sender,
        receiver: input.receiver,
        amount,
        note: new TextEncoder().encode(TEST_FUNDS_RETURN_NOTE),
        suggestedParams: { ...input.suggestedParams },
    });
}
function parsePositiveUint(value, field) {
    if (typeof value === "number" && !Number.isSafeInteger(value)) {
        throw new Error(`${field} number input must be a safe integer`);
    }
    let parsed;
    try {
        parsed = BigInt(value);
    }
    catch {
        throw new Error(`${field} must be an integer`);
    }
    if (parsed <= 0n || parsed > 0xffffffffffffffffn) {
        throw new Error(`${field} must be a positive uint64`);
    }
    return parsed;
}
//# sourceMappingURL=testFunds.js.map