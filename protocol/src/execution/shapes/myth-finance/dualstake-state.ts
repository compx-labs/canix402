import algosdk, { Algodv2, Transaction } from "algosdk";
import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import { DualStake } from "@myth-finance/dualstake-ts-sdk";

import { InvalidShapeInputError } from "../../errors.js";
import type { ExecutionNetwork } from "../../types.js";
import {
  MYTH_ARC59_ROUTER_APP_ID,
  MYTH_DS_REGISTRY_APP_ID,
  MYTH_SIMULATE_SENDER,
  MYTH_TINYMAN_APP_ID
} from "../../../adapters/mythFinance.js";

export const MYTH_RATE_PRECISION = 10_000_000_000n;

export interface MythDualStakeState {
  network: ExecutionNetwork;
  appId: number;
  appAddress: string;
  asaId: number;
  lstId: number;
  lstName: string;
  asaUnitName: string;
  rate: bigint;
  staked: bigint;
  isOnline: boolean;
  tinymanAppId: bigint;
  lpId: string;
  userAlgoBalance: bigint;
  userAsaBalance: bigint;
  userLstBalance: bigint;
  needsLstOptIn: boolean;
  needsAsaOptIn: boolean;
  platformFeeBps: number;
  noderunnerFeeBps: number;
}

export function parseMythAddress(value: unknown, fieldName = "userAddress"): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidShapeInputError(`${fieldName} must be a non-empty string.`);
  }
  const address = value.trim();
  if (!algosdk.isValidAddress(address)) {
    throw new InvalidShapeInputError(`${fieldName} must be a valid Algorand address.`);
  }
  return address;
}

export function parseMythAmount(value: unknown, fieldName = "amount"): bigint {
  if (typeof value === "bigint") {
    if (value <= 0n) {
      throw new InvalidShapeInputError(`${fieldName} must be a positive integer.`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value <= 0) {
      throw new InvalidShapeInputError(`${fieldName} must be a positive integer.`);
    }
    return BigInt(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    try {
      const parsed = BigInt(value.trim());
      if (parsed <= 0n) {
        throw new InvalidShapeInputError(`${fieldName} must be a positive integer.`);
      }
      return parsed;
    } catch {
      throw new InvalidShapeInputError(`${fieldName} must be a positive integer.`);
    }
  }
  throw new InvalidShapeInputError(`${fieldName} must be a positive integer.`);
}

export function parseMythAppId(value: unknown): number {
  const amount = parseMythAmount(value, "appId");
  const asNumber = Number(amount);
  if (!Number.isSafeInteger(asNumber) || asNumber < 1) {
    throw new InvalidShapeInputError("appId must be a positive application id.");
  }
  return asNumber;
}

export function addressToString(value: string | { toString(): string }): string {
  return typeof value === "string" ? value : value.toString();
}

export function expectedAsaForMint(algoAmount: bigint, rate: bigint): bigint {
  if (rate <= 0n) {
    return 0n;
  }
  return (algoAmount * rate) / MYTH_RATE_PRECISION + 1n;
}

export async function isAssetOptedIn(
  algod: Algodv2,
  address: string,
  assetId: number
): Promise<boolean> {
  if (assetId === 0) {
    return true;
  }
  const info = await algod.accountInformation(address).do();
  const assets = info.assets ?? [];
  return assets.some((asset) => Number(asset.assetId) === assetId);
}

export async function resolveMythDualStakeState(input: {
  network: ExecutionNetwork;
  algod: Algodv2;
  userAddress: string;
  appId: number;
}): Promise<MythDualStakeState> {
  const { network, algod, userAddress, appId } = input;
  if (network !== "mainnet") {
    throw new InvalidShapeInputError("Myth Finance shapes currently support mainnet only.");
  }

  const algorand = AlgorandClient.fromClients({ algod });
  const config = {
    algorand,
    network: "mainnet",
    dsRegistryAppId: readBigIntEnv("MYTH_DS_REGISTRY_APP_ID", MYTH_DS_REGISTRY_APP_ID),
    tinymanAppId: MYTH_TINYMAN_APP_ID,
    arc59RouterAppId: MYTH_ARC59_ROUTER_APP_ID,
    sender: userAddress,
    appId: BigInt(appId)
  };

  const client = DualStake.getContractAppClient(config);
  const state = await client.getState();
  const account = await algod.accountInformation(userAddress).do();
  const assets = account.assets ?? [];

  const asaId = Number(state.asaId);
  const lstId = Number(state.lstId);
  const userAsaBalance = assetBalance(assets, asaId);
  const userLstBalance = assetBalance(assets, lstId);
  const needsLstOptIn = !assets.some((asset) => Number(asset.assetId) === lstId);
  const needsAsaOptIn = !assets.some((asset) => Number(asset.assetId) === asaId);

  return {
    network,
    appId,
    appAddress: addressToString(client.appAddr),
    asaId,
    lstId,
    lstName: state.lstName,
    asaUnitName: state.asaUnitName || state.asaName,
    rate: state.rate,
    staked: state.staked,
    isOnline: state.isOnline,
    tinymanAppId: BigInt(state.tinymanAppId),
    lpId: state.lpId,
    userAlgoBalance: BigInt(account.amount ?? 0),
    userAsaBalance,
    userLstBalance,
    needsLstOptIn,
    needsAsaOptIn,
    platformFeeBps: Number(state.platformFeeBps),
    noderunnerFeeBps: Number(state.noderunnerFeeBps)
  };
}

function assetBalance(
  assets: ReadonlyArray<{ assetId?: number | bigint; amount?: number | bigint }>,
  assetId: number
): bigint {
  for (const asset of assets) {
    const id = Number(asset.assetId);
    if (id === assetId) {
      return BigInt(asset.amount ?? 0);
    }
  }
  return 0n;
}

/**
 * Build unsigned mint group with algosdk v3 field names.
 * Group: optional LST opt-in, mint app call, ALGO payment, paired ASA transfer.
 */
export async function buildMythMintTransactions(input: {
  algod: Algodv2;
  userAddress: string;
  appId: number;
  algoAmount: bigint;
  state: MythDualStakeState;
}): Promise<Transaction[]> {
  const { algod, userAddress, appId, algoAmount, state } = input;
  const algorand = AlgorandClient.fromClients({ algod });
  const client = DualStake.getContractAppClient({
    algorand,
    network: "mainnet",
    dsRegistryAppId: readBigIntEnv("MYTH_DS_REGISTRY_APP_ID", MYTH_DS_REGISTRY_APP_ID),
    tinymanAppId: MYTH_TINYMAN_APP_ID,
    arc59RouterAppId: MYTH_ARC59_ROUTER_APP_ID,
    sender: userAddress,
    appId: BigInt(appId)
  });

  const suggestedParams = await algod.getTransactionParams().do();
  const txns: Transaction[] = [];

  if (state.needsLstOptIn) {
    txns.push(
      algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: userAddress,
        receiver: userAddress,
        assetIndex: state.lstId,
        amount: 0,
        suggestedParams
      })
    );
  }

  const { transactions: mintAppTxns } = await client.client.createTransaction.mint({
    args: {},
    appReferences: [state.tinymanAppId],
    assetReferences: [BigInt(state.asaId), BigInt(state.lstId)],
    accountReferences: [state.lpId],
    staticFee: (2000).microAlgos(),
    sender: userAddress
  });
  const mintAppTxn = mintAppTxns[0];
  if (mintAppTxn === undefined) {
    throw new Error("Myth mint app call was not produced.");
  }
  txns.push(mintAppTxn);

  txns.push(
    algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: userAddress,
      receiver: state.appAddress,
      amount: algoAmount,
      suggestedParams
    })
  );

  const asaAmount = expectedAsaForMint(algoAmount, state.rate);
  if (asaAmount > 0n) {
    txns.push(
      algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: userAddress,
        receiver: state.appAddress,
        assetIndex: state.asaId,
        amount: asaAmount,
        suggestedParams
      })
    );
  }

  return algosdk.assignGroupID(txns);
}

/**
 * Build unsigned redeem group with algosdk v3 field names.
 * Group: optional ASA opt-in, LST transfer, redeem app call.
 */
export async function buildMythRedeemTransactions(input: {
  algod: Algodv2;
  userAddress: string;
  appId: number;
  lstAmount: bigint;
  state: MythDualStakeState;
}): Promise<Transaction[]> {
  const { algod, userAddress, appId, lstAmount, state } = input;
  const algorand = AlgorandClient.fromClients({ algod });
  const client = DualStake.getContractAppClient({
    algorand,
    network: "mainnet",
    dsRegistryAppId: readBigIntEnv("MYTH_DS_REGISTRY_APP_ID", MYTH_DS_REGISTRY_APP_ID),
    tinymanAppId: MYTH_TINYMAN_APP_ID,
    arc59RouterAppId: MYTH_ARC59_ROUTER_APP_ID,
    sender: userAddress,
    appId: BigInt(appId)
  });

  const suggestedParams = await algod.getTransactionParams().do();
  const txns: Transaction[] = [];

  if (state.needsAsaOptIn) {
    txns.push(
      algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: userAddress,
        receiver: userAddress,
        assetIndex: state.asaId,
        amount: 0,
        suggestedParams
      })
    );
  }

  txns.push(
    algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: userAddress,
      receiver: state.appAddress,
      assetIndex: state.lstId,
      amount: lstAmount,
      suggestedParams
    })
  );

  const { transactions: redeemAppTxns } = await client.client.createTransaction.redeem({
    args: {},
    appReferences: [state.tinymanAppId],
    assetReferences: [BigInt(state.asaId), BigInt(state.lstId)],
    accountReferences: [state.lpId],
    staticFee: (3000).microAlgos(),
    sender: userAddress
  });
  const redeemAppTxn = redeemAppTxns[0];
  if (redeemAppTxn === undefined) {
    throw new Error("Myth redeem app call was not produced.");
  }
  txns.push(redeemAppTxn);

  return algosdk.assignGroupID(txns);
}

function readBigIntEnv(name: string, fallback: bigint): bigint {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  try {
    return BigInt(raw);
  } catch {
    return fallback;
  }
}

// Keep simulate sender available for any future read-only clients.
void MYTH_SIMULATE_SENDER;
