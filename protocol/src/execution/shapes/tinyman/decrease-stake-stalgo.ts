import { Algodv2, Transaction } from "algosdk";
import { TinymanSTAlgoClient } from "@tinymanorg/tinyman-js-sdk";

import { InvalidShapeInputError, ShapeBuildError } from "../../errors.js";
import { normalizeTransactions } from "../../normalize-transaction.js";
import {
  ShapeBuildContext,
  ShapeBuildResult,
  ShapeValidationResult,
  TransactionShapeIdentity,
  TransactionShapeSpec,
  buildShapeKey
} from "../../types.js";
import {
  DECREASE_STAKE_APP_ARG,
  TinymanLiquidStakeState,
  assertAllGrouped,
  findAppCallByArg,
  parseLiquidStakeAddress,
  parseLiquidStakeAmount,
  resolveTinymanLiquidStakeState
} from "./liquid-stake-state.js";

const MIN_ALGO_FEE = 1000n;

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "tinyman",
  protocolVersion: "restake-v1",
  action: "decreaseStake",
  variant: "stAlgo"
};

export interface TinymanDecreaseStakeStAlgoInput {
  userAddress: string;
  amount: bigint;
}

export interface TinymanDecreaseStakeStAlgoDependencies {
  resolveState: typeof resolveTinymanLiquidStakeState;
  decreaseStake: (params: {
    algod: Algodv2;
    network: ShapeBuildContext["network"];
    amount: bigint;
    userAddress: string;
  }) => Promise<Transaction[]>;
}

let dependencyOverrides: Partial<TinymanDecreaseStakeStAlgoDependencies> | undefined;

export function setTinymanDecreaseStakeStAlgoDependenciesForTests(
  overrides?: Partial<TinymanDecreaseStakeStAlgoDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): TinymanDecreaseStakeStAlgoDependencies {
  return {
    resolveState: resolveTinymanLiquidStakeState,
    decreaseStake: async ({ algod, network, amount, userAddress }) => {
      const client = new TinymanSTAlgoClient(algod, network);
      return client.decreaseStake(amount, userAddress);
    },
    ...dependencyOverrides
  };
}

export const tinymanDecreaseStakeStAlgoShape: TransactionShapeSpec<
  TinymanDecreaseStakeStAlgoInput,
  TinymanLiquidStakeState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Tinyman restake decrease stALGO",
  description:
    "Unrestakes stALGO from Tinyman's restaking app and returns tALGO. Builds the SDK " +
    "decreaseStake group (optional rate-change / tALGO opt-in, decrease_stake app call) as " +
    "unsigned transactions.",
  supportedOpportunityTypes: ["staking"],
  opportunityRole: "exit",
  requiredInputs: ["userAddress", "amount"],
  sources: [
    {
      kind: "sdk",
      description: "@tinymanorg/tinyman-js-sdk TinymanSTAlgoClient.decreaseStake"
    }
  ],

  parseInput(raw: unknown): TinymanDecreaseStakeStAlgoInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    return {
      userAddress: parseLiquidStakeAddress(value.userAddress),
      amount: parseLiquidStakeAmount(value.amount)
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: TinymanDecreaseStakeStAlgoInput
  ): Promise<TinymanLiquidStakeState> {
    return resolveDependencies().resolveState({
      network: context.network,
      algod: context.algod,
      userAddress: input.userAddress
    });
  },

  async build(
    context: ShapeBuildContext,
    input: TinymanDecreaseStakeStAlgoInput,
    state: TinymanLiquidStakeState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings: string[] = [];

    if (input.amount > state.userStAlgoBalance) {
      warnings.push(
        `Requested decrease amount (${input.amount.toString()}) exceeds current wallet stALGO ` +
          `balance (${state.userStAlgoBalance.toString()}).`
      );
    }

    let transactions: Transaction[];
    try {
      transactions = await dependencies.decreaseStake({
        algod: context.algod,
        network: context.network,
        amount: input.amount,
        userAddress: input.userAddress
      });
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Tinyman stALGO decrease-stake transactions.", {
        cause: error
      });
    }

    return {
      transactions: normalizeTransactions(transactions),
      warnings,
      metadata: {
        restakeAppId: state.restakeAppId,
        restakeAppAddress: state.restakeAppAddress,
        tAlgoAssetId: state.tAlgoAssetId,
        stAlgoAssetId: state.stAlgoAssetId,
        amountIn: input.amount.toString(),
        includesApplyRateChange: state.needsApplyRateChange,
        includesTAlgoOptIn: state.needsTAlgoOptIn
      }
    };
  },

  validate(
    group,
    input: TinymanDecreaseStakeStAlgoInput,
    state: TinymanLiquidStakeState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const minCount = 1 + Number(state.needsApplyRateChange) + Number(state.needsTAlgoOptIn);
    if (group.length < minCount) {
      errors.push(`Expected at least ${minCount} transactions, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    const appTxn = findAppCallByArg(group, DECREASE_STAKE_APP_ARG);
    if (appTxn === undefined || !appTxn.applicationCall) {
      errors.push(`Group must include a "${DECREASE_STAKE_APP_ARG}" application call.`);
    } else {
      if (appTxn.sender !== input.userAddress) {
        errors.push("decrease_stake sender must be the user address.");
      }
      if (appTxn.applicationCall.appIndex !== String(state.restakeAppId)) {
        errors.push(`decrease_stake must call the Tinyman restake app (${state.restakeAppId}).`);
      }
      if (!appTxn.applicationCall.foreignAssets.includes(String(state.tAlgoAssetId))) {
        errors.push("decrease_stake foreign assets must include the tALGO asset id.");
      }
      if (!appTxn.applicationCall.foreignAssets.includes(String(state.stAlgoAssetId))) {
        errors.push("decrease_stake foreign assets must include the stALGO asset id.");
      }
      if (BigInt(appTxn.fee) < MIN_ALGO_FEE) {
        errors.push(
          `decrease_stake fee must be at least ${MIN_ALGO_FEE.toString()} microAlgos.`
        );
      }
    }

    assertAllGrouped(group, errors);

    if (input.amount > state.userStAlgoBalance) {
      warnings.push("Decrease amount exceeds the current wallet stALGO balance.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};
