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

function emptySignSigner(
  txnGroup: algosdk.Transaction[],
  indexesToSign: number[]
): Promise<Uint8Array[]> {
  return Promise.resolve(
    indexesToSign.map((index) => {
      const txnObj = algosdk.decodeObj(
        algosdk.encodeUnsignedTransaction(txnGroup[index]!)
      ) as { txn: Record<string, unknown> };
      return new Uint8Array(algosdk.encodeObj({ txn: txnObj.txn }));
    })
  );
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
    signer: emptySignSigner
  });

  const simRequest = new algosdk.modelsv2.SimulateRequest({
    txnGroups: [],
    allowEmptySignatures: true,
    allowUnnamedResources: true
  });

  const response = await atc.simulate(params.algod, simRequest);
  const methodResult = response.methodResults[0];
  if (methodResult?.decodeError) {
    throw methodResult.decodeError;
  }
  if (methodResult?.returnValue === undefined) {
    throw new Error("get_market simulation returned no value.");
  }

  return decodeMarketResult(methodResult.returnValue);
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
    signer: emptySignSigner
  });

  const simRequest = new algosdk.modelsv2.SimulateRequest({
    txnGroups: [],
    allowEmptySignatures: true,
    allowUnnamedResources: true
  });

  const response = await atc.simulate(params.algod, simRequest);
  const methodResult = response.methodResults[0];
  if (methodResult?.decodeError) {
    throw methodResult.decodeError;
  }
  if (methodResult?.returnValue === undefined) {
    throw new Error("withdraw simulation returned no value.");
  }

  return BigInt(methodResult.returnValue as string | number | bigint);
}
