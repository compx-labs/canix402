import { Algodv2 } from "algosdk";
import { prepareCommitTransactions } from "@tinymanorg/tinyman-js-sdk";
import type { SignerTransaction } from "@tinymanorg/tinyman-js-sdk";

import { InvalidShapeInputError, ShapeBuildError } from "../../errors.js";
import { normalizeTransactions } from "../../normalize-transaction.js";
import {
  ShapeBuildContext,
  ShapeBuildResult,
  ShapeValidationResult,
  SerializedTransaction,
  TransactionShapeIdentity,
  TransactionShapeSpec,
  buildShapeKey
} from "../../types.js";
import {
  COMMIT_APP_ARG,
  LOG_BALANCE_APP_ARG,
  TINYMAN_STAKING_COMMIT_NOTE_PREFIX,
  TinymanFarmState,
  parseAssetId,
  parseBaseUnitAmount,
  parseFarmAddress,
  parseOptionalAssetId,
  parseOptionalPoolId,
  parseOptionalProgramAccount,
  parseOptionalProgramId,
  resolveTinymanFarmState
} from "./farm-state.js";

const MIN_ALGO_FEE = 1000n;

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "tinyman",
  protocolVersion: "staking-v1",
  action: "farm",
  variant: "commit"
};

export interface TinymanFarmCommitInput {
  userAddress: string;
  commitAmount: bigint;
  programId?: number;
  programAccount?: string;
  requiredAssetId?: number;
  liquidityAssetId?: number;
  assetAId?: number;
  assetBId?: number;
  poolId?: string;
}

export interface TinymanFarmCommitDependencies {
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

let dependencyOverrides: Partial<TinymanFarmCommitDependencies> | undefined;

export function setTinymanFarmCommitDependenciesForTests(
  overrides?: Partial<TinymanFarmCommitDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): TinymanFarmCommitDependencies {
  return {
    resolveFarmState: resolveTinymanFarmState,
    prepareCommitTransactions: (params) => prepareCommitTransactions(params),
    ...dependencyOverrides
  };
}

export const tinymanFarmCommitShape: TransactionShapeSpec<
  TinymanFarmCommitInput,
  TinymanFarmState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Tinyman farm commit (existing LP position)",
  description:
    "Commits an existing Tinyman LP-token position to a Tinyman farm (staking program). " +
    "LP tokens never leave the wallet; the commit is a staking app call that records the " +
    "committed amount, optionally followed by a log_balance call for a required asset.",
  supportedOpportunityTypes: ["farm"],
  requiredInputs: ["userAddress", "commitAmount"],
  sources: [
    {
      kind: "sdk",
      description: "@tinymanorg/tinyman-js-sdk prepareCommitTransactions/getStakingAppID"
    }
  ],

  parseInput(raw: unknown): TinymanFarmCommitInput {
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
      commitAmount: parseBaseUnitAmount(value.commitAmount, "commitAmount"),
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
    input: TinymanFarmCommitInput
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
    input: TinymanFarmCommitInput,
    state: TinymanFarmState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings: string[] = [];

    if (input.commitAmount > state.userLpBalance) {
      warnings.push(
        `Committed amount (${input.commitAmount.toString()}) exceeds current wallet LP balance ` +
          `(${state.userLpBalance.toString()}); the commit is only valid while the wallet holds at ` +
          "least the committed amount."
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
      throw new ShapeBuildError("Failed to generate Tinyman farm commit transactions.", {
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
    input: TinymanFarmCommitInput,
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
      // Only the multi-transaction commit group is atomically grouped.
      if (group.some((txn) => !txn.groupPresent)) {
        errors.push("All transactions must belong to a single atomic group.");
      }
    }

    if (input.commitAmount > state.userLpBalance) {
      warnings.push("Committed amount exceeds the current wallet LP balance.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};

/**
 * Validate the commit transaction (and optional log_balance transaction) of a
 * Tinyman farm commit. `group` must contain only the commit-related
 * transactions: the commit at index 0 and, when a required asset is present,
 * the log_balance call at index 1.
 */
export function validateFarmCommitTransactions(params: {
  group: readonly SerializedTransaction[];
  userAddress: string;
  stakingAppId: number;
  liquidityAssetId: number;
  programAccount: string;
  requiredAssetId?: number;
  errors: string[];
}): void {
  const {
    group,
    userAddress,
    stakingAppId,
    liquidityAssetId,
    programAccount,
    requiredAssetId,
    errors
  } = params;

  validateCommitTxn({
    txn: group[0],
    userAddress,
    stakingAppId,
    liquidityAssetId,
    programAccount,
    errors
  });

  if (requiredAssetId !== undefined) {
    validateLogBalanceTxn({
      txn: group[1],
      userAddress,
      stakingAppId,
      requiredAssetId,
      errors
    });
  }
}

function validateCommitTxn(params: {
  txn: SerializedTransaction | undefined;
  userAddress: string;
  stakingAppId: number;
  liquidityAssetId: number;
  programAccount: string;
  errors: string[];
}): void {
  const { txn, userAddress, stakingAppId, liquidityAssetId, programAccount, errors } = params;
  if (txn === undefined || txn.type !== "appl" || !txn.applicationCall) {
    errors.push("Commit transaction must be a staking application call.");
    return;
  }
  const call = txn.applicationCall;
  if (txn.sender !== userAddress) {
    errors.push("Commit sender must be the user address.");
  }
  if (call.appIndex !== String(stakingAppId)) {
    errors.push(
      `Commit must call the Tinyman staking app (${stakingAppId}), got ${call.appIndex}.`
    );
  }
  if (call.appArgsText[0] !== COMMIT_APP_ARG) {
    errors.push(`Commit first app arg must be "${COMMIT_APP_ARG}".`);
  }
  if (!call.foreignAssets.includes(String(liquidityAssetId))) {
    errors.push("Commit foreign assets must include the LP token id.");
  }
  if (!call.accounts.includes(programAccount)) {
    errors.push("Commit accounts must include the farm program account.");
  }
  if (!hasStakingCommitNote(txn.noteBase64)) {
    errors.push(
      `Commit note must start with "${TINYMAN_STAKING_COMMIT_NOTE_PREFIX}".`
    );
  }
  if (BigInt(txn.fee) < MIN_ALGO_FEE) {
    errors.push(`Commit fee must be at least ${MIN_ALGO_FEE.toString()} microAlgos.`);
  }
}

function validateLogBalanceTxn(params: {
  txn: SerializedTransaction | undefined;
  userAddress: string;
  stakingAppId: number;
  requiredAssetId: number;
  errors: string[];
}): void {
  const { txn, userAddress, stakingAppId, requiredAssetId, errors } = params;
  if (txn === undefined || txn.type !== "appl" || !txn.applicationCall) {
    errors.push("log_balance transaction must be a staking application call.");
    return;
  }
  const call = txn.applicationCall;
  if (txn.sender !== userAddress) {
    errors.push("log_balance sender must be the user address.");
  }
  if (call.appIndex !== String(stakingAppId)) {
    errors.push("log_balance must call the Tinyman staking app.");
  }
  if (call.appArgsText[0] !== LOG_BALANCE_APP_ARG) {
    errors.push(`log_balance first app arg must be "${LOG_BALANCE_APP_ARG}".`);
  }
  if (!call.foreignAssets.includes(String(requiredAssetId))) {
    errors.push("log_balance foreign assets must include the required asset id.");
  }
}

function hasStakingCommitNote(noteBase64: string | undefined): boolean {
  if (noteBase64 === undefined) {
    return false;
  }
  try {
    const note = Buffer.from(noteBase64, "base64").toString("utf8");
    return note.startsWith(TINYMAN_STAKING_COMMIT_NOTE_PREFIX);
  } catch {
    return false;
  }
}
