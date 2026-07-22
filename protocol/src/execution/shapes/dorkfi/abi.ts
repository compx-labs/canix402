import algosdk, { Algodv2 } from "algosdk";

export const GET_MARKET_METHOD = new algosdk.ABIMethod({
  name: "get_market",
  args: [{ type: "uint64", name: "market_id" }],
  returns: {
    type: "(bool,uint256,uint256,uint64,uint64,uint64,uint64,uint64,uint64,uint256,uint256,uint256,uint256,uint64,uint256,uint256,uint64,uint64)"
  }
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

/** Index scale used by Dork.fi deposit math (matches dorkfi-app). */
export const DORKFI_DEPOSIT_INDEX_SCALE = 10n ** 18n;

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
    suggestedParams: {
      ...paramsSuggested,
      flatFee: true,
      fee: 20_000n
    },
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
