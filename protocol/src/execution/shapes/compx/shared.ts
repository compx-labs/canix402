import algosdk, { Algodv2, Transaction } from "algosdk";
import { DEFAULT_APP_CALL_MAX_FEE } from "@compx/sdk";

import { ShapeBuildError } from "../../errors.js";
import type { SerializedTransaction, SerializedBoxReference } from "../../types.js";

export const MIN_ALGO_FEE = 1000n;
export const COMPX_LENDING_APP_CALL_MIN_FEE = 2n * MIN_ALGO_FEE;
export const DEFAULT_COMPX_APP_CALL_MAX_FEE = BigInt(DEFAULT_APP_CALL_MAX_FEE);

export interface LendingTransactionBundle {
  transactions: Transaction[];
  signers: Array<{ address: string; transactionIndexes: number[] }>;
  metadata: Record<string, unknown>;
}

export async function getSuggestedParams(algod: Algodv2): Promise<algosdk.SuggestedParams> {
  return algod.getTransactionParams().do();
}

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

export function validateSingleUserSigners(params: {
  userAddress: string;
  signers: LendingTransactionBundle["signers"];
  transactionCount: number;
  errors: string[];
}): void {
  const { userAddress, signers, transactionCount, errors } = params;

  if (signers.length !== 1) {
    errors.push(`Expected exactly one signer entry, received ${signers.length}.`);
    return;
  }

  const [signer] = signers;
  if (signer === undefined) {
    errors.push("Signer metadata must include the user address.");
    return;
  }
  if (signer.address !== userAddress) {
    errors.push("Signer metadata address must match the user address.");
  }
  const expectedIndexes = [...Array(transactionCount).keys()];
  const actualIndexes = [...signer.transactionIndexes].sort((a, b) => a - b);
  if (
    actualIndexes.length !== expectedIndexes.length ||
    !actualIndexes.every((index, position) => index === expectedIndexes[position])
  ) {
    errors.push("Signer metadata must cover every transaction index exactly once.");
  }
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

export function assertGroupedTransactions(group: readonly SerializedTransaction[], errors: string[]): void {
  if (group.some((txn) => !txn.groupPresent)) {
    errors.push("All transactions must belong to a single atomic group.");
  }
}

export function hasStakerBoxReference(params: {
  boxes: readonly SerializedBoxReference[];
  poolAppId: number;
  stakerBoxNameBase64: string;
}): boolean {
  return params.boxes.some(
    (box) =>
      (box.appIndex === String(params.poolAppId) || box.appIndex === "0") &&
      box.nameBase64 === params.stakerBoxNameBase64
  );
}

export function rejectUnexpectedSignerMetadata(
  signers: LendingTransactionBundle["signers"],
  userAddress: string
): void {
  if (signers.length !== 1) {
    throw new ShapeBuildError("CompX SDK returned unexpected signer metadata.", {
      details: { signers, userAddress }
    });
  }
  const [signer] = signers;
  if (signer === undefined || signer.address !== userAddress) {
    throw new ShapeBuildError("CompX SDK signer metadata must reference only the user address.", {
      details: { signers, userAddress }
    });
  }
}
