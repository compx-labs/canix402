import { Algodv2, Transaction } from "algosdk";
import { TinymanTAlgoClient } from "@tinymanorg/tinyman-js-sdk";

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
  BURN_APP_ARG,
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
  protocolVersion: "liquid-stake-v1",
  action: "burn",
  variant: "tAlgo"
};

export interface TinymanBurnTAlgoInput {
  userAddress: string;
  amount: bigint;
}

export interface TinymanBurnTAlgoDependencies {
  resolveState: typeof resolveTinymanLiquidStakeState;
  burn: (params: {
    algod: Algodv2;
    network: ShapeBuildContext["network"];
    amount: bigint;
    userAddress: string;
  }) => Promise<Transaction[]>;
}

let dependencyOverrides: Partial<TinymanBurnTAlgoDependencies> | undefined;

export function setTinymanBurnTAlgoDependenciesForTests(
  overrides?: Partial<TinymanBurnTAlgoDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): TinymanBurnTAlgoDependencies {
  return {
    resolveState: resolveTinymanLiquidStakeState,
    burn: async ({ algod, network, amount, userAddress }) => {
      const client = new TinymanTAlgoClient(algod, network);
      return client.burn(amount, userAddress);
    },
    ...dependencyOverrides
  };
}

export const tinymanBurnTAlgoShape: TransactionShapeSpec<
  TinymanBurnTAlgoInput,
  TinymanLiquidStakeState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Tinyman liquid stake burn tALGO",
  description:
    "Burns tALGO to redeem ALGO from Tinyman's liquid-staking app. Builds the SDK burn " +
    "group (tALGO transfer, burn app call) as unsigned transactions.",
  supportedOpportunityTypes: ["staking"],
  opportunityRole: "exit",
  requiredInputs: ["userAddress", "amount"],
  sources: [
    {
      kind: "sdk",
      description: "@tinymanorg/tinyman-js-sdk TinymanTAlgoClient.burn"
    }
  ],

  parseInput(raw: unknown): TinymanBurnTAlgoInput {
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
    input: TinymanBurnTAlgoInput
  ): Promise<TinymanLiquidStakeState> {
    return resolveDependencies().resolveState({
      network: context.network,
      algod: context.algod,
      userAddress: input.userAddress
    });
  },

  async build(
    context: ShapeBuildContext,
    input: TinymanBurnTAlgoInput,
    state: TinymanLiquidStakeState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings: string[] = [];

    if (input.amount > state.userTAlgoBalance) {
      warnings.push(
        `Requested burn amount (${input.amount.toString()}) exceeds current wallet tALGO balance ` +
          `(${state.userTAlgoBalance.toString()}).`
      );
    }

    let transactions: Transaction[];
    try {
      transactions = await dependencies.burn({
        algod: context.algod,
        network: context.network,
        amount: input.amount,
        userAddress: input.userAddress
      });
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Tinyman tALGO burn transactions.", {
        cause: error
      });
    }

    const expectedAlgoOut =
      state.algoToTAlgoRatio > 0 && Number.isFinite(state.algoToTAlgoRatio)
        ? BigInt(Math.floor(Number(input.amount) * state.algoToTAlgoRatio))
        : 0n;

    return {
      transactions: normalizeTransactions(transactions),
      warnings,
      metadata: {
        stakeAppId: state.stakeAppId,
        stakeAppAddress: state.stakeAppAddress,
        tAlgoAssetId: state.tAlgoAssetId,
        amountIn: input.amount.toString(),
        expectedAlgoOut: expectedAlgoOut.toString(),
        algoToTAlgoRatio: state.algoToTAlgoRatio
      }
    };
  },

  validate(
    group,
    input: TinymanBurnTAlgoInput,
    state: TinymanLiquidStakeState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (group.length < 2) {
      errors.push(`Expected at least 2 transactions, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    const burnTxn = findAppCallByArg(group, BURN_APP_ARG);
    if (burnTxn === undefined || !burnTxn.applicationCall) {
      errors.push(`Group must include a "${BURN_APP_ARG}" application call.`);
    } else {
      if (burnTxn.sender !== input.userAddress) {
        errors.push("Burn sender must be the user address.");
      }
      if (burnTxn.applicationCall.appIndex !== String(state.stakeAppId)) {
        errors.push(`Burn must call the Tinyman stake app (${state.stakeAppId}).`);
      }
      if (BigInt(burnTxn.fee) < MIN_ALGO_FEE) {
        errors.push(`Burn fee must be at least ${MIN_ALGO_FEE.toString()} microAlgos.`);
      }
    }

    const transfer = group.find(
      (txn) =>
        txn.type === "axfer" &&
        txn.assetTransfer?.assetIndex === String(state.tAlgoAssetId) &&
        txn.assetTransfer.receiver === state.stakeAppAddress &&
        txn.assetTransfer.amount === input.amount.toString()
    );
    if (transfer === undefined) {
      errors.push("Group must include a tALGO transfer to the stake app for the burn amount.");
    } else if (transfer.sender !== input.userAddress) {
      errors.push("Burn transfer sender must be the user address.");
    }

    assertAllGrouped(group, errors);

    if (input.amount > state.userTAlgoBalance) {
      warnings.push("Burn amount exceeds the current wallet tALGO balance.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};
