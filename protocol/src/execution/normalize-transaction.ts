import algosdk, { Transaction } from "algosdk";

/**
 * Re-encode a transaction through the local algosdk instance so downstream code
 * (validation, signing helpers) sees consistent class prototypes. Required when
 * wrapping SDKs that bundle their own algosdk copy (e.g. @folks-finance/algorand-sdk
 * or @pactfi/pactsdk).
 */
export function normalizeTransaction(txn: Transaction): Transaction {
  try {
    return algosdk.decodeUnsignedTransaction(algosdk.encodeUnsignedTransaction(txn));
  } catch (error) {
    const legacyBytes = encodeLegacyTransaction(txn);
    if (legacyBytes !== undefined) {
      return algosdk.decodeUnsignedTransaction(legacyBytes);
    }
    throw error;
  }
}

export function normalizeTransactions(txns: readonly Transaction[]): Transaction[] {
  return txns.map((txn) => normalizeTransaction(txn));
}

function encodeLegacyTransaction(txn: Transaction): Uint8Array | undefined {
  const candidate = txn as Transaction & { toByte?: unknown };
  if (typeof candidate.toByte !== "function") {
    return undefined;
  }
  const bytes = candidate.toByte();
  return bytes instanceof Uint8Array ? bytes : undefined;
}
