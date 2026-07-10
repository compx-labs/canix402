import algosdk, { Transaction } from "algosdk";

/**
 * Re-encode a transaction through the local algosdk instance so downstream code
 * (validation, signing helpers) sees consistent class prototypes. Required when
 * wrapping SDKs that bundle their own algosdk copy (e.g. @folks-finance/algorand-sdk).
 */
export function normalizeTransaction(txn: Transaction): Transaction {
  return algosdk.decodeUnsignedTransaction(algosdk.encodeUnsignedTransaction(txn));
}

export function normalizeTransactions(txns: readonly Transaction[]): Transaction[] {
  return txns.map((txn) => normalizeTransaction(txn));
}
