import algosdk, {
  Algodv2,
  AtomicTransactionComposer,
  Transaction,
  makeEmptyTransactionSigner
} from "algosdk";
import { prepareGroupForSending } from "@algorandfoundation/algokit-utils";
import { AlgoAmount } from "@algorandfoundation/algokit-utils/types/amount";

import { ShapeBuildError } from "../../errors.js";
import type { SerializedBoxReference, SerializedTransaction } from "../../types.js";
import { DEFAULT_HAYSTACK_APP_CALL_MAX_FEE } from "./constants.js";

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

export interface StakerBoxRecord {
  hasBox: boolean;
  /** Current staked HAY balance (base units). Zero when the box is absent. */
  stake: bigint;
  /** Pending USDC rewards stored in the box (may lag live accrual). */
  pendingRewardsUsdc: bigint;
  /** Pending HAY rewards stored in the box (may lag live accrual). */
  pendingRewardsHay: bigint;
}

/**
 * Read the caller's `userStake` box directly from algod. The box name is the
 * raw 32-byte address; the value is the ARC-56 `UserData` struct:
 * stake (u64) | pendingUsdc (u64) | debtUsdc (u128) | pendingHay (u64) | debtHay (u128).
 * Returns `hasBox: false` on a 404.
 */
export async function getStakerBoxRecord(
  algod: Algodv2,
  appId: number,
  boxName: Uint8Array
): Promise<StakerBoxRecord> {
  try {
    const box = await algod.getApplicationBoxByName(appId, boxName).do();
    const value = box.value;
    const stake = value.length >= 8 ? decodeUint64BE(value.subarray(0, 8)) : 0n;
    const pendingRewardsUsdc =
      value.length >= 16 ? decodeUint64BE(value.subarray(8, 16)) : 0n;
    const pendingRewardsHay =
      value.length >= 40 ? decodeUint64BE(value.subarray(32, 40)) : 0n;
    return { hasBox: true, stake, pendingRewardsUsdc, pendingRewardsHay };
  } catch (error) {
    if (isBoxNotFoundError(error)) {
      return {
        hasBox: false,
        stake: 0n,
        pendingRewardsUsdc: 0n,
        pendingRewardsHay: 0n
      };
    }
    throw new ShapeBuildError("Failed to read Haystack staker box.", {
      details: { appId },
      cause: error
    });
  }
}

function decodeUint64BE(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
}

function isBoxNotFoundError(error: unknown): boolean {
  const status = (error as { status?: number; statusCode?: number } | undefined) ?? undefined;
  if (status?.status === 404 || status?.statusCode === 404) {
    return true;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("box not found") || message.includes("no application box");
}

export interface FinalizeComposerGroupParams {
  algod: Algodv2;
  atc: AtomicTransactionComposer;
  appCallMaxFee?: bigint;
}

/**
 * Finalize an ATC group using algokit-utils: populate app-call resources (box
 * references, foreign assets/apps, accounts) and cover inner-transaction fees so
 * the flat outer fee accounts for oracle/reward inner transactions.
 */
export async function finalizeComposerGroup(params: FinalizeComposerGroupParams): Promise<Transaction[]> {
  const { algod, atc, appCallMaxFee = DEFAULT_HAYSTACK_APP_CALL_MAX_FEE } = params;

  const built = atc.buildGroup();
  const maxFees = new Map<number, AlgoAmount>();
  built.forEach((txnWithSigner, index) => {
    if (txnWithSigner.txn.type === algosdk.TransactionType.appl) {
      maxFees.set(index, AlgoAmount.MicroAlgos(Number(appCallMaxFee)));
    }
  });

  let suggestedParams: algosdk.SuggestedParams;
  try {
    suggestedParams = await algod.getTransactionParams().do();
  } catch (error) {
    throw new ShapeBuildError("Failed to fetch suggested params for Haystack staking group.", {
      cause: error
    });
  }

  try {
    const prepared = await prepareGroupForSending(
      atc,
      algod,
      {
        populateAppCallResources: true,
        coverAppCallInnerTransactionFees: true,
        suppressLog: true
      },
      {
        maxFees,
        suggestedParams: {
          fee: suggestedParams.fee,
          minFee: suggestedParams.minFee
        }
      }
    );
    return prepared.buildGroup().map((txnWithSigner) => txnWithSigner.txn);
  } catch (error) {
    const rootCause = extractErrorMessage(error);
    throw new ShapeBuildError("Failed to finalize Haystack staking transaction group.", {
      details: rootCause === undefined ? undefined : { rootCause },
      cause: error
    });
  }
}

function extractErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.length > 0) {
    return error;
  }
  return undefined;
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

export interface StakingBoxReference {
  appIndex: number;
  name: Uint8Array;
}

export function stakingBoxReference(appId: number, boxName: Uint8Array): StakingBoxReference {
  return { appIndex: appId, name: boxName };
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

export function hasStakerBoxReference(params: {
  boxes: readonly SerializedBoxReference[];
  appId: number;
  stakerBoxNameBase64: string;
}): boolean {
  return params.boxes.some(
    (box) =>
      (box.appIndex === String(params.appId) || box.appIndex === "0") &&
      box.nameBase64 === params.stakerBoxNameBase64
  );
}

export function createExecutionAlgodClient(): Algodv2 {
  const server = process.env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud";
  const token = process.env.X402_ALGOD_TOKEN ?? "";
  return new algosdk.Algodv2(token, trimTrailingSlash(server), "");
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
