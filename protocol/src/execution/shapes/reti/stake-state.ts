import algosdk, { Algodv2 } from "algosdk";

import { ShapeStateError } from "../../errors.js";
import type { ExecutionNetwork } from "../../types.js";
import {
  retiGetCurMaxStakePerPool,
  retiGetPools,
  retiGetValidatorConfig,
  retiGetValidatorState,
  type RetiPoolInfo,
  type RetiValidatorConfig,
  type RetiValidatorState
} from "../../../reti/abi.js";
import {
  RETI_GATING_TYPE_ASSET_ID,
  RETI_GATING_TYPE_NONE,
  RETI_VALIDATOR_REGISTRY_APP_ID
} from "../../../reti/constants.js";
import { buildCapacity, buildEntryRequirements } from "../../../adapters/reti.js";
import type {
  OpportunityCapacity,
  OpportunityEntryRequirements
} from "../../../types/opportunity.js";

export interface RetiStakeState {
  network: ExecutionNetwork;
  registryAppId: number;
  validatorId: number;
  registryAddress: string;
  config: RetiValidatorConfig;
  state: RetiValidatorState;
  pools: RetiPoolInfo[];
  maxStakePerPool: bigint;
  currentRound: bigint;
  userAlgoBalance: bigint;
  entryRequirements: OpportunityEntryRequirements;
  capacity: OpportunityCapacity;
  /** ASA gate asset ids (for valueToVerify auto-pick). */
  gateAssetIds: number[];
  rewardTokenId: number;
  userOptedIntoRewardToken: boolean;
}

export interface RetiStakeStateDependencies {
  getValidatorConfig: typeof retiGetValidatorConfig;
  getValidatorState: typeof retiGetValidatorState;
  getPools: typeof retiGetPools;
  getCurMaxStakePerPool: typeof retiGetCurMaxStakePerPool;
  getAccountAlgoBalance: (algod: Algodv2, address: string) => Promise<bigint>;
  isAssetOptedIn: (
    algod: Algodv2,
    address: string,
    assetId: number
  ) => Promise<boolean>;
  getStatusRound: (algod: Algodv2) => Promise<bigint>;
}

let dependencyOverrides: Partial<RetiStakeStateDependencies> | undefined;

export function setRetiStakeStateDependenciesForTests(
  overrides?: Partial<RetiStakeStateDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): RetiStakeStateDependencies {
  return {
    getValidatorConfig: retiGetValidatorConfig,
    getValidatorState: retiGetValidatorState,
    getPools: retiGetPools,
    getCurMaxStakePerPool: retiGetCurMaxStakePerPool,
    getAccountAlgoBalance: defaultGetAccountAlgoBalance,
    isAssetOptedIn: defaultIsAssetOptedIn,
    getStatusRound: async (algod) => {
      const status = await algod.status().do();
      return BigInt(status.lastRound ?? 0);
    },
    ...dependencyOverrides
  };
}

async function defaultGetAccountAlgoBalance(
  algod: Algodv2,
  address: string
): Promise<bigint> {
  const account = await algod.accountInformation(address).do();
  return BigInt(account.amount);
}

async function defaultIsAssetOptedIn(
  algod: Algodv2,
  address: string,
  assetId: number
): Promise<boolean> {
  if (assetId <= 0) {
    return true;
  }
  const account = await algod.accountInformation(address).do();
  return (account.assets ?? []).some((asset) => Number(asset.assetId) === assetId);
}

export async function resolveRetiStakeState(params: {
  network: ExecutionNetwork;
  algod: Algodv2;
  userAddress: string;
  validatorId: number;
  registryAppId?: number;
}): Promise<RetiStakeState> {
  const dependencies = resolveDependencies();
  const registryAppId = params.registryAppId ?? readRegistryAppId();
  const { network, algod, userAddress, validatorId } = params;

  let config: RetiValidatorConfig;
  let state: RetiValidatorState;
  let pools: RetiPoolInfo[];
  let maxStakePerPool: bigint;
  let currentRound: bigint;
  try {
    [config, state, pools, maxStakePerPool, currentRound] = await Promise.all([
      dependencies.getValidatorConfig(algod, validatorId, registryAppId),
      dependencies.getValidatorState(algod, validatorId, registryAppId),
      dependencies.getPools(algod, validatorId, registryAppId),
      dependencies.getCurMaxStakePerPool(algod, validatorId, registryAppId),
      dependencies.getStatusRound(algod)
    ]);
  } catch (error) {
    throw new ShapeStateError("Failed to fetch Réti validator state.", {
      details: { validatorId, registryAppId, network },
      cause: error
    });
  }

  const entryRequirements = buildEntryRequirements(config);
  const capacity = buildCapacity({
    pools,
    maxStakePerPool,
    sunsettingOn: config.sunsettingOn,
    currentRound,
    numPools: state.numPools
  });

  if (!capacity.acceptingStake) {
    throw new ShapeStateError("Réti validator is not accepting new stake.", {
      details: {
        validatorId,
        stakerSlotsRemaining: capacity.stakerSlotsRemaining,
        algoRoomMicroAlgos: capacity.algoRoomMicroAlgos,
        sunsettingOn: config.sunsettingOn.toString()
      }
    });
  }

  const rewardTokenId = Number(config.rewardTokenId);
  const [userAlgoBalance, userOptedIntoRewardToken] = await Promise.all([
    dependencies.getAccountAlgoBalance(algod, userAddress),
    rewardTokenId > 0
      ? dependencies.isAssetOptedIn(algod, userAddress, rewardTokenId)
      : Promise.resolve(true)
  ]);

  const gateAssetIds =
    config.entryGatingType === RETI_GATING_TYPE_ASSET_ID
      ? config.entryGatingAssets.filter((id) => id > 0n).map((id) => Number(id))
      : [];

  return {
    network,
    registryAppId,
    validatorId,
    registryAddress: algosdk.getApplicationAddress(registryAppId).toString(),
    config,
    state,
    pools,
    maxStakePerPool,
    currentRound,
    userAlgoBalance,
    entryRequirements,
    capacity,
    gateAssetIds,
    rewardTokenId,
    userOptedIntoRewardToken
  };
}

export function assertStakeEligibility(params: {
  amount: bigint;
  valueToVerify: bigint;
  state: RetiStakeState;
}): void {
  const { amount, valueToVerify, state } = params;
  const minEntry = state.config.minEntryStake;
  if (amount < minEntry) {
    throw new ShapeStateError(
      `Stake amount ${amount.toString()} is below validator minEntryStake ${minEntry.toString()}.`,
      {
        details: {
          amount: amount.toString(),
          minEntryStake: minEntry.toString()
        }
      }
    );
  }

  const type = state.config.entryGatingType;
  if (type === RETI_GATING_TYPE_NONE) {
    return;
  }

  if (type === RETI_GATING_TYPE_ASSET_ID) {
    if (valueToVerify <= 0n) {
      throw new ShapeStateError(
        "valueToVerify (gate ASA id) is required for this Réti validator.",
        { details: { gateAssetIds: state.gateAssetIds } }
      );
    }
    if (!state.gateAssetIds.includes(Number(valueToVerify))) {
      throw new ShapeStateError(
        `valueToVerify ${valueToVerify.toString()} is not an accepted gate ASA for this validator.`,
        { details: { gateAssetIds: state.gateAssetIds } }
      );
    }
    return;
  }

  if (valueToVerify <= 0n) {
    throw new ShapeStateError(
      "valueToVerify is required for this Réti validator's entry gate.",
      {
        details: {
          entryGatingType: type,
          gates: state.entryRequirements.gates ?? []
        }
      }
    );
  }
}

function readRegistryAppId(): number {
  const raw = process.env.RETI_VALIDATOR_REGISTRY_APP_ID?.trim();
  if (raw) {
    const value = Number(raw);
    if (Number.isInteger(value) && value >= 1) {
      return value;
    }
  }
  return RETI_VALIDATOR_REGISTRY_APP_ID;
}
