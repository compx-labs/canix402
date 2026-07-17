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
  parseOptionalEscrowAppId,
  parseOptionalPoolId,
  requireEscrow,
  resolveFarmAppIdFromInput,
  resolvePactFarmState
} from "./farm-state.js";
import { normalizeSuggestedParamsForPact } from "./pool-state.js";

const MIN_ALGO_FEE = 1000n;

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "pact",
  protocolVersion: "v1",
  action: "farm",
  variant: "claimRewards"
};

export interface PactFarmClaimRewardsInput {
  userAddress: string;
  farmAppId: number;
  escrowAppId?: number;
  poolId?: string;
}

export interface PactFarmClaimRewardsDependencies {
  resolveFarmState: typeof resolvePactFarmState;
  buildClaimRewardsTx: (escrow: Escrow) => algosdk.Transaction;
  getSuggestedParams: (algod: Algodv2) => Promise<algosdk.SuggestedParams>;
  getAccountAssetIds: (algod: Algodv2, address: string) => Promise<Set<number>>;
}

let dependencyOverrides: Partial<PactFarmClaimRewardsDependencies> | undefined;

export function setPactFarmClaimRewardsDependenciesForTests(
  overrides?: Partial<PactFarmClaimRewardsDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): PactFarmClaimRewardsDependencies {
  return {
    resolveFarmState: resolvePactFarmState,
    buildClaimRewardsTx: (escrow) =>
      escrow.buildClaimRewardsTx() as unknown as algosdk.Transaction,
    getSuggestedParams: async (algod) => algod.getTransactionParams().do(),
    getAccountAssetIds,
    ...dependencyOverrides
  };
}

export const pactFarmClaimRewardsShape: TransactionShapeSpec<
  PactFarmClaimRewardsInput,
  PactFarmState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Pact farm claim rewards",
  description:
    "Claims accrued Pact farm reward ASAs into the wallet via the farm application, " +
    "using the user's farm escrow reference. User must already be opted into each reward asset.",
  supportedOpportunityTypes: ["farm"],
  opportunityRole: "manage",
  requiredInputs: ["userAddress", "farmAppId"],
  sources: [
    {
      kind: "sdk",
      description: "@pactfi/pactsdk Escrow.buildClaimRewardsTx / Farm.buildClaimRewardsTx"
    }
  ],

  parseInput(raw: unknown): PactFarmClaimRewardsInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    const escrowAppId = parseOptionalEscrowAppId(value.escrowAppId);
    const poolId = parseOptionalPoolId(value.poolId);
    return {
      userAddress: parseAddress(value.userAddress),
      farmAppId: resolveFarmAppIdFromInput(value),
      ...(escrowAppId === undefined ? {} : { escrowAppId }),
      ...(poolId === undefined ? {} : { poolId })
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: PactFarmClaimRewardsInput
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
    input: PactFarmClaimRewardsInput,
    state: PactFarmState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const escrow = requireEscrow(state);
    const warnings: string[] = [];

    const heldAssets = await dependencies.getAccountAssetIds(
      context.algod,
      input.userAddress
    );
    const missingOptIns = state.rewardAssetIds.filter(
      (assetId) => assetId !== 0 && !heldAssets.has(assetId)
    );
    if (missingOptIns.length > 0) {
      warnings.push(
        `Wallet is not opted into reward asset(s) ${missingOptIns.join(", ")}; claim may fail until those opt-ins exist.`
      );
    }

    const suggestedParams = normalizeSuggestedParamsForPact(
      await dependencies.getSuggestedParams(context.algod)
    );
    state.farm.setSuggestedParams(suggestedParams as never);
    escrow.setSuggestedParams(suggestedParams as never);

    let rawTxn: algosdk.Transaction;
    try {
      rawTxn = dependencies.buildClaimRewardsTx(escrow);
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Pact farm claim-rewards transaction.", {
        cause: error
      });
    }

    return {
      transactions: normalizeTransactions([rawTxn]),
      warnings,
      metadata: {
        farmAppId: state.farmAppId,
        escrowAppId: state.escrowAppId,
        escrowAddress: state.escrowAddress,
        rewardAssetIds: state.rewardAssetIds,
        userStaked: state.userStaked.toString(),
        missingRewardOptIns: missingOptIns,
        ...(input.poolId === undefined ? {} : { poolId: input.poolId })
      }
    };
  },

  validate(
    group,
    input: PactFarmClaimRewardsInput,
    state: PactFarmState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (group.length !== 1) {
      errors.push(`Expected exactly 1 transaction, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    if (state.escrowAppId === null) {
      errors.push("Resolved farm state is missing escrow app id.");
      return { valid: false, errors, warnings };
    }

    const claimTxn = group[0];
    if (claimTxn === undefined || claimTxn.type !== "appl" || !claimTxn.applicationCall) {
      errors.push("Claim transaction must be a farm application call.");
    } else {
      if (claimTxn.sender !== input.userAddress) {
        errors.push("Claim sender must be the user address.");
      }
      if (claimTxn.applicationCall.appIndex !== String(state.farmAppId)) {
        errors.push(
          `Claim must call farm app ${state.farmAppId}, got ${claimTxn.applicationCall.appIndex}.`
        );
      }
      if (!claimTxn.applicationCall.foreignApps.includes(String(state.escrowAppId))) {
        errors.push("Claim foreign apps must include the escrow app id.");
      }
      for (const rewardAssetId of state.rewardAssetIds) {
        if (!claimTxn.applicationCall.foreignAssets.includes(String(rewardAssetId))) {
          errors.push(
            `Claim foreign assets must include reward asset ${rewardAssetId}.`
          );
        }
      }
      if (!claimTxn.applicationCall.accounts.includes(input.userAddress)) {
        errors.push("Claim accounts must include the user address.");
      }
      if (BigInt(claimTxn.fee) < MIN_ALGO_FEE) {
        errors.push(`Claim fee must be at least ${MIN_ALGO_FEE.toString()} microAlgos.`);
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};

async function getAccountAssetIds(algod: Algodv2, address: string): Promise<Set<number>> {
  const account = await algod.accountInformation(address).do();
  const ids = new Set<number>([0]);
  for (const holding of account.assets ?? []) {
    ids.add(Number(holding.assetId));
  }
  return ids;
}
