import algosdk, { Algodv2 } from "algosdk";

import { ShapeBuildError } from "../../errors.js";
import type { SerializedTransaction } from "../../types.js";

export async function getAccountAssetBalance(
  algod: Algodv2,
  address: string,
  assetId: number
): Promise<bigint> {
  if (assetId === 0) {
    const account = await algod.accountInformation(address).do();
    return BigInt(account.amount);
  }

  const account = await algod.accountInformation(address).do();
  const holding = account.assets?.find((asset) => Number(asset.assetId) === assetId);
  return holding === undefined ? 0n : BigInt(holding.amount);
}

export async function isAssetOptedIn(
  algod: Algodv2,
  address: string,
  assetId: number
): Promise<boolean> {
  if (assetId === 0) {
    return true;
  }
  const account = await algod.accountInformation(address).do();
  return (account.assets ?? []).some((asset) => Number(asset.assetId) === assetId);
}

export function getApplicationAddress(appId: number): string {
  return algosdk.getApplicationAddress(appId).toString();
}

export function readAppCallSelectorHex(txn: SerializedTransaction | undefined): string | undefined {
  const appCall = txn?.applicationCall;
  if (appCall === undefined || appCall.appArgsBase64.length === 0) {
    return undefined;
  }
  const [firstArg] = appCall.appArgsBase64;
  if (firstArg === undefined) {
    return undefined;
  }
  return Buffer.from(firstArg, "base64").toString("hex");
}

export function assertGroupedTransactions(
  group: readonly SerializedTransaction[],
  errors: string[]
): void {
  if (group.some((txn) => !txn.groupPresent)) {
    errors.push("All transactions must belong to a single atomic group.");
  }
}

export function assignCanonicalGroupID(transactions: algosdk.Transaction[]): void {
  for (const txn of transactions) {
    delete txn.group;
  }
  algosdk.assignGroupID(transactions);
}

export function decodeUnsignedTransactions(encoded: readonly string[]): algosdk.Transaction[] {
  return encoded.map((encodedTxn) => algosdk.decodeUnsignedTransaction(Buffer.from(encodedTxn, "base64")));
}

export function rejectUnexpectedTransactionCount(
  actual: number,
  minimum: number,
  maximum: number
): void {
  if (actual < minimum || actual > maximum) {
    throw new ShapeBuildError("Dork.fi builder returned an unexpected transaction count.", {
      details: { actual, minimum, maximum }
    });
  }
}

export function encodeNote(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function poolAddressString(poolAppId: number): string {
  return algosdk.encodeAddress(algosdk.getApplicationAddress(poolAppId).publicKey);
}
