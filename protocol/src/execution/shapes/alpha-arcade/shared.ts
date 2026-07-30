import algosdk, {
  Algodv2,
  AtomicTransactionComposer,
  Transaction,
  makeEmptyTransactionSigner
} from "algosdk";

import type { SerializedTransaction } from "../../types.js";

export async function getSuggestedParams(algod: Algodv2): Promise<algosdk.SuggestedParams> {
  return algod.getTransactionParams().do();
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

export async function isAppOptedIn(
  algod: Algodv2,
  address: string,
  appId: number
): Promise<boolean> {
  const account = await algod.accountInformation(address).do();
  return (account.appsLocalState ?? []).some((entry) => Number(entry.id) === appId);
}

export async function getAccountAssetBalance(
  algod: Algodv2,
  address: string,
  assetId: number
): Promise<bigint> {
  const account = await algod.accountInformation(address).do();
  if (assetId === 0) {
    return BigInt(account.amount);
  }
  const holding = account.assets?.find((asset) => Number(asset.assetId) === assetId);
  return holding === undefined ? 0n : BigInt(holding.amount);
}

export function getApplicationAddress(appId: number): string {
  return algosdk.getApplicationAddress(appId).toString();
}

/**
 * Build unsigned transactions from an ATC. Alpha Arcade staking groups use
 * explicit flat fees and no boxes, so algokit resource population is unused.
 */
export function buildComposerGroup(atc: AtomicTransactionComposer): Transaction[] {
  return atc.buildGroup().map((txnWithSigner) => txnWithSigner.txn);
}

export function addAssetOptInToComposer(params: {
  atc: AtomicTransactionComposer;
  sender: string;
  assetId: number;
  suggestedParams: algosdk.SuggestedParams;
}): void {
  const optInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: params.sender,
    receiver: params.sender,
    assetIndex: params.assetId,
    amount: 0n,
    suggestedParams: params.suggestedParams
  });
  params.atc.addTransaction({
    txn: optInTxn,
    signer: makeEmptyTransactionSigner()
  });
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
  if (group.length > 1 && group.some((txn) => !txn.groupPresent)) {
    errors.push("All transactions must belong to a single atomic group.");
  }
}

export function createExecutionAlgodClient(): Algodv2 {
  const server = process.env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud";
  const token = process.env.X402_ALGOD_TOKEN ?? "";
  return new algosdk.Algodv2(token, trimTrailingSlash(server), "");
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
