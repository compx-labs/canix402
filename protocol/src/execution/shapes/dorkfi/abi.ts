import algosdk, { Algodv2 } from "algosdk";

import { DEFAULT_DORKFI_GROUP_FEE } from "./constants.js";

export const GET_MARKET_METHOD = new algosdk.ABIMethod({
  name: "get_market",
  args: [{ type: "uint64", name: "market_id" }],
  returns: {
    type: "(bool,uint256,uint256,uint64,uint64,uint64,uint64,uint64,uint64,uint256,uint256,uint256,uint256,uint64,uint256,uint256,uint64,uint64)"
  }
});

export const GET_USER_METHOD = new algosdk.ABIMethod({
  name: "get_user",
  args: [
    { type: "address", name: "user" },
    { type: "uint64", name: "market_id" }
  ],
  returns: { type: "(uint256,uint256,uint256,uint256,uint64,uint256)" }
});

/** Prefer contract-native outstanding debt when the pool exposes this readonly. */
export const GET_USER_BORROW_AMOUNT_METHOD = new algosdk.ABIMethod({
  name: "get_user_borrow_amount",
  args: [
    { type: "address", name: "user" },
    { type: "uint64", name: "market_id" }
  ],
  returns: { type: "uint256" }
});

export interface DecodedDorkFiMarket {
  paused: boolean;
  maxTotalDeposits: bigint;
  maxTotalBorrows: bigint;
  liquidationBonus: bigint;
  collateralFactor: bigint;
  liquidationThreshold: bigint;
  reserveFactor: bigint;
  borrowRate: bigint;
  slope: bigint;
  totalScaledDeposits: bigint;
  totalScaledBorrows: bigint;
  depositIndex: bigint;
  borrowIndex: bigint;
  lastUpdateTime: bigint;
  reserves: bigint;
  price: bigint;
  nTokenAppId: bigint;
  closeFactor: bigint;
}

/** Matches dorkfi-app User / decodeUser tuple order. */
export interface DecodedDorkFiUser {
  scaledDeposits: bigint;
  scaledBorrows: bigint;
  depositIndex: bigint;
  borrowIndex: bigint;
  lastUpdateTime: bigint;
  lastPrice: bigint;
}

export function decodeMarketResult(returnValue: unknown): DecodedDorkFiMarket {
  if (!Array.isArray(returnValue)) {
    throw new Error("get_market returned an unexpected value.");
  }
  const v = returnValue;
  return {
    paused: Boolean(v[0]),
    maxTotalDeposits: BigInt(v[1] as string | number | bigint),
    maxTotalBorrows: BigInt(v[2] as string | number | bigint),
    liquidationBonus: BigInt(v[3] as string | number | bigint),
    collateralFactor: BigInt(v[4] as string | number | bigint),
    liquidationThreshold: BigInt(v[5] as string | number | bigint),
    reserveFactor: BigInt(v[6] as string | number | bigint),
    borrowRate: BigInt(v[7] as string | number | bigint),
    slope: BigInt(v[8] as string | number | bigint),
    totalScaledDeposits: BigInt(v[9] as string | number | bigint),
    totalScaledBorrows: BigInt(v[10] as string | number | bigint),
    depositIndex: BigInt(v[11] as string | number | bigint),
    borrowIndex: BigInt(v[12] as string | number | bigint),
    lastUpdateTime: BigInt(v[13] as string | number | bigint),
    reserves: BigInt(v[14] as string | number | bigint),
    price: BigInt(v[15] as string | number | bigint),
    nTokenAppId: BigInt(v[16] as string | number | bigint),
    closeFactor: BigInt(v[17] as string | number | bigint)
  };
}

const emptySignSigner = algosdk.makeEmptyTransactionSigner();

/**
 * `get_user` / `get_user_borrow_amount` inner-call the market app (`itxn_submit`).
 * A 1000µA simulate fails with "no ABI return", which the positions collector
 * treats as a debt-read failure and marks Dork.fi `partial` — blocking Brownie.
 */
export function withDorkFiReadonlyInnerFee(
  params: algosdk.SuggestedParams
): algosdk.SuggestedParams {
  return {
    ...params,
    flatFee: true,
    fee: DEFAULT_DORKFI_GROUP_FEE
  };
}

/** Keep simulate failures short — never surface full algosdk txn dumps. */
function throwCompactSimulateError(method: string, methodResult: {
  decodeError?: Error;
  returnValue?: unknown;
}): never {
  const raw =
    methodResult.decodeError instanceof Error
      ? methodResult.decodeError.message
      : methodResult.returnValue === undefined
        ? "no ABI return"
        : "unexpected simulate result";
  const firstLine = raw.split("\n")[0] ?? raw;
  const compact = /did not log a return value/i.test(firstLine)
    ? "no ABI return"
    : firstLine.replace(/\s+/g, " ").trim().slice(0, 120);
  throw new Error(`${method} simulate: ${compact || "failed"}`);
}

export async function simulateGetMarket(params: {
  algod: Algodv2;
  poolAppId: number;
  marketAppId: number;
}): Promise<DecodedDorkFiMarket> {
  const paramsSuggested = await params.algod.getTransactionParams().do();
  const sender = algosdk.getApplicationAddress(params.poolAppId);

  const atc = new algosdk.AtomicTransactionComposer();
  atc.addMethodCall({
    appID: params.poolAppId,
    method: GET_MARKET_METHOD,
    methodArgs: [params.marketAppId],
    sender,
    suggestedParams: paramsSuggested,
    signer: emptySignSigner,
    appForeignApps: [params.marketAppId]
  });

  const simRequest = new algosdk.modelsv2.SimulateRequest({
    txnGroups: [],
    allowEmptySignatures: true,
    allowUnnamedResources: true
  });

  const response = await atc.simulate(params.algod, simRequest);
  const methodResult = response.methodResults[0];
  if (methodResult?.decodeError || methodResult?.returnValue === undefined) {
    throwCompactSimulateError("get_market", methodResult ?? {});
  }

  return decodeMarketResult(methodResult.returnValue);
}

export function decodeUserResult(returnValue: unknown): DecodedDorkFiUser {
  if (!Array.isArray(returnValue)) {
    throw new Error("get_user returned an unexpected value.");
  }
  const v = returnValue;
  return {
    scaledDeposits: BigInt(v[0] as string | number | bigint),
    scaledBorrows: BigInt(v[1] as string | number | bigint),
    depositIndex: BigInt(v[2] as string | number | bigint),
    borrowIndex: BigInt(v[3] as string | number | bigint),
    lastUpdateTime: BigInt(v[4] as string | number | bigint),
    lastPrice: BigInt(v[5] as string | number | bigint)
  };
}

export async function simulateGetUser(params: {
  algod: Algodv2;
  poolAppId: number;
  marketAppId: number;
  userAddress: string;
}): Promise<DecodedDorkFiUser> {
  const paramsSuggested = await params.algod.getTransactionParams().do();
  const sender = algosdk.getApplicationAddress(params.poolAppId);

  const atc = new algosdk.AtomicTransactionComposer();
  atc.addMethodCall({
    appID: params.poolAppId,
    method: GET_USER_METHOD,
    methodArgs: [params.userAddress, params.marketAppId],
    sender,
    suggestedParams: withDorkFiReadonlyInnerFee(paramsSuggested),
    signer: emptySignSigner,
    appForeignApps: [params.marketAppId]
  });

  const simRequest = new algosdk.modelsv2.SimulateRequest({
    txnGroups: [],
    allowEmptySignatures: true,
    allowUnnamedResources: true
  });

  const response = await atc.simulate(params.algod, simRequest);
  const methodResult = response.methodResults[0];
  if (methodResult?.decodeError || methodResult?.returnValue === undefined) {
    throwCompactSimulateError("get_user", methodResult ?? {});
  }

  return decodeUserResult(methodResult.returnValue);
}

/**
 * Outstanding underlying borrow from the pool when supported.
 * Returns null when the method is missing or simulate fails (caller falls back).
 */
export async function trySimulateGetUserBorrowAmount(params: {
  algod: Algodv2;
  poolAppId: number;
  marketAppId: number;
  userAddress: string;
}): Promise<bigint | null> {
  try {
    const paramsSuggested = await params.algod.getTransactionParams().do();
    const sender = algosdk.getApplicationAddress(params.poolAppId);

    const atc = new algosdk.AtomicTransactionComposer();
    atc.addMethodCall({
      appID: params.poolAppId,
      method: GET_USER_BORROW_AMOUNT_METHOD,
      methodArgs: [params.userAddress, params.marketAppId],
      sender,
      suggestedParams: withDorkFiReadonlyInnerFee(paramsSuggested),
      signer: emptySignSigner,
      appForeignApps: [params.marketAppId]
    });

    const simRequest = new algosdk.modelsv2.SimulateRequest({
      txnGroups: [],
      allowEmptySignatures: true,
      allowUnnamedResources: true
    });

    const response = await atc.simulate(params.algod, simRequest);
    const methodResult = response.methodResults[0];
    if (methodResult?.decodeError || methodResult?.returnValue === undefined) {
      return null;
    }
    const outstanding = BigInt(
      methodResult.returnValue as string | number | bigint
    );
    return outstanding >= 0n ? outstanding : null;
  } catch {
    return null;
  }
}

/** Index scale used by Dork.fi deposit/borrow math (matches dorkfi-app). */
export const DORKFI_DEPOSIT_INDEX_SCALE = 10n ** 18n;

/** Oracle / get_market.price scale (WAD) used by dorkfi-app formatPrice. */
export const DORKFI_PRICE_SCALE = 10n ** 18n;

/**
 * Convert scaled nToken / scaled-deposit units to underlying ASA base units.
 * Formula: (scaled * depositIndex) / 1e18
 */
export function underlyingFromScaledDeposits(
  scaledDeposits: bigint,
  depositIndex: bigint
): bigint {
  if (scaledDeposits <= 0n || depositIndex <= 0n) {
    return 0n;
  }
  return (scaledDeposits * depositIndex) / DORKFI_DEPOSIT_INDEX_SCALE;
}

/**
 * Convert scaled borrows to outstanding underlying ASA base units.
 * Formula: (scaledBorrows * borrowIndex) / 1e18
 */
export function underlyingFromScaledBorrows(
  scaledBorrows: bigint,
  borrowIndex: bigint
): bigint {
  if (scaledBorrows <= 0n || borrowIndex <= 0n) {
    return 0n;
  }
  return (scaledBorrows * borrowIndex) / DORKFI_DEPOSIT_INDEX_SCALE;
}

/**
 * USD value from get_market.price (1e18 WAD) and outstanding base units.
 * Returns null when price or amount is not usable.
 */
export function dorkFiUsdFromMarketPrice(
  outstandingRaw: bigint,
  decimals: number,
  marketPriceWad: bigint
): number | null {
  if (outstandingRaw <= 0n || marketPriceWad <= 0n || decimals < 0) {
    return null;
  }
  const amountScale = 10n ** BigInt(decimals);
  // outstanding * price / (10^decimals * 1e18)
  const usdScaled =
    (outstandingRaw * marketPriceWad * 1_000_000_000n) /
    (amountScale * DORKFI_PRICE_SCALE);
  const usd = Number(usdScaled) / 1_000_000_000;
  return Number.isFinite(usd) && usd >= 0 ? usd : null;
}

export async function simulateWithdrawUnderlyingAmount(params: {
  algod: Algodv2;
  poolAppId: number;
  marketAppId: number;
  nTokenAmount: bigint;
  userAddress: string;
}): Promise<bigint> {
  const paramsSuggested = await params.algod.getTransactionParams().do();
  const withdrawMethod = new algosdk.ABIMethod({
    name: "withdraw",
    args: [
      { type: "uint64", name: "market_id" },
      { type: "uint256", name: "amount" }
    ],
    returns: { type: "uint256" }
  });

  const atc = new algosdk.AtomicTransactionComposer();
  atc.addMethodCall({
    appID: params.poolAppId,
    method: withdrawMethod,
    methodArgs: [params.marketAppId, params.nTokenAmount],
    sender: params.userAddress,
    suggestedParams: withDorkFiReadonlyInnerFee(paramsSuggested),
    signer: emptySignSigner,
    appForeignApps: [params.marketAppId]
  });

  const simRequest = new algosdk.modelsv2.SimulateRequest({
    txnGroups: [],
    allowEmptySignatures: true,
    allowUnnamedResources: true
  });

  const response = await atc.simulate(params.algod, simRequest);
  const methodResult = response.methodResults[0];
  if (methodResult?.decodeError || methodResult?.returnValue === undefined) {
    throwCompactSimulateError("withdraw", methodResult ?? {});
  }

  return BigInt(methodResult.returnValue as string | number | bigint);
}
