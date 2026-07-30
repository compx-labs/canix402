import { Algodv2 } from "algosdk";

import { ShapeStateError } from "../../errors.js";
import type { ExecutionNetwork } from "../../types.js";
import {
  ALPHA_ARCADE_STAKING_APP_ID,
  ALPHA_ASSET_ID,
  USDC_ASSET_ID
} from "./constants.js";
import {
  getAccountAssetBalance,
  getApplicationAddress,
  isAppOptedIn,
  isAssetOptedIn
} from "./shared.js";

export interface AlphaArcadeStakingGlobalState {
  totalStaked: bigint;
}

export interface AlphaArcadeLocalStake {
  optedIn: boolean;
  staked: bigint;
}

export interface AlphaArcadeStakingState {
  network: ExecutionNetwork;
  appId: number;
  appAddress: string;
  alphaAssetId: number;
  usdcAssetId: number;
  totalStaked: bigint;
  local: AlphaArcadeLocalStake;
  userAlphaBalance: bigint;
  userOptedIntoUsdc: boolean;
}

export interface AlphaArcadeStakingStateDependencies {
  getGlobalState: (algod: Algodv2, appId: number) => Promise<AlphaArcadeStakingGlobalState>;
  getLocalStake: (
    algod: Algodv2,
    address: string,
    appId: number
  ) => Promise<AlphaArcadeLocalStake>;
  getAccountAssetBalance: typeof getAccountAssetBalance;
  isAssetOptedIn: typeof isAssetOptedIn;
  getApplicationAddress: typeof getApplicationAddress;
}

let dependencyOverrides: Partial<AlphaArcadeStakingStateDependencies> | undefined;

export function setAlphaArcadeStakingStateDependenciesForTests(
  overrides?: Partial<AlphaArcadeStakingStateDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): AlphaArcadeStakingStateDependencies {
  return {
    getGlobalState: defaultGetGlobalState,
    getLocalStake: defaultGetLocalStake,
    getAccountAssetBalance,
    isAssetOptedIn,
    getApplicationAddress,
    ...dependencyOverrides
  };
}

async function defaultGetGlobalState(
  algod: Algodv2,
  appId: number
): Promise<AlphaArcadeStakingGlobalState> {
  const application = await algod.getApplicationByID(appId).do();
  const globalState = application.params?.globalState ?? [];
  let totalStaked = 0n;
  for (const entry of globalState) {
    const key = Buffer.from(entry.key).toString("utf8");
    if (key === "total_staked") {
      totalStaked = BigInt(entry.value.uint ?? 0);
    }
  }
  return { totalStaked };
}

async function defaultGetLocalStake(
  algod: Algodv2,
  address: string,
  appId: number
): Promise<AlphaArcadeLocalStake> {
  const optedIn = await isAppOptedIn(algod, address, appId);
  if (!optedIn) {
    return { optedIn: false, staked: 0n };
  }
  const account = await algod.accountInformation(address).do();
  const entry = (account.appsLocalState ?? []).find((item) => Number(item.id) === appId);
  if (entry === undefined) {
    return { optedIn: false, staked: 0n };
  }
  let staked = 0n;
  for (const kv of entry.keyValue ?? []) {
    const key = Buffer.from(kv.key).toString("utf8");
    if (key === "staked") {
      staked = BigInt(kv.value.uint ?? 0);
    }
  }
  return { optedIn: true, staked };
}

export async function resolveAlphaArcadeStakingState(params: {
  network: ExecutionNetwork;
  algod: Algodv2;
  userAddress: string;
  appId?: number;
}): Promise<AlphaArcadeStakingState> {
  const dependencies = resolveDependencies();
  const { network, algod, userAddress } = params;
  const appId = params.appId ?? ALPHA_ARCADE_STAKING_APP_ID;

  let global: AlphaArcadeStakingGlobalState;
  try {
    global = await dependencies.getGlobalState(algod, appId);
  } catch (error) {
    if (error instanceof ShapeStateError) {
      throw error;
    }
    throw new ShapeStateError("Failed to fetch Alpha Arcade staking global state.", {
      details: { appId, network },
      cause: error
    });
  }

  const [local, userAlphaBalance, userOptedIntoUsdc] = await Promise.all([
    dependencies.getLocalStake(algod, userAddress, appId),
    dependencies.getAccountAssetBalance(algod, userAddress, ALPHA_ASSET_ID),
    dependencies.isAssetOptedIn(algod, userAddress, USDC_ASSET_ID)
  ]);

  return {
    network,
    appId,
    appAddress: dependencies.getApplicationAddress(appId),
    alphaAssetId: ALPHA_ASSET_ID,
    usdcAssetId: USDC_ASSET_ID,
    totalStaked: global.totalStaked,
    local,
    userAlphaBalance,
    userOptedIntoUsdc
  };
}
