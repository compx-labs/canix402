import algosdk, { Algodv2 } from "algosdk";
import { PactClient } from "@pactfi/pactsdk";
import { poolUtils } from "@tinymanorg/tinyman-js-sdk";

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
  assetId: number
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
  await algosdk.waitForConfirmation(algod, txId, 4);
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
  const pact = new PactClient(algod, { network: "mainnet" });
  const pools = await pact.fetchPoolsByAssets(ALGO_ASSET_ID, USDC_ASSET_ID);
  if (pools.length === 0) {
    throw new Error("No Pact ALGO/USDC pool found on mainnet.");
  }

  const pool = pools[0];
  return {
    poolAppId: pool.appId,
    poolTokenId: pool.liquidityAsset.index,
    primaryAssetId: pool.primaryAsset.index,
    secondaryAssetId: pool.secondaryAsset.index
  };
}

export async function computeBalancedPactAddAmounts(
  algod: Algodv2,
  usdcMicroAmount: bigint
): Promise<BalancedAddAmounts> {
  const pact = new PactClient(algod, { network: "mainnet" });
  const pools = await pact.fetchPoolsByAssets(ALGO_ASSET_ID, USDC_ASSET_ID);
  if (pools.length === 0) {
    throw new Error("No Pact ALGO/USDC pool found on mainnet.");
  }

  const pool = pools[0];
  if (pool.state.totalSecondary <= 0) {
    throw new Error("Pact pool secondary reserves must be positive.");
  }

  const secondaryAmount = usdcMicroAmount;
  const primaryAmount = BigInt(
    Math.round(
      (Number(secondaryAmount) * pool.state.totalPrimary) / pool.state.totalSecondary
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
