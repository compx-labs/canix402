import algosdk, { Algodv2 } from "algosdk";
import { CompXSDK, StakingClient, type StakingPoolState } from "@compx/sdk";

import { ShapeStateError } from "../../errors.js";
import type { ExecutionNetwork } from "../../types.js";
import { ALGO_ASSET_ID } from "./parse-input.js";
import { createStakerBoxName } from "./staking-spec.js";
import { getAccountAssetBalance, getApplicationAddress, isAssetOptedIn } from "./shared.js";

export interface CompXStakerInfo {
  stake: bigint;
  rewardDebt: bigint;
  hasBox: boolean;
}

export interface CompXStakingPoolState {
  network: ExecutionNetwork;
  poolAppId: number;
  poolAppAddress: string;
  stakedAssetId: number;
  rewardAssetId: number;
  contractState: number;
  initialized: boolean;
  rewardsFunded: boolean;
  endTime: number;
  pool: StakingPoolState;
  staker: CompXStakerInfo;
  userStakedBalance: bigint;
  userOptedIntoRewardAsset: boolean;
  stakerBoxName: Uint8Array;
}

export interface CompXStakingPoolStateDependencies {
  createStakingClient: (algod: Algodv2, network: ExecutionNetwork) => StakingClient;
  getPool: (client: StakingClient, poolAppId: number) => Promise<StakingPoolState | null>;
  getStakerInfo: (
    client: StakingClient,
    poolAppId: number,
    stakerAddress: string
  ) => Promise<{ stake: bigint; rewardDebt: bigint } | null>;
  getAccountAssetBalance: typeof getAccountAssetBalance;
  isAssetOptedIn: typeof isAssetOptedIn;
  getApplicationAddress: typeof getApplicationAddress;
  nowSeconds: () => number;
}

let dependencyOverrides: Partial<CompXStakingPoolStateDependencies> | undefined;

export function setCompXStakingPoolStateDependenciesForTests(
  overrides?: Partial<CompXStakingPoolStateDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): CompXStakingPoolStateDependencies {
  return {
    createStakingClient: (algod, network) => new CompXSDK({ algodClient: algod, network }).staking,
    getPool: async (client, poolAppId) => client.getPool(poolAppId),
    getStakerInfo: async (client, poolAppId, stakerAddress) =>
      client.getStakerInfo(poolAppId, stakerAddress),
    getAccountAssetBalance,
    isAssetOptedIn,
    getApplicationAddress,
    nowSeconds: () => Math.floor(Date.now() / 1000),
    ...dependencyOverrides
  };
}

export async function resolveCompXStakingPoolState(params: {
  network: ExecutionNetwork;
  algod: Algodv2;
  poolAppId: number;
  userAddress: string;
  now?: () => number;
}): Promise<CompXStakingPoolState> {
  const dependencies = resolveDependencies();
  const { network, algod, poolAppId, userAddress } = params;
  const nowSeconds =
    params.now === undefined
      ? dependencies.nowSeconds()
      : Math.floor(params.now() / 1000);

  const stakingClient = dependencies.createStakingClient(algod, network);

  let pool: StakingPoolState | null;
  try {
    pool = await dependencies.getPool(stakingClient, poolAppId);
  } catch (error) {
    throw new ShapeStateError("Failed to fetch CompX staking pool.", {
      details: { poolAppId, network },
      cause: error
    });
  }

  if (pool === null) {
    throw new ShapeStateError("CompX staking pool not found.", {
      details: { poolAppId, network }
    });
  }

  if (pool.stakedAssetId === ALGO_ASSET_ID) {
    throw new ShapeStateError("CompX staking execution shapes support ASA-staked pools only.", {
      details: { poolAppId, stakedAssetId: pool.stakedAssetId }
    });
  }

  if (pool.contractState !== 1) {
    throw new ShapeStateError("CompX staking pool is not active.", {
      details: { poolAppId, contractState: pool.contractState }
    });
  }

  if (!pool.initialized || !pool.rewardsFunded) {
    throw new ShapeStateError("CompX staking pool is not initialized or funded.", {
      details: {
        poolAppId,
        initialized: pool.initialized,
        rewardsFunded: pool.rewardsFunded
      }
    });
  }

  if (pool.endTime <= nowSeconds) {
    throw new ShapeStateError("CompX staking pool has ended.", {
      details: { poolAppId, endTime: pool.endTime, nowSeconds }
    });
  }

  let stakerRecord: { stake: bigint; rewardDebt: bigint } | null = null;
  try {
    stakerRecord = await dependencies.getStakerInfo(stakingClient, poolAppId, userAddress);
  } catch {
    stakerRecord = null;
  }

  const staker: CompXStakerInfo = {
    stake: stakerRecord?.stake ?? 0n,
    rewardDebt: stakerRecord?.rewardDebt ?? 0n,
    hasBox: stakerRecord !== null
  };

  const [userStakedBalance, userOptedIntoRewardAsset] = await Promise.all([
    dependencies.getAccountAssetBalance(algod, userAddress, pool.stakedAssetId),
    dependencies.isAssetOptedIn(algod, userAddress, pool.rewardAssetId)
  ]);

  return {
    network,
    poolAppId,
    poolAppAddress: dependencies.getApplicationAddress(poolAppId),
    stakedAssetId: pool.stakedAssetId,
    rewardAssetId: pool.rewardAssetId,
    contractState: pool.contractState,
    initialized: pool.initialized,
    rewardsFunded: pool.rewardsFunded,
    endTime: pool.endTime,
    pool,
    staker,
    userStakedBalance,
    userOptedIntoRewardAsset,
    stakerBoxName: createStakerBoxName(userAddress)
  };
}
