import algosdk, { Algodv2 } from "algosdk";
import { poolUtils } from "@tinymanorg/tinyman-js-sdk";

import { resolvePactPoolState } from "../../src/execution/shapes/pact/index.js";

export const USDC_ASSET_ID = 31566704;
export const ALGO_ASSET_ID = 0;

export interface BalancedAddAmounts {
  assetAId: number;
  assetAAmount: bigint;
  assetBId: number;
  assetBAmount: bigint;
}

export interface TinymanPoolContext {
  poolTokenId: number;
  asset1Id: number;
  asset2Id: number;
}

export interface PactPoolContext {
  poolAppId: number;
  poolTokenId: number;
  primaryAssetId: number;
  secondaryAssetId: number;
}

interface PactPoolApiAsset {
  on_chain_id?: number | string | null;
}

interface PactPoolApiRecord {
  on_chain_id?: number | string | null;
  primary_asset?: PactPoolApiAsset | null;
  secondary_asset?: PactPoolApiAsset | null;
  pool_asset?: PactPoolApiAsset | null;
  is_deprecated?: boolean | null;
  is_verified?: boolean | null;
  tvl_usd?: number | string | null;
}

interface PactPoolsApiResponse {
  results?: PactPoolApiRecord[];
}

export interface SubmitTransactionGroupResult {
  txId: string;
  groupId: string;
  confirmedRound: bigint;
}

export function createAlgodClientFromEnv(): Algodv2 {
  const server = process.env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud";
  const token = process.env.X402_ALGOD_TOKEN ?? "";
  const trimmed = server.endsWith("/") ? server.slice(0, -1) : server;
  return new algosdk.Algodv2(token, trimmed, "");
}

export function accountFromMnemonic(mnemonic: string): algosdk.Account {
  return algosdk.mnemonicToSecretKey(mnemonic);
}

export async function getAssetBalance(
  algod: Algodv2,
  address: string,
  assetId: number
): Promise<bigint> {
  try {
    const account = await algod.accountInformation(address).do();
    if (assetId === ALGO_ASSET_ID) {
      return account.amount;
    }

    const holding = account.assets.find((asset) => Number(asset.assetId) === assetId);
    return holding?.amount ?? 0n;
  } catch {
    return 0n;
  }
}

export async function ensureAssetOptIn(
  account: algosdk.Account,
  algod: Algodv2,
  assetId: number,
  options: { waitForConfirmation?: boolean } = {}
): Promise<void> {
  if (assetId === ALGO_ASSET_ID) {
    return;
  }

  const balance = await getAssetBalance(algod, account.addr.toString(), assetId);
  if (balance > 0n) {
    return;
  }

  const accountInfo = await algod.accountInformation(account.addr).do();
  const alreadyOptedIn = accountInfo.assets.some(
    (asset) => Number(asset.assetId) === assetId
  );
  if (alreadyOptedIn) {
    return;
  }

  const suggested = await algod.getTransactionParams().do();
  const optInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: account.addr,
    receiver: account.addr,
    amount: 0n,
    assetIndex: assetId,
    suggestedParams: {
      ...suggested,
      flatFee: true,
      fee: 1_000
    }
  });

  const signed = algosdk.signTransaction(optInTxn, account.sk);
  const { txId } = await algod.sendRawTransaction(signed.blob).do();
  if (options.waitForConfirmation !== false) {
    await algosdk.waitForConfirmation(algod, txId, 4);
  }
}

export async function resolveTinymanAlgoUsdcPool(algod: Algodv2): Promise<TinymanPoolContext> {
  const poolInfo = await poolUtils.v2.getPoolInfo({
    client: algod,
    network: "mainnet",
    asset1ID: USDC_ASSET_ID,
    asset2ID: ALGO_ASSET_ID
  });

  if (poolInfo.poolTokenID === undefined) {
    throw new Error("Tinyman ALGO/USDC pool is missing a pool token id.");
  }

  return {
    poolTokenId: poolInfo.poolTokenID,
    asset1Id: USDC_ASSET_ID,
    asset2Id: ALGO_ASSET_ID
  };
}

export async function computeBalancedAddAmounts(
  algod: Algodv2,
  usdcMicroAmount: bigint
): Promise<BalancedAddAmounts> {
  const poolInfo = await poolUtils.v2.getPoolInfo({
    client: algod,
    network: "mainnet",
    asset1ID: USDC_ASSET_ID,
    asset2ID: ALGO_ASSET_ID
  });
  const reserves = await poolUtils.v2.getPoolReserves(algod, poolInfo);

  if (reserves.asset1 <= 0n) {
    throw new Error("Tinyman pool asset1 reserves must be positive.");
  }

  const assetBAmount = (usdcMicroAmount * reserves.asset2) / reserves.asset1;
  if (assetBAmount <= 0n) {
    throw new Error("Computed ALGO deposit amount must be greater than zero.");
  }

  return {
    assetAId: USDC_ASSET_ID,
    assetAAmount: usdcMicroAmount,
    assetBId: ALGO_ASSET_ID,
    assetBAmount
  };
}

export async function resolvePactAlgoUsdcPool(algod: Algodv2): Promise<PactPoolContext> {
  const pools = await fetchPactAlgoUsdcPools();
  if (pools.length === 0) {
    throw new Error("No Pact ALGO/USDC pool found on mainnet.");
  }

  const pool = selectPactPool(pools);
  return {
    poolAppId: parsePactApiId(pool.on_chain_id, "Pact pool app id"),
    poolTokenId: parsePactApiId(pool.pool_asset?.on_chain_id, "Pact pool token id"),
    primaryAssetId: parsePactApiId(pool.primary_asset?.on_chain_id, "Pact primary asset id"),
    secondaryAssetId: parsePactApiId(pool.secondary_asset?.on_chain_id, "Pact secondary asset id")
  };
}

export async function computeBalancedPactAddAmounts(
  algod: Algodv2,
  usdcMicroAmount: bigint
): Promise<BalancedAddAmounts> {
  const pool = await resolvePactAlgoUsdcPool(algod);
  const state = await resolvePactPoolState({
    network: "mainnet",
    algod,
    poolAppId: pool.poolAppId,
    assetAId: ALGO_ASSET_ID,
    assetBId: USDC_ASSET_ID
  });
  if (state.reserves.totalSecondary <= 0) {
    throw new Error("Pact pool secondary reserves must be positive.");
  }

  const secondaryAmount = usdcMicroAmount;
  const primaryAmount = BigInt(
    Math.round(
      (Number(secondaryAmount) * state.reserves.totalPrimary) / state.reserves.totalSecondary
    )
  );
  if (primaryAmount <= 0n) {
    throw new Error("Computed ALGO deposit amount must be greater than zero.");
  }

  return {
    assetAId: USDC_ASSET_ID,
    assetAAmount: secondaryAmount,
    assetBId: ALGO_ASSET_ID,
    assetBAmount: primaryAmount
  };
}

async function fetchPactAlgoUsdcPools(): Promise<PactPoolApiRecord[]> {
  const baseUrl = trimTrailingSlash(process.env.PACT_API_BASE_URL ?? "https://api.pact.fi/api");
  const url = new URL(`${baseUrl}/pools`);
  url.searchParams.set("primary_asset__on_chain_id", ALGO_ASSET_ID.toString());
  url.searchParams.set("secondary_asset__on_chain_id", USDC_ASSET_ID.toString());

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Pact pool lookup failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as PactPoolsApiResponse;
  return payload.results ?? [];
}

function selectPactPool(pools: readonly PactPoolApiRecord[]): PactPoolApiRecord {
  const currentVerified = pools.filter(
    (pool) => pool.is_deprecated !== true && pool.is_verified === true
  );
  const current = pools.filter((pool) => pool.is_deprecated !== true);
  const candidates =
    currentVerified.length > 0 ? currentVerified : current.length > 0 ? current : [...pools];

  return [...candidates].sort((left, right) => toNumber(right.tvl_usd) - toNumber(left.tvl_usd))[0]!;
}

function parsePactApiId(value: number | string | null | undefined, label: string): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} is missing or invalid.`);
  }
  return parsed;
}

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export async function getDorkFiArc200Balance(
  algod: Algodv2,
  contractAppId: number,
  userAddress: string
): Promise<bigint> {
  const { abi, CONTRACT } = await import("ulujs");
  const signer = { addr: userAddress, sk: new Uint8Array() };
  const token = new CONTRACT(
    contractAppId,
    algod,
    undefined,
    abi.nt200,
    signer,
    true,
    false,
    true
  );
  const response = await token.arc200_balanceOf(userAddress);
  return BigInt(response.returnValue);
}

export function signEncodedTransactionGroup(
  encodedTransactions: readonly string[],
  secretKey: Uint8Array
): Uint8Array[] {
  return encodedTransactions.map((encoded) => {
    const txn = algosdk.decodeUnsignedTransaction(Buffer.from(encoded, "base64"));
    return algosdk.signTransaction(txn, secretKey).blob;
  });
}

export function signEncodedTransactionGroupWithSigners(
  encodedTransactions: readonly string[],
  secretKeysByAddress: ReadonlyMap<string, Uint8Array> | Record<string, Uint8Array>
): Uint8Array[] {
  const resolveSecretKey =
    secretKeysByAddress instanceof Map
      ? (address: string) => secretKeysByAddress.get(address)
      : (address: string) => secretKeysByAddress[address];

  return encodedTransactions.map((encoded) => {
    const txn = algosdk.decodeUnsignedTransaction(Buffer.from(encoded, "base64"));
    const sender = txn.sender.toString();
    const secretKey = resolveSecretKey(sender);
    if (secretKey === undefined) {
      throw new Error(`No secret key provided for transaction sender ${sender}.`);
    }
    return algosdk.signTransaction(txn, secretKey).blob;
  });
}

export async function submitTransactionGroup(
  algod: Algodv2,
  signedTransactions: readonly Uint8Array[]
): Promise<SubmitTransactionGroupResult> {
  if (signedTransactions.length === 0) {
    throw new Error("Cannot submit an empty transaction group.");
  }

  const response = await algod.sendRawTransaction(signedTransactions).do();
  const txId = response.txid;
  const confirmation = await algosdk.waitForConfirmation(algod, txId, 8);

  const pending = await algod.pendingTransactionInformation(txId).do();
  const groupId = pending.txn?.group
    ? Buffer.from(pending.txn.group).toString("base64")
    : "";

  return {
    txId,
    groupId,
    confirmedRound: confirmation.confirmedRound ?? 0n
  };
}
