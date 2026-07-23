import algosdk, {
  Algodv2,
  AtomicTransactionComposer,
  Transaction,
  makeEmptyTransactionSigner
} from "algosdk";

import { InvalidShapeInputError, ShapeBuildError, ShapeStateError } from "../../errors.js";
import { normalizeTransactions } from "../../normalize-transaction.js";
import {
  ShapeBuildContext,
  ShapeBuildResult,
  ShapeValidationResult,
  TransactionShapeIdentity,
  TransactionShapeSpec,
  buildShapeKey,
  type SerializedTransaction
} from "../../types.js";
import {
  GAS_METHOD,
  REMOVE_STAKE_METHOD,
  retiGetStakerInfo,
  retiGetValidatorConfig
} from "../../../reti/abi.js";
import { RETI_VALIDATOR_REGISTRY_APP_ID } from "../../../reti/constants.js";
import {
  parseRetiAddress,
  parseRetiPoolAppId,
  parseRetiPositiveAmount,
  parseRetiValidatorId
} from "./parse-input.js";
import {
  addAssetOptInToComposer,
  finalizeRetiComposerGroup,
  getSuggestedParams
} from "./shared.js";

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "reti",
  protocolVersion: "v1",
  action: "unstake",
  variant: "algo"
};

export interface RetiUnstakeAlgoInput {
  userAddress: string;
  validatorId: number;
  poolAppId: number;
  amount: bigint;
}

export interface RetiUnstakeState {
  validatorId: number;
  poolAppId: number;
  stakedBalance: bigint;
  minEntryStake: bigint;
  rewardTokenId: number;
  userOptedIntoRewardToken: boolean;
}

export interface RetiUnstakeAlgoDependencies {
  resolveState: (params: {
    algod: Algodv2;
    userAddress: string;
    validatorId: number;
    poolAppId: number;
  }) => Promise<RetiUnstakeState>;
  getSuggestedParams: (algod: Algodv2) => Promise<algosdk.SuggestedParams>;
  finalizeComposerGroup: typeof finalizeRetiComposerGroup;
}

let dependencyOverrides: Partial<RetiUnstakeAlgoDependencies> | undefined;

export function setRetiUnstakeAlgoDependenciesForTests(
  overrides?: Partial<RetiUnstakeAlgoDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): RetiUnstakeAlgoDependencies {
  return {
    resolveState: defaultResolveUnstakeState,
    getSuggestedParams,
    finalizeComposerGroup: finalizeRetiComposerGroup,
    ...dependencyOverrides
  };
}

async function defaultResolveUnstakeState(params: {
  algod: Algodv2;
  userAddress: string;
  validatorId: number;
  poolAppId: number;
}): Promise<RetiUnstakeState> {
  const registryAppId = readRegistryAppId();
  let config;
  let stakerInfo;
  try {
    [config, stakerInfo] = await Promise.all([
      retiGetValidatorConfig(params.algod, params.validatorId, registryAppId),
      retiGetStakerInfo(params.algod, params.poolAppId, params.userAddress)
    ]);
  } catch (error) {
    throw new ShapeStateError("Failed to fetch Réti unstake state.", {
      details: {
        validatorId: params.validatorId,
        poolAppId: params.poolAppId
      },
      cause: error
    });
  }

  if (stakerInfo.balance <= 0n) {
    throw new ShapeStateError("No Réti stake found for this staker in the pool.", {
      details: {
        validatorId: params.validatorId,
        poolAppId: params.poolAppId
      }
    });
  }

  const rewardTokenId = Number(config.rewardTokenId);
  let userOptedIntoRewardToken = true;
  if (rewardTokenId > 0) {
    const account = await params.algod.accountInformation(params.userAddress).do();
    userOptedIntoRewardToken = (account.assets ?? []).some(
      (asset) => Number(asset.assetId) === rewardTokenId
    );
  }

  return {
    validatorId: params.validatorId,
    poolAppId: params.poolAppId,
    stakedBalance: stakerInfo.balance,
    minEntryStake: config.minEntryStake,
    rewardTokenId,
    userOptedIntoRewardToken
  };
}

export const retiUnstakeAlgoShape: TransactionShapeSpec<
  RetiUnstakeAlgoInput,
  RetiUnstakeState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Réti ALGO unstake from pool",
  description:
    "Removes ALGO stake from a Réti staking pool via StakingPool.removeStake. " +
    "Builds gas ×2, removeStake, and optional reward-token opt-in. " +
    "Partial unstake must leave at least minEntryStake (or unstake the full balance).",
  supportedOpportunityTypes: ["staking"],
  opportunityRole: "exit",
  requiredInputs: ["userAddress", "validatorId", "poolAppId", "amount"],
  sources: [
    {
      kind: "arc56",
      description:
        "algorandfoundation/reti StakingPool.removeStake(address,uint64)void"
    }
  ],

  parseInput(raw: unknown): RetiUnstakeAlgoInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    return {
      userAddress: parseRetiAddress(value.userAddress),
      validatorId: parseRetiValidatorId(value.validatorId),
      poolAppId: parseRetiPoolAppId(value.poolAppId),
      amount: parseRetiPositiveAmount(value.amount)
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: RetiUnstakeAlgoInput
  ): Promise<RetiUnstakeState> {
    return resolveDependencies().resolveState({
      algod: context.algod,
      userAddress: input.userAddress,
      validatorId: input.validatorId,
      poolAppId: input.poolAppId
    });
  },

  async build(
    context: ShapeBuildContext,
    input: RetiUnstakeAlgoInput,
    state: RetiUnstakeState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings: string[] = [];

    if (input.amount > state.stakedBalance) {
      throw new ShapeStateError(
        `Unstake amount ${input.amount.toString()} exceeds staked balance ${state.stakedBalance.toString()}.`,
        {
          details: {
            amount: input.amount.toString(),
            stakedBalance: state.stakedBalance.toString()
          }
        }
      );
    }

    const remaining = state.stakedBalance - input.amount;
    if (remaining > 0n && remaining < state.minEntryStake) {
      throw new ShapeStateError(
        `Partial unstake would leave ${remaining.toString()} below minEntryStake ${state.minEntryStake.toString()}. ` +
          "Unstake the full balance instead.",
        {
          details: {
            remaining: remaining.toString(),
            minEntryStake: state.minEntryStake.toString()
          }
        }
      );
    }

    let suggestedParams: algosdk.SuggestedParams;
    try {
      suggestedParams = await dependencies.getSuggestedParams(context.algod);
    } catch (error) {
      throw new ShapeBuildError("Failed to fetch suggested params for Réti unstake.", {
        cause: error
      });
    }

    const atc = new AtomicTransactionComposer();
    const emptySigner = makeEmptyTransactionSigner();

    atc.addMethodCall({
      appID: input.poolAppId,
      method: GAS_METHOD,
      methodArgs: [],
      sender: input.userAddress,
      signer: emptySigner,
      suggestedParams,
      note: new TextEncoder().encode("1")
    });
    atc.addMethodCall({
      appID: input.poolAppId,
      method: GAS_METHOD,
      methodArgs: [],
      sender: input.userAddress,
      signer: emptySigner,
      suggestedParams,
      note: new TextEncoder().encode("2")
    });
    atc.addMethodCall({
      appID: input.poolAppId,
      method: REMOVE_STAKE_METHOD,
      methodArgs: [input.userAddress, input.amount],
      sender: input.userAddress,
      signer: emptySigner,
      suggestedParams
    });

    if (state.rewardTokenId > 0 && !state.userOptedIntoRewardToken) {
      addAssetOptInToComposer({
        atc,
        sender: input.userAddress,
        assetId: state.rewardTokenId,
        suggestedParams
      });
      warnings.push(
        `Wallet is not opted into reward ASA ${state.rewardTokenId}; opt-in included in group.`
      );
    }

    let rawTxns: Transaction[];
    try {
      rawTxns = await dependencies.finalizeComposerGroup({
        algod: context.algod,
        atc
      });
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Réti unstake transactions.", {
        cause: error
      });
    }

    return {
      transactions: normalizeTransactions(rawTxns),
      warnings,
      metadata: {
        validatorId: input.validatorId,
        poolAppId: input.poolAppId,
        amount: input.amount.toString(),
        stakedBalance: state.stakedBalance.toString(),
        rewardTokenId: state.rewardTokenId
      }
    };
  },

  validate(
    group: SerializedTransaction[],
    _input: RetiUnstakeAlgoInput,
    _state: RetiUnstakeState
  ): ShapeValidationResult {
    if (group.length < 3) {
      return {
        valid: false,
        errors: [
          `Expected at least 3 transactions (gas×2 + removeStake), got ${group.length}.`
        ],
        warnings: []
      };
    }
    return { valid: true, errors: [], warnings: [] };
  }
};

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
