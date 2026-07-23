import algosdk, {
  Algodv2,
  AtomicTransactionComposer,
  makeEmptyTransactionSigner
} from "algosdk";

import {
  RETI_SIMULATE_SENDER,
  RETI_VALIDATOR_REGISTRY_APP_ID
} from "./constants.js";

export const GET_NUM_VALIDATORS_METHOD = new algosdk.ABIMethod({
  name: "getNumValidators",
  args: [],
  returns: { type: "uint64" }
});

export const GET_VALIDATOR_CONFIG_METHOD = new algosdk.ABIMethod({
  name: "getValidatorConfig",
  args: [{ type: "uint64", name: "validatorId" }],
  returns: {
    type: "(uint64,address,address,uint64,uint8,address,uint64[4],uint64,uint64,uint64,uint32,uint32,address,uint64,uint64,uint8,uint64,uint64)"
  }
});

export const GET_VALIDATOR_STATE_METHOD = new algosdk.ABIMethod({
  name: "getValidatorState",
  args: [{ type: "uint64", name: "validatorId" }],
  returns: { type: "(uint16,uint64,uint64,uint64)" }
});

export const GET_POOLS_METHOD = new algosdk.ABIMethod({
  name: "getPools",
  args: [{ type: "uint64", name: "validatorId" }],
  returns: { type: "(uint64,uint16,uint64)[]" }
});

export const GET_CUR_MAX_STAKE_PER_POOL_METHOD = new algosdk.ABIMethod({
  name: "getCurMaxStakePerPool",
  args: [{ type: "uint64", name: "validatorId" }],
  returns: { type: "uint64" }
});

export const GET_STAKED_POOLS_FOR_ACCOUNT_METHOD = new algosdk.ABIMethod({
  name: "getStakedPoolsForAccount",
  args: [{ type: "address", name: "staker" }],
  returns: { type: "(uint64,uint64,uint64)[]" }
});

export const ADD_STAKE_METHOD = new algosdk.ABIMethod({
  name: "addStake",
  args: [
    { type: "pay", name: "stakedAmountPayment" },
    { type: "uint64", name: "validatorId" },
    { type: "uint64", name: "valueToVerify" }
  ],
  returns: { type: "(uint64,uint64,uint64)" }
});

export const GAS_METHOD = new algosdk.ABIMethod({
  name: "gas",
  args: [],
  returns: { type: "void" }
});

export const REMOVE_STAKE_METHOD = new algosdk.ABIMethod({
  name: "removeStake",
  args: [
    { type: "address", name: "staker" },
    { type: "uint64", name: "amountToUnstake" }
  ],
  returns: { type: "void" }
});

export const GET_STAKER_INFO_METHOD = new algosdk.ABIMethod({
  name: "getStakerInfo",
  args: [{ type: "address", name: "staker" }],
  returns: { type: "(address,uint64,uint64,uint64,uint64)" }
});

export interface RetiValidatorConfig {
  id: bigint;
  owner: string;
  manager: string;
  nfdForInfo: bigint;
  entryGatingType: number;
  entryGatingAddress: string;
  entryGatingAssets: readonly bigint[];
  gatingAssetMinBalance: bigint;
  rewardTokenId: bigint;
  rewardPerPayout: bigint;
  epochRoundLength: number;
  percentToValidator: number;
  validatorCommissionAddress: string;
  minEntryStake: bigint;
  maxAlgoPerPool: bigint;
  poolsPerNode: number;
  sunsettingOn: bigint;
  sunsettingTo: bigint;
}

export interface RetiValidatorState {
  numPools: number;
  totalStakers: bigint;
  totalAlgoStaked: bigint;
  rewardTokenHeldBack: bigint;
}

export interface RetiPoolInfo {
  poolAppId: bigint;
  totalStakers: number;
  totalAlgoStaked: bigint;
}

export interface RetiValidatorPoolKey {
  validatorId: bigint;
  poolId: bigint;
  poolAppId: bigint;
}

export interface RetiStakerInfo {
  account: string;
  balance: bigint;
  totalRewarded: bigint;
  rewardTokenBalance: bigint;
  entryRound: bigint;
}

function throwCompactSimulateError(method: string, detail: string): never {
  const firstLine = detail.split("\n")[0] ?? detail;
  const compact = firstLine.replace(/\s+/g, " ").trim().slice(0, 160);
  throw new Error(`${method} simulate: ${compact || "failed"}`);
}

async function simulateMethodCall(params: {
  algod: Algodv2;
  appId: number;
  method: algosdk.ABIMethod;
  methodArgs?: unknown[];
  sender?: string;
}): Promise<unknown> {
  const sender = params.sender ?? RETI_SIMULATE_SENDER;
  const suggestedParams = await params.algod.getTransactionParams().do();
  const atc = new AtomicTransactionComposer();
  atc.addMethodCall({
    appID: params.appId,
    method: params.method,
    methodArgs: params.methodArgs ?? [],
    sender,
    signer: makeEmptyTransactionSigner(),
    suggestedParams
  });

  const simRequest = new algosdk.modelsv2.SimulateRequest({
    allowUnnamedResources: true,
    allowEmptySignatures: true,
    txnGroups: []
  });
  const response = await atc.simulate(params.algod, simRequest);
  const group = response.simulateResponse.txnGroups[0];
  if (group?.txnResults === undefined || group.txnResults.length === 0) {
    throwCompactSimulateError(params.method.name, "no txn results");
  }
  if (group.failureMessage) {
    throwCompactSimulateError(params.method.name, group.failureMessage);
  }

  const methodResults = response.methodResults;
  const methodResult = methodResults[methodResults.length - 1];
  if (methodResult?.decodeError) {
    throwCompactSimulateError(
      params.method.name,
      methodResult.decodeError.message
    );
  }
  if (methodResult?.returnValue === undefined) {
    throwCompactSimulateError(params.method.name, "no ABI return");
  }
  return methodResult.returnValue;
}

function asBigInt(value: unknown): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "string") {
    return BigInt(value);
  }
  throw new Error(`Expected bigint-compatible value, got ${typeof value}`);
}

function asAddress(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Uint8Array) {
    return algosdk.encodeAddress(value);
  }
  throw new Error("Expected address value");
}

export function decodeValidatorConfig(raw: unknown): RetiValidatorConfig {
  if (!Array.isArray(raw) || raw.length < 18) {
    throw new Error("getValidatorConfig returned unexpected shape");
  }
  const assetsRaw = raw[6];
  const assets = Array.isArray(assetsRaw)
    ? assetsRaw.map((entry) => asBigInt(entry))
    : [];
  return {
    id: asBigInt(raw[0]),
    owner: asAddress(raw[1]),
    manager: asAddress(raw[2]),
    nfdForInfo: asBigInt(raw[3]),
    entryGatingType: Number(asBigInt(raw[4])),
    entryGatingAddress: asAddress(raw[5]),
    entryGatingAssets: assets,
    gatingAssetMinBalance: asBigInt(raw[7]),
    rewardTokenId: asBigInt(raw[8]),
    rewardPerPayout: asBigInt(raw[9]),
    epochRoundLength: Number(asBigInt(raw[10])),
    percentToValidator: Number(asBigInt(raw[11])),
    validatorCommissionAddress: asAddress(raw[12]),
    minEntryStake: asBigInt(raw[13]),
    maxAlgoPerPool: asBigInt(raw[14]),
    poolsPerNode: Number(asBigInt(raw[15])),
    sunsettingOn: asBigInt(raw[16]),
    sunsettingTo: asBigInt(raw[17])
  };
}

export function decodeValidatorState(raw: unknown): RetiValidatorState {
  if (!Array.isArray(raw) || raw.length < 4) {
    throw new Error("getValidatorState returned unexpected shape");
  }
  return {
    numPools: Number(asBigInt(raw[0])),
    totalStakers: asBigInt(raw[1]),
    totalAlgoStaked: asBigInt(raw[2]),
    rewardTokenHeldBack: asBigInt(raw[3])
  };
}

export function decodePools(raw: unknown): RetiPoolInfo[] {
  if (!Array.isArray(raw)) {
    throw new Error("getPools returned unexpected shape");
  }
  return raw.map((entry) => {
    if (!Array.isArray(entry) || entry.length < 3) {
      throw new Error("getPools pool entry unexpected shape");
    }
    return {
      poolAppId: asBigInt(entry[0]),
      totalStakers: Number(asBigInt(entry[1])),
      totalAlgoStaked: asBigInt(entry[2])
    };
  });
}

export function decodePoolKeys(raw: unknown): RetiValidatorPoolKey[] {
  if (!Array.isArray(raw)) {
    throw new Error("getStakedPoolsForAccount returned unexpected shape");
  }
  return raw.map((entry) => {
    if (!Array.isArray(entry) || entry.length < 3) {
      throw new Error("pool key unexpected shape");
    }
    return {
      validatorId: asBigInt(entry[0]),
      poolId: asBigInt(entry[1]),
      poolAppId: asBigInt(entry[2])
    };
  });
}

export function decodeStakerInfo(raw: unknown): RetiStakerInfo {
  if (!Array.isArray(raw) || raw.length < 5) {
    throw new Error("getStakerInfo returned unexpected shape");
  }
  return {
    account: asAddress(raw[0]),
    balance: asBigInt(raw[1]),
    totalRewarded: asBigInt(raw[2]),
    rewardTokenBalance: asBigInt(raw[3]),
    entryRound: asBigInt(raw[4])
  };
}

export async function retiGetNumValidators(
  algod: Algodv2,
  appId: number = RETI_VALIDATOR_REGISTRY_APP_ID
): Promise<number> {
  const value = await simulateMethodCall({
    algod,
    appId,
    method: GET_NUM_VALIDATORS_METHOD
  });
  return Number(asBigInt(value));
}

export async function retiGetValidatorConfig(
  algod: Algodv2,
  validatorId: number | bigint,
  appId: number = RETI_VALIDATOR_REGISTRY_APP_ID
): Promise<RetiValidatorConfig> {
  const value = await simulateMethodCall({
    algod,
    appId,
    method: GET_VALIDATOR_CONFIG_METHOD,
    methodArgs: [BigInt(validatorId)]
  });
  return decodeValidatorConfig(value);
}

export async function retiGetValidatorState(
  algod: Algodv2,
  validatorId: number | bigint,
  appId: number = RETI_VALIDATOR_REGISTRY_APP_ID
): Promise<RetiValidatorState> {
  const value = await simulateMethodCall({
    algod,
    appId,
    method: GET_VALIDATOR_STATE_METHOD,
    methodArgs: [BigInt(validatorId)]
  });
  return decodeValidatorState(value);
}

export async function retiGetPools(
  algod: Algodv2,
  validatorId: number | bigint,
  appId: number = RETI_VALIDATOR_REGISTRY_APP_ID
): Promise<RetiPoolInfo[]> {
  const value = await simulateMethodCall({
    algod,
    appId,
    method: GET_POOLS_METHOD,
    methodArgs: [BigInt(validatorId)]
  });
  return decodePools(value);
}

export async function retiGetCurMaxStakePerPool(
  algod: Algodv2,
  validatorId: number | bigint,
  appId: number = RETI_VALIDATOR_REGISTRY_APP_ID
): Promise<bigint> {
  const value = await simulateMethodCall({
    algod,
    appId,
    method: GET_CUR_MAX_STAKE_PER_POOL_METHOD,
    methodArgs: [BigInt(validatorId)]
  });
  return asBigInt(value);
}

export async function retiGetStakedPoolsForAccount(
  algod: Algodv2,
  staker: string,
  appId: number = RETI_VALIDATOR_REGISTRY_APP_ID
): Promise<RetiValidatorPoolKey[]> {
  const value = await simulateMethodCall({
    algod,
    appId,
    method: GET_STAKED_POOLS_FOR_ACCOUNT_METHOD,
    methodArgs: [staker],
    sender: staker
  });
  return decodePoolKeys(value);
}

export async function retiGetStakerInfo(
  algod: Algodv2,
  poolAppId: number | bigint,
  staker: string
): Promise<RetiStakerInfo> {
  const value = await simulateMethodCall({
    algod,
    appId: Number(poolAppId),
    method: GET_STAKER_INFO_METHOD,
    methodArgs: [staker],
    sender: staker
  });
  return decodeStakerInfo(value);
}

export function createRetiAlgodClient(): Algodv2 {
  const server = process.env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud";
  const token = process.env.X402_ALGOD_TOKEN ?? "";
  return new algosdk.Algodv2(token, server.replace(/\/$/, ""), "");
}
