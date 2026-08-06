import { createRequire } from "node:module";
import algosdk, { Algodv2, Transaction } from "algosdk";
import { DEFAULT_APP_CALL_MAX_FEE } from "@compx/sdk";

import { ShapeBuildError } from "../../errors.js";
import type { SerializedTransaction, SerializedBoxReference } from "../../types.js";

export const MIN_ALGO_FEE = 1000n;
export const COMPX_LENDING_APP_CALL_MIN_FEE = 2n * MIN_ALGO_FEE;
export const DEFAULT_COMPX_APP_CALL_MAX_FEE = BigInt(DEFAULT_APP_CALL_MAX_FEE);

const require = createRequire(import.meta.url);
const commonJsAlgodSdk = require("algosdk") as typeof import("algosdk");

export interface LendingTransactionBundle {
  transactions: Transaction[];
  signers: Array<{ address: string; transactionIndexes: number[] }>;
  metadata: Record<string, unknown>;
}

/**
 * Floor application-call fees to COMPX_LENDING_APP_CALL_MIN_FEE.
 *
 * `@compx/sdk` finalizeGroup uses algokit coverAppCallInnerTransactionFees, so
 * the actual fee is minFee × (1 + inners) capped by appCallMaxFee. Partial repay
 * (no collateral release) can land at 1000 µAlgos, which fails Canix's ≥2000
 * lending-shape validation. Slight overpay is safe.
 *
 * Re-assigns the atomic group id when any fee is bumped, since fee is part of
 * the group commitment. Existing group fields must be cleared first — algosdk
 * assignGroupID can otherwise hash stale group bytes into the new id.
 */
export function ensureCompXLendingAppCallMinFees(
  transactions: Transaction[]
): Transaction[] {
  let bumped = false;
  for (const txn of transactions) {
    if (
      txn.type === algosdk.TransactionType.appl &&
      BigInt(txn.fee) < COMPX_LENDING_APP_CALL_MIN_FEE
    ) {
      txn.fee = COMPX_LENDING_APP_CALL_MIN_FEE;
      bumped = true;
    }
  }
  if (bumped && transactions.length > 1) {
    for (const txn of transactions) {
      delete txn.group;
    }
    algosdk.assignGroupID(transactions);
  }
  return transactions;
}

export async function getSuggestedParams(algod: Algodv2): Promise<algosdk.SuggestedParams> {
  return algod.getTransactionParams().do();
}

/**
 * @compx/sdk is currently published through its CommonJS entry point. Its
 * transaction builders must receive an Algod client created by that same
 * CommonJS algosdk instance; mixing it with this package's ESM algosdk client
 * creates incompatible Address values during transaction group encoding.
 */
export function createCompXBuilderAlgodClient(): Algodv2 {
  const server = process.env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud";
  const token = process.env.X402_ALGOD_TOKEN ?? "";
  return new commonJsAlgodSdk.Algodv2(token, trimTrailingSlash(server), "") as unknown as Algodv2;
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

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
