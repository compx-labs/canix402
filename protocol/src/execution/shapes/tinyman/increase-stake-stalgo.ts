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
  INCREASE_STAKE_APP_ARG,
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
  action: "increaseStake",
  variant: "stAlgo"
};

export interface TinymanIncreaseStakeStAlgoInput {
  userAddress: string;
  amount: bigint;
}

export interface TinymanIncreaseStakeStAlgoDependencies {
  resolveState: typeof resolveTinymanLiquidStakeState;
  increaseStake: (params: {
    algod: Algodv2;
    network: ShapeBuildContext["network"];
    amount: bigint;
    userAddress: string;
  }) => Promise<Transaction[]>;
}

let dependencyOverrides: Partial<TinymanIncreaseStakeStAlgoDependencies> | undefined;

export function setTinymanIncreaseStakeStAlgoDependenciesForTests(
  overrides?: Partial<TinymanIncreaseStakeStAlgoDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): TinymanIncreaseStakeStAlgoDependencies {
  return {
    resolveState: resolveTinymanLiquidStakeState,
    increaseStake: async ({ algod, network, amount, userAddress }) => {
      const client = new TinymanSTAlgoClient(algod, network);
      return client.increaseStake(amount, userAddress);
    },
    ...dependencyOverrides
  };
}

export const tinymanIncreaseStakeStAlgoShape: TransactionShapeSpec<
  TinymanIncreaseStakeStAlgoInput,
  TinymanLiquidStakeState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Tinyman restake increase stALGO",
  description:
    "Restakes tALGO into Tinyman's restaking app and mints stALGO. Builds the SDK " +
    "increaseStake group (optional rate-change / box MBR / stALGO opt-in, tALGO transfer, " +
    "increase_stake app call) as unsigned transactions.",
  supportedOpportunityTypes: ["staking"],
  requiredInputs: ["userAddress", "amount"],
  sources: [
    {
      kind: "sdk",
      description: "@tinymanorg/tinyman-js-sdk TinymanSTAlgoClient.increaseStake"
    }
  ],

  parseInput(raw: unknown): TinymanIncreaseStakeStAlgoInput {
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
    input: TinymanIncreaseStakeStAlgoInput
  ): Promise<TinymanLiquidStakeState> {
    return resolveDependencies().resolveState({
      network: context.network,
      algod: context.algod,
      userAddress: input.userAddress
    });
  },

  async build(
    context: ShapeBuildContext,
    input: TinymanIncreaseStakeStAlgoInput,
    state: TinymanLiquidStakeState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings: string[] = [];

    if (input.amount > state.userTAlgoBalance) {
      warnings.push(
        `Requested restake amount (${input.amount.toString()}) exceeds current wallet tALGO ` +
          `balance (${state.userTAlgoBalance.toString()}).`
      );
    }

    let transactions: Transaction[];
    try {
      transactions = await dependencies.increaseStake({
        algod: context.algod,
        network: context.network,
        amount: input.amount,
        userAddress: input.userAddress
      });
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Tinyman stALGO increase-stake transactions.", {
        cause: error
      });
    }

    return {
      transactions: normalizeTransactions(transactions),
      warnings,
      metadata: {
        restakeAppId: state.restakeAppId,
        restakeAppAddress: state.restakeAppAddress,
        vaultAppId: state.vaultAppId,
        tAlgoAssetId: state.tAlgoAssetId,
        stAlgoAssetId: state.stAlgoAssetId,
        amountIn: input.amount.toString(),
        includesApplyRateChange: state.needsApplyRateChange,
        includesUserBoxPayment: state.needsUserBoxPayment,
        includesStAlgoOptIn: state.needsStAlgoOptIn
      }
    };
  },

  validate(
    group,
    input: TinymanIncreaseStakeStAlgoInput,
    state: TinymanLiquidStakeState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const minCount =
      2 +
      Number(state.needsApplyRateChange) +
      Number(state.needsUserBoxPayment) +
      Number(state.needsStAlgoOptIn);
    if (group.length < minCount) {
      errors.push(`Expected at least ${minCount} transactions, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    const appTxn = findAppCallByArg(group, INCREASE_STAKE_APP_ARG);
    if (appTxn === undefined || !appTxn.applicationCall) {
      errors.push(`Group must include an "${INCREASE_STAKE_APP_ARG}" application call.`);
    } else {
      if (appTxn.sender !== input.userAddress) {
        errors.push("increase_stake sender must be the user address.");
      }
      if (appTxn.applicationCall.appIndex !== String(state.restakeAppId)) {
        errors.push(`increase_stake must call the Tinyman restake app (${state.restakeAppId}).`);
      }
      if (!appTxn.applicationCall.foreignAssets.includes(String(state.stAlgoAssetId))) {
        errors.push("increase_stake foreign assets must include the stALGO asset id.");
      }
      if (!appTxn.applicationCall.foreignApps.includes(String(state.vaultAppId))) {
        errors.push("increase_stake foreign apps must include the Tinyman vault app.");
      }
      if (BigInt(appTxn.fee) < MIN_ALGO_FEE) {
        errors.push(
          `increase_stake fee must be at least ${MIN_ALGO_FEE.toString()} microAlgos.`
        );
      }
    }

    const transfer = group.find(
      (txn) =>
        txn.type === "axfer" &&
        txn.assetTransfer?.assetIndex === String(state.tAlgoAssetId) &&
        txn.assetTransfer.receiver === state.restakeAppAddress &&
        txn.assetTransfer.amount === input.amount.toString()
    );
    if (transfer === undefined) {
      errors.push(
        "Group must include a tALGO transfer to the restake app for the increase amount."
      );
    } else if (transfer.sender !== input.userAddress) {
      errors.push("increase_stake transfer sender must be the user address.");
    }

    assertAllGrouped(group, errors);

    if (input.amount > state.userTAlgoBalance) {
      warnings.push("Restake amount exceeds the current wallet tALGO balance.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};
