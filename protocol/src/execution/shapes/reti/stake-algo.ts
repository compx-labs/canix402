import algosdk, {
  Algodv2,
  AtomicTransactionComposer,
  Transaction,
  makeEmptyTransactionSigner
} from "algosdk";

import { InvalidShapeInputError, ShapeBuildError } from "../../errors.js";
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
  ADD_STAKE_METHOD,
  GAS_METHOD
} from "../../../reti/abi.js";
import { RETI_GATING_TYPE_ASSET_ID, RETI_GATING_TYPE_NONE } from "../../../reti/constants.js";
import {
  parseOptionalValueToVerify,
  parseRetiAddress,
  parseRetiPositiveAmount,
  parseRetiValidatorId
} from "./parse-input.js";
import {
  addAssetOptInToComposer,
  finalizeRetiComposerGroup,
  getSuggestedParams
} from "./shared.js";
import {
  assertStakeEligibility,
  resolveRetiStakeState,
  type RetiStakeState
} from "./stake-state.js";

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "reti",
  protocolVersion: "v1",
  action: "stake",
  variant: "algo"
};

export interface RetiStakeAlgoInput {
  userAddress: string;
  validatorId: number;
  amount: bigint;
  valueToVerify: bigint;
}

export interface RetiStakeAlgoDependencies {
  resolveState: typeof resolveRetiStakeState;
  getSuggestedParams: (algod: Algodv2) => Promise<algosdk.SuggestedParams>;
  finalizeComposerGroup: typeof finalizeRetiComposerGroup;
}

let dependencyOverrides: Partial<RetiStakeAlgoDependencies> | undefined;

export function setRetiStakeAlgoDependenciesForTests(
  overrides?: Partial<RetiStakeAlgoDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): RetiStakeAlgoDependencies {
  return {
    resolveState: resolveRetiStakeState,
    getSuggestedParams,
    finalizeComposerGroup: finalizeRetiComposerGroup,
    ...dependencyOverrides
  };
}

export const retiStakeAlgoShape: TransactionShapeSpec<
  RetiStakeAlgoInput,
  RetiStakeState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Réti ALGO stake to validator",
  description:
    "Stakes ALGO to a Réti validator via ValidatorRegistry.addStake. " +
    "The registry allocates into one of the validator's pools. " +
    "Builds gas ×2, ALGO payment to the registry, addStake, and optional reward-token opt-in. " +
    "Enforces minEntryStake, capacity, and entry gates at quote time.",
  supportedOpportunityTypes: ["staking"],
  opportunityRole: "enter",
  requiredInputs: ["userAddress", "validatorId", "amount"],
  sources: [
    {
      kind: "arc56",
      description:
        "algorandfoundation/reti ValidatorRegistry.addStake(pay,uint64,uint64)"
    }
  ],

  parseInput(raw: unknown): RetiStakeAlgoInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    return {
      userAddress: parseRetiAddress(value.userAddress),
      validatorId: parseRetiValidatorId(value.validatorId),
      amount: parseRetiPositiveAmount(value.amount),
      valueToVerify: parseOptionalValueToVerify(value.valueToVerify)
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: RetiStakeAlgoInput
  ): Promise<RetiStakeState> {
    return resolveDependencies().resolveState({
      network: context.network,
      algod: context.algod,
      userAddress: input.userAddress,
      validatorId: input.validatorId
    });
  },

  async build(
    context: ShapeBuildContext,
    input: RetiStakeAlgoInput,
    state: RetiStakeState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings: string[] = [];

    let valueToVerify = input.valueToVerify;
    if (
      valueToVerify <= 0n &&
      state.config.entryGatingType === RETI_GATING_TYPE_ASSET_ID &&
      state.gateAssetIds.length === 1
    ) {
      valueToVerify = BigInt(state.gateAssetIds[0]!);
    }

    assertStakeEligibility({
      amount: input.amount,
      valueToVerify,
      state
    });

    if (input.amount > state.userAlgoBalance) {
      warnings.push(
        `Requested stake (${input.amount.toString()}) exceeds wallet ALGO balance ` +
          `(${state.userAlgoBalance.toString()}).`
      );
    }

    let suggestedParams: algosdk.SuggestedParams;
    try {
      suggestedParams = await dependencies.getSuggestedParams(context.algod);
    } catch (error) {
      throw new ShapeBuildError("Failed to fetch suggested params for Réti stake.", {
        cause: error
      });
    }

    const atc = new AtomicTransactionComposer();
    const emptySigner = makeEmptyTransactionSigner();

    atc.addMethodCall({
      appID: state.registryAppId,
      method: GAS_METHOD,
      methodArgs: [],
      sender: input.userAddress,
      signer: emptySigner,
      suggestedParams,
      note: new TextEncoder().encode("1")
    });
    atc.addMethodCall({
      appID: state.registryAppId,
      method: GAS_METHOD,
      methodArgs: [],
      sender: input.userAddress,
      signer: emptySigner,
      suggestedParams,
      note: new TextEncoder().encode("2")
    });

    const paymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: input.userAddress,
      receiver: state.registryAddress,
      amount: input.amount,
      suggestedParams
    });

    atc.addMethodCall({
      appID: state.registryAppId,
      method: ADD_STAKE_METHOD,
      methodArgs: [
        { txn: paymentTxn, signer: emptySigner },
        BigInt(input.validatorId),
        valueToVerify
      ],
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
      throw new ShapeBuildError("Failed to generate Réti stake transactions.", {
        cause: error
      });
    }

    return {
      transactions: normalizeTransactions(rawTxns),
      warnings,
      metadata: {
        registryAppId: state.registryAppId,
        validatorId: input.validatorId,
        amount: input.amount.toString(),
        valueToVerify: valueToVerify.toString(),
        minEntryStake: state.config.minEntryStake.toString(),
        entryGatingType: state.config.entryGatingType,
        rewardTokenId: state.rewardTokenId
      }
    };
  },

  validate(
    group: SerializedTransaction[],
    input: RetiStakeAlgoInput,
    state: RetiStakeState
  ): ShapeValidationResult {
    const warnings: string[] = [];
    if (group.length < 3) {
      return {
        valid: false,
        errors: [
          `Expected at least 3 transactions (gas×2 + addStake), got ${group.length}.`
        ],
        warnings
      };
    }

    if (state.config.entryGatingType !== RETI_GATING_TYPE_NONE && input.valueToVerify <= 0n) {
      if (
        !(
          state.config.entryGatingType === RETI_GATING_TYPE_ASSET_ID &&
          state.gateAssetIds.length === 1
        )
      ) {
        warnings.push(
          "Gate requires valueToVerify; confirm the quoted group used a non-zero verify value."
        );
      }
    }

    return { valid: true, errors: [], warnings };
  }
};
