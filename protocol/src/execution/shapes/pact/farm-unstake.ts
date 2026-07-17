import algosdk, { Algodv2 } from "algosdk";
import type { Escrow } from "@pactfi/pactsdk";

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
  PactFarmState,
  parseAddress,
  parseBaseUnitAmount,
  parseOptionalEscrowAppId,
  parseOptionalPoolId,
  requireEscrow,
  resolveFarmAppIdFromInput,
  resolvePactFarmState
} from "./farm-state.js";
import { toSdkAmount } from "./parse-input.js";
import { normalizeSuggestedParamsForPact } from "./pool-state.js";

const MIN_ALGO_FEE = 1000n;

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "pact",
  protocolVersion: "v1",
  action: "farm",
  variant: "unstake"
};

export interface PactFarmUnstakeInput {
  userAddress: string;
  farmAppId: number;
  amount: bigint;
  escrowAppId?: number;
  poolId?: string;
}

export interface PactFarmUnstakeDependencies {
  resolveFarmState: typeof resolvePactFarmState;
  buildUnstakeTxs: (escrow: Escrow, amount: number) => algosdk.Transaction[];
  getSuggestedParams: (algod: Algodv2) => Promise<algosdk.SuggestedParams>;
}

let dependencyOverrides: Partial<PactFarmUnstakeDependencies> | undefined;

export function setPactFarmUnstakeDependenciesForTests(
  overrides?: Partial<PactFarmUnstakeDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): PactFarmUnstakeDependencies {
  return {
    resolveFarmState: resolvePactFarmState,
    buildUnstakeTxs: (escrow, amount) =>
      escrow.buildUnstakeTxs(amount) as unknown as algosdk.Transaction[],
    getSuggestedParams: async (algod) => algod.getTransactionParams().do(),
    ...dependencyOverrides
  };
}

export const pactFarmUnstakeShape: TransactionShapeSpec<
  PactFarmUnstakeInput,
  PactFarmState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Pact farm unstake (return LP from escrow)",
  description:
    "Unstakes LP tokens from a Pact farm escrow back to the wallet. Calls the user's " +
    "escrow application, which returns the staked LP ASA to the user.",
  supportedOpportunityTypes: ["farm"],
  opportunityRole: "exit",
  requiredInputs: ["userAddress", "farmAppId", "amount"],
  sources: [
    {
      kind: "sdk",
      description: "@pactfi/pactsdk Escrow.buildUnstakeTxs"
    }
  ],

  parseInput(raw: unknown): PactFarmUnstakeInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    const escrowAppId = parseOptionalEscrowAppId(value.escrowAppId);
    const poolId = parseOptionalPoolId(value.poolId);
    return {
      userAddress: parseAddress(value.userAddress),
      farmAppId: resolveFarmAppIdFromInput(value),
      amount: parseBaseUnitAmount(value.amount, "amount"),
      ...(escrowAppId === undefined ? {} : { escrowAppId }),
      ...(poolId === undefined ? {} : { poolId })
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: PactFarmUnstakeInput
  ): Promise<PactFarmState> {
    const dependencies = resolveDependencies();
    return dependencies.resolveFarmState({
      network: context.network,
      algod: context.algod,
      userAddress: input.userAddress,
      farmAppId: input.farmAppId,
      ...(input.escrowAppId === undefined ? {} : { escrowAppId: input.escrowAppId })
    });
  },

  async build(
    context: ShapeBuildContext,
    input: PactFarmUnstakeInput,
    state: PactFarmState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const escrow = requireEscrow(state);

    if (input.amount > state.userStaked) {
      throw new ShapeBuildError(
        `Requested unstake amount (${input.amount.toString()}) exceeds farm staked balance (${state.userStaked.toString()}).`
      );
    }

    const suggestedParams = normalizeSuggestedParamsForPact(
      await dependencies.getSuggestedParams(context.algod)
    );
    state.farm.setSuggestedParams(suggestedParams as never);
    escrow.setSuggestedParams(suggestedParams as never);

    let rawTxns: algosdk.Transaction[];
    try {
      rawTxns = dependencies.buildUnstakeTxs(
        escrow,
        toSdkAmount(input.amount, "amount")
      );
      algosdk.assignGroupID(rawTxns);
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Pact farm unstake transactions.", {
        cause: error
      });
    }

    return {
      transactions: normalizeTransactions(rawTxns),
      warnings: [],
      metadata: {
        farmAppId: state.farmAppId,
        escrowAppId: state.escrowAppId,
        escrowAddress: state.escrowAddress,
        stakedAssetId: state.stakedAssetId,
        amount: input.amount.toString(),
        userStaked: state.userStaked.toString(),
        ...(input.poolId === undefined ? {} : { poolId: input.poolId })
      }
    };
  },

  validate(
    group,
    input: PactFarmUnstakeInput,
    state: PactFarmState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (group.length < 1) {
      errors.push(`Expected at least 1 transaction, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    if (state.escrowAppId === null) {
      errors.push("Resolved farm state is missing escrow app id.");
      return { valid: false, errors, warnings };
    }

    const unstakeTxn = group[group.length - 1];
    if (
      unstakeTxn === undefined ||
      unstakeTxn.type !== "appl" ||
      !unstakeTxn.applicationCall
    ) {
      errors.push("Final transaction must be the escrow unstake application call.");
    } else {
      if (unstakeTxn.sender !== input.userAddress) {
        errors.push("Unstake sender must be the user address.");
      }
      if (unstakeTxn.applicationCall.appIndex !== String(state.escrowAppId)) {
        errors.push(
          `Unstake must call escrow app ${state.escrowAppId}, got ${unstakeTxn.applicationCall.appIndex}.`
        );
      }
      if (!unstakeTxn.applicationCall.foreignApps.includes(String(state.farmAppId))) {
        errors.push("Unstake foreign apps must include the farm app id.");
      }
      if (!unstakeTxn.applicationCall.foreignAssets.includes(String(state.stakedAssetId))) {
        errors.push("Unstake foreign assets must include the staked LP asset id.");
      }
      if (BigInt(unstakeTxn.fee) < MIN_ALGO_FEE) {
        errors.push(`Unstake fee must be at least ${MIN_ALGO_FEE.toString()} microAlgos.`);
      }
    }

    if (group.length > 1 && group.some((txn) => !txn.groupPresent)) {
      errors.push("All transactions must belong to a single atomic group.");
    }

    if (input.amount > state.userStaked) {
      warnings.push("Requested unstake amount exceeds the resolved farm staked balance.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};
