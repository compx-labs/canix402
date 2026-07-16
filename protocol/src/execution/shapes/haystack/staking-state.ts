import { Algodv2 } from "algosdk";

import { ShapeStateError } from "../../errors.js";
import type { ExecutionNetwork } from "../../types.js";
import {
  HAYSTACK_ORACLE_APP_ID,
  HAYSTACK_STAKING_APP_ID,
  HAY_ASSET_ID,
  STAKER_BOX_MBR_MICROALGOS,
  USDC_ASSET_ID
} from "./constants.js";
import {
  getAccountAssetBalance,
  getApplicationAddress,
  getStakerBoxRecord,
  isAssetOptedIn,
  type StakerBoxRecord
} from "./shared.js";
import { createStakerBoxName } from "./staking-spec.js";

export interface HaystackStakingGlobalState {
  hayAssetId: number;
  usdcAssetId: number;
  oracleAppId: number;
  paused: boolean;
}

export interface HaystackStakingState {
  network: ExecutionNetwork;
  appId: number;
  appAddress: string;
  hayAssetId: number;
  usdcAssetId: number;
  oracleAppId: number;
  paused: boolean;
  staker: StakerBoxRecord;
  userHayBalance: bigint;
  userOptedIntoUsdc: boolean;
  stakerBoxName: Uint8Array;
  /** Box MBR the caller must fund on first stake; 0 when the box already exists. */
  mbrMicroAlgos: bigint;
}

export interface HaystackStakingStateDependencies {
  getGlobalState: (algod: Algodv2, appId: number) => Promise<HaystackStakingGlobalState>;
  getStakerBoxRecord: typeof getStakerBoxRecord;
  getAccountAssetBalance: typeof getAccountAssetBalance;
  isAssetOptedIn: typeof isAssetOptedIn;
  getApplicationAddress: typeof getApplicationAddress;
}

let dependencyOverrides: Partial<HaystackStakingStateDependencies> | undefined;

export function setHaystackStakingStateDependenciesForTests(
  overrides?: Partial<HaystackStakingStateDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): HaystackStakingStateDependencies {
  return {
    getGlobalState: defaultGetGlobalState,
    getStakerBoxRecord,
    getAccountAssetBalance,
    isAssetOptedIn,
    getApplicationAddress,
    ...dependencyOverrides
  };
}

async function defaultGetGlobalState(
  algod: Algodv2,
  appId: number
): Promise<HaystackStakingGlobalState> {
  const application = await algod.getApplicationByID(appId).do();
  const globalState = application.params?.globalState ?? [];
  const values = new Map<string, bigint>();
  for (const entry of globalState) {
    const key = Buffer.from(entry.key).toString("utf8");
    values.set(key, BigInt(entry.value.uint ?? 0));
  }

  const hay = values.get("hay");
  const usdc = values.get("usdc");
  if (hay === undefined || usdc === undefined) {
    throw new ShapeStateError("Application is not a HaystackStaking pool (missing global keys).", {
      details: { appId }
    });
  }

  return {
    hayAssetId: Number(hay),
    usdcAssetId: Number(usdc),
    oracleAppId: Number(values.get("oracleAppId") ?? BigInt(HAYSTACK_ORACLE_APP_ID)),
    paused: (values.get("paus") ?? 0n) !== 0n
  };
}

export async function resolveHaystackStakingState(params: {
  network: ExecutionNetwork;
  algod: Algodv2;
  userAddress: string;
  appId?: number;
}): Promise<HaystackStakingState> {
  const dependencies = resolveDependencies();
  const { network, algod, userAddress } = params;
  const appId = params.appId ?? HAYSTACK_STAKING_APP_ID;

  let global: HaystackStakingGlobalState;
  try {
    global = await dependencies.getGlobalState(algod, appId);
  } catch (error) {
    if (error instanceof ShapeStateError) {
      throw error;
    }
    throw new ShapeStateError("Failed to fetch HaystackStaking global state.", {
      details: { appId, network },
      cause: error
    });
  }

  if (global.hayAssetId !== HAY_ASSET_ID) {
    throw new ShapeStateError("HaystackStaking pool staked asset is not HAY.", {
      details: { appId, expected: HAY_ASSET_ID, actual: global.hayAssetId }
    });
  }
  if (global.usdcAssetId !== USDC_ASSET_ID) {
    throw new ShapeStateError("HaystackStaking pool USDC reward asset id is unexpected.", {
      details: { appId, expected: USDC_ASSET_ID, actual: global.usdcAssetId }
    });
  }
  if (global.paused) {
    throw new ShapeStateError("HaystackStaking pool is paused.", {
      details: { appId }
    });
  }

  const stakerBoxName = createStakerBoxName(userAddress);

  const [staker, userHayBalance, userOptedIntoUsdc] = await Promise.all([
    dependencies.getStakerBoxRecord(algod, appId, stakerBoxName),
    dependencies.getAccountAssetBalance(algod, userAddress, global.hayAssetId),
    dependencies.isAssetOptedIn(algod, userAddress, global.usdcAssetId)
  ]);

  return {
    network,
    appId,
    appAddress: dependencies.getApplicationAddress(appId),
    hayAssetId: global.hayAssetId,
    usdcAssetId: global.usdcAssetId,
    oracleAppId: global.oracleAppId,
    paused: global.paused,
    staker,
    userHayBalance,
    userOptedIntoUsdc,
    stakerBoxName,
    mbrMicroAlgos: staker.hasBox ? 0n : STAKER_BOX_MBR_MICROALGOS
  };
}
