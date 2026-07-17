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
import { normalizeSuggestedParamsForPact } from "./pool-state.js";
import { toSdkAmount } from "./parse-input.js";

const MIN_ALGO_FEE = 1000n;

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "pact",
  protocolVersion: "v1",
  action: "farm",
  variant: "stake"
};

export interface PactFarmStakeInput {
  userAddress: string;
  farmAppId: number;
  amount: bigint;
  escrowAppId?: number;
  poolId?: string;
}

export interface PactFarmStakeDependencies {
  resolveFarmState: typeof resolvePactFarmState;
  buildStakeTxs: (escrow: Escrow, amount: number) => algosdk.Transaction[];
  getSuggestedParams: (algod: Algodv2) => Promise<algosdk.SuggestedParams>;
}

let dependencyOverrides: Partial<PactFarmStakeDependencies> | undefined;

export function setPactFarmStakeDependenciesForTests(
  overrides?: Partial<PactFarmStakeDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): PactFarmStakeDependencies {
  return {
    resolveFarmState: resolvePactFarmState,
    buildStakeTxs: (escrow, amount) =>
      escrow.buildStakeTxs(amount) as unknown as algosdk.Transaction[],
    getSuggestedParams: async (algod) => algod.getTransactionParams().do(),
    ...dependencyOverrides
  };
}

export const pactFarmStakeShape: TransactionShapeSpec<
  PactFarmStakeInput,
  PactFarmState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Pact farm stake (existing LP into escrow)",
  description:
    "Stakes an existing Pact LP-token balance into a Pact farm escrow. LP tokens leave " +
    "the wallet via an ASA transfer to the user's farm escrow, followed by farm update " +
    "app call(s). Requires a previously deployed escrow (farm:deployEscrow).",
  supportedOpportunityTypes: ["farm"],
  opportunityRole: "enter",
  requiredInputs: ["userAddress", "farmAppId", "amount"],
  sources: [
    {
      kind: "sdk",
      description: "@pactfi/pactsdk Escrow.buildStakeTxs"
    },
    {
      kind: "docs",
      description: "Pact Escrow stake",
      url: "https://pactfi.github.io/pact-js-sdk/latest/classes/Escrow.html"
    }
  ],

  parseInput(raw: unknown): PactFarmStakeInput {
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
    input: PactFarmStakeInput
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
    input: PactFarmStakeInput,
    state: PactFarmState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const escrow = requireEscrow(state);
    const warnings: string[] = [];

    if (input.amount > state.userLpBalance) {
      throw new ShapeBuildError(
        `Requested stake amount (${input.amount.toString()}) exceeds wallet LP balance (${state.userLpBalance.toString()}).`
      );
    }

    const suggestedParams = normalizeSuggestedParamsForPact(
      await dependencies.getSuggestedParams(context.algod)
    );
    state.farm.setSuggestedParams(suggestedParams as never);
    escrow.setSuggestedParams(suggestedParams as never);

    let rawTxns: algosdk.Transaction[];
    try {
      rawTxns = dependencies.buildStakeTxs(
        escrow,
        toSdkAmount(input.amount, "amount")
      );
      algosdk.assignGroupID(rawTxns);
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Pact farm stake transactions.", {
        cause: error
      });
    }

    warnings.push(
      "LP tokens leave the wallet and are held in the Pact farm escrow until unstaked."
    );

    return {
      transactions: normalizeTransactions(rawTxns),
      warnings,
      metadata: {
        farmAppId: state.farmAppId,
        escrowAppId: state.escrowAppId,
        escrowAddress: state.escrowAddress,
        stakedAssetId: state.stakedAssetId,
        amount: input.amount.toString(),
        userLpBalance: state.userLpBalance.toString(),
        userStaked: state.userStaked.toString(),
        ...(input.poolId === undefined ? {} : { poolId: input.poolId })
      }
    };
  },

  validate(
    group,
    input: PactFarmStakeInput,
    state: PactFarmState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (group.length < 2) {
      errors.push(`Expected at least 2 transactions, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    if (state.escrowAddress === null || state.escrowAppId === null) {
      errors.push("Resolved farm state is missing escrow address/app id.");
      return { valid: false, errors, warnings };
    }

    const transferTxn = group[0];
    if (
      transferTxn === undefined ||
      transferTxn.type !== "axfer" ||
      !transferTxn.assetTransfer
    ) {
      errors.push("Transaction 1 must be the LP asset transfer into the farm escrow.");
    } else {
      if (transferTxn.sender !== input.userAddress) {
        errors.push("Transaction 1 sender must be the user address.");
      }
      if (transferTxn.assetTransfer.receiver !== state.escrowAddress) {
        errors.push("Transaction 1 receiver must be the farm escrow address.");
      }
      if (transferTxn.assetTransfer.assetIndex !== String(state.stakedAssetId)) {
        errors.push(
          `Transaction 1 asset must be the farm staked LP asset (${state.stakedAssetId}).`
        );
      }
      if (transferTxn.assetTransfer.amount !== input.amount.toString()) {
        errors.push("Transaction 1 amount must equal the requested stake amount.");
      }
    }

    const updateTxn = group[group.length - 1];
    if (updateTxn === undefined || updateTxn.type !== "appl" || !updateTxn.applicationCall) {
      errors.push("Final transaction must be the farm update application call.");
    } else {
      if (updateTxn.sender !== input.userAddress) {
        errors.push("Farm update sender must be the user address.");
      }
      if (updateTxn.applicationCall.appIndex !== String(state.farmAppId)) {
        errors.push(
          `Farm update must call farm app ${state.farmAppId}, got ${updateTxn.applicationCall.appIndex}.`
        );
      }
      if (!updateTxn.applicationCall.foreignApps.includes(String(state.escrowAppId))) {
        errors.push("Farm update foreign apps must include the escrow app id.");
      }
      if (!updateTxn.applicationCall.foreignAssets.includes(String(state.stakedAssetId))) {
        errors.push("Farm update foreign assets must include the staked LP asset id.");
      }
      if (!updateTxn.applicationCall.accounts.includes(state.escrowAddress)) {
        errors.push("Farm update accounts must include the escrow address.");
      }
      if (BigInt(updateTxn.fee) < MIN_ALGO_FEE) {
        errors.push(`Farm update fee must be at least ${MIN_ALGO_FEE.toString()} microAlgos.`);
      }
    }

    if (group.some((txn) => !txn.groupPresent)) {
      errors.push("All transactions must belong to a single atomic group.");
    }

    if (input.amount > state.userLpBalance) {
      warnings.push("Requested stake amount exceeds the current wallet LP balance.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};
