import { Algodv2 } from "algosdk";
import { prepareCommitTransactions } from "@tinymanorg/tinyman-js-sdk";
import type { SignerTransaction } from "@tinymanorg/tinyman-js-sdk";

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
import { validateFarmCommitTransactions } from "./farm-commit.js";
import {
  TinymanFarmState,
  parseFarmAddress,
  parseNonNegativeBaseUnitAmount,
  parseOptionalAssetId,
  parseOptionalPoolId,
  parseOptionalProgramAccount,
  parseOptionalProgramId,
  resolveTinymanFarmState
} from "./farm-state.js";

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "tinyman",
  protocolVersion: "staking-v1",
  action: "farm",
  variant: "uncommit"
};

export interface TinymanFarmUncommitInput {
  userAddress: string;
  /** Absolute commitment after this call; use 0 to fully uncommit. */
  commitAmount: bigint;
  programId?: number;
  programAccount?: string;
  requiredAssetId?: number;
  liquidityAssetId?: number;
  assetAId?: number;
  assetBId?: number;
  poolId?: string;
}

export interface TinymanFarmUncommitDependencies {
  resolveFarmState: typeof resolveTinymanFarmState;
  prepareCommitTransactions: (params: {
    client: Algodv2;
    stakingAppID: number;
    program: { accountAddress: string; id: number };
    liquidityAssetID: number;
    amount: bigint;
    initiatorAddr: string;
    requiredAssetID?: number;
  }) => Promise<SignerTransaction[]>;
}

let dependencyOverrides: Partial<TinymanFarmUncommitDependencies> | undefined;

export function setTinymanFarmUncommitDependenciesForTests(
  overrides?: Partial<TinymanFarmUncommitDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): TinymanFarmUncommitDependencies {
  return {
    resolveFarmState: resolveTinymanFarmState,
    prepareCommitTransactions: (params) => prepareCommitTransactions(params),
    ...dependencyOverrides
  };
}

export const tinymanFarmUncommitShape: TransactionShapeSpec<
  TinymanFarmUncommitInput,
  TinymanFarmState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Tinyman farm uncommit (lower or clear LP commitment)",
  description:
    "Lowers or clears a Tinyman farm commitment by re-calling prepareCommitTransactions with " +
    "an absolute commitment amount (typically 0 for a full uncommit). LP tokens stay in the " +
    "wallet; mid-cycle eligibility loss is a product caveat.",
  supportedOpportunityTypes: ["farm"],
  opportunityRole: "exit",
  requiredInputs: ["userAddress", "commitAmount"],
  sources: [
    {
      kind: "sdk",
      description:
        "@tinymanorg/tinyman-js-sdk prepareCommitTransactions (absolute commit amount; 0 = uncommit)"
    }
  ],

  parseInput(raw: unknown): TinymanFarmUncommitInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;

    const liquidityAssetId = parseOptionalAssetId(value.liquidityAssetId, "liquidityAssetId");
    const assetAId = parseOptionalAssetId(value.assetAId, "assetAId");
    const assetBId = parseOptionalAssetId(value.assetBId, "assetBId");

    if (liquidityAssetId === undefined && (assetAId === undefined || assetBId === undefined)) {
      throw new InvalidShapeInputError(
        "Provide liquidityAssetId, or both assetAId and assetBId to resolve the LP token."
      );
    }
    if (assetAId !== undefined && assetBId !== undefined && assetAId === assetBId) {
      throw new InvalidShapeInputError("assetAId and assetBId must be different assets.", {
        assetAId,
        assetBId
      });
    }
    const requiredAssetId = parseOptionalAssetId(value.requiredAssetId, "requiredAssetId");
    const poolId = parseOptionalPoolId(value.poolId);
    const programId = parseOptionalProgramId(value.programId);
    const programAccount = parseOptionalProgramAccount(value.programAccount);
    if ((programId === undefined) !== (programAccount === undefined)) {
      throw new InvalidShapeInputError(
        "programId and programAccount must be provided together when overriding farm program resolution."
      );
    }

    return {
      userAddress: parseFarmAddress(value.userAddress),
      commitAmount: parseNonNegativeBaseUnitAmount(value.commitAmount, "commitAmount"),
      ...(programId === undefined ? {} : { programId }),
      ...(programAccount === undefined ? {} : { programAccount }),
      ...(requiredAssetId === undefined ? {} : { requiredAssetId }),
      ...(liquidityAssetId === undefined ? {} : { liquidityAssetId }),
      ...(assetAId === undefined ? {} : { assetAId }),
      ...(assetBId === undefined ? {} : { assetBId }),
      ...(poolId === undefined ? {} : { poolId })
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: TinymanFarmUncommitInput
  ): Promise<TinymanFarmState> {
    const dependencies = resolveDependencies();
    return dependencies.resolveFarmState({
      network: context.network,
      algod: context.algod,
      userAddress: input.userAddress,
      ...(input.programId === undefined ? {} : { programId: input.programId }),
      ...(input.programAccount === undefined ? {} : { programAccount: input.programAccount }),
      ...(input.requiredAssetId === undefined ? {} : { requiredAssetId: input.requiredAssetId }),
      ...(input.liquidityAssetId === undefined ? {} : { liquidityAssetId: input.liquidityAssetId }),
      ...(input.assetAId === undefined ? {} : { assetAId: input.assetAId }),
      ...(input.assetBId === undefined ? {} : { assetBId: input.assetBId })
    });
  },

  async build(
    context: ShapeBuildContext,
    input: TinymanFarmUncommitInput,
    state: TinymanFarmState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings: string[] = [];

    if (input.commitAmount > state.userLpBalance) {
      warnings.push(
        `Target commitment (${input.commitAmount.toString()}) exceeds current wallet LP balance ` +
          `(${state.userLpBalance.toString()}); Tinyman requires the wallet to hold at least the ` +
          "committed amount while the farm commitment is active."
      );
    }
    if (input.commitAmount === 0n) {
      warnings.push(
        "commitAmount=0 fully clears the farm commitment. Mid-cycle uncommit may forfeit " +
          "unpaid farm rewards for the current cycle."
      );
    }

    let signerTxns: SignerTransaction[];
    try {
      signerTxns = await dependencies.prepareCommitTransactions({
        client: context.algod,
        stakingAppID: state.stakingAppId,
        program: { accountAddress: state.programAccount, id: state.programId },
        liquidityAssetID: state.liquidityAssetId,
        amount: input.commitAmount,
        initiatorAddr: input.userAddress,
        ...(state.requiredAssetId === undefined ? {} : { requiredAssetID: state.requiredAssetId })
      });
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Tinyman farm uncommit transactions.", {
        cause: error
      });
    }

    return {
      transactions: normalizeTransactions(signerTxns.map((signerTxn) => signerTxn.txn)),
      warnings,
      metadata: {
        stakingAppId: state.stakingAppId,
        programId: state.programId,
        programAccount: state.programAccount,
        liquidityAssetId: state.liquidityAssetId,
        commitAmount: input.commitAmount.toString(),
        userLpBalance: state.userLpBalance.toString(),
        includesLogBalance: state.requiredAssetId !== undefined,
        ...(state.requiredAssetId === undefined ? {} : { requiredAssetId: state.requiredAssetId }),
        ...(state.poolAddress === undefined ? {} : { poolAddress: state.poolAddress }),
        ...(input.poolId === undefined ? {} : { poolId: input.poolId })
      }
    };
  },

  validate(
    group,
    input: TinymanFarmUncommitInput,
    state: TinymanFarmState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const expectedCount = state.requiredAssetId === undefined ? 1 : 2;

    if (group.length !== expectedCount) {
      errors.push(`Expected exactly ${expectedCount} transaction(s), received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    validateFarmCommitTransactions({
      group,
      userAddress: input.userAddress,
      stakingAppId: state.stakingAppId,
      liquidityAssetId: state.liquidityAssetId,
      programAccount: state.programAccount,
      ...(state.requiredAssetId === undefined ? {} : { requiredAssetId: state.requiredAssetId }),
      errors
    });

    if (state.requiredAssetId !== undefined) {
      if (group.some((txn) => !txn.groupPresent)) {
        errors.push("All transactions must belong to a single atomic group.");
      }
    }

    if (input.commitAmount > state.userLpBalance) {
      warnings.push("Target commitment exceeds the current wallet LP balance.");
    }
    if (input.commitAmount === 0n) {
      warnings.push("Full uncommit (commitAmount=0).");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};
