import { Transaction } from "algosdk";

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
  MythDualStakeState,
  buildMythRedeemTransactions,
  parseMythAddress,
  parseMythAmount,
  parseMythAppId,
  resolveMythDualStakeState
} from "./dualstake-state.js";

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "myth-finance",
  protocolVersion: "dualstake-v1",
  action: "redeem",
  variant: "lst"
};

export interface MythRedeemLstInput {
  userAddress: string;
  amount: bigint;
  appId: number;
}

export interface MythRedeemLstDependencies {
  resolveState: typeof resolveMythDualStakeState;
  buildRedeem: typeof buildMythRedeemTransactions;
}

let dependencyOverrides: Partial<MythRedeemLstDependencies> | undefined;

export function setMythRedeemLstDependenciesForTests(
  overrides?: Partial<MythRedeemLstDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): MythRedeemLstDependencies {
  return {
    resolveState: resolveMythDualStakeState,
    buildRedeem: buildMythRedeemTransactions,
    ...dependencyOverrides
  };
}

export const mythFinanceRedeemLstShape: TransactionShapeSpec<
  MythRedeemLstInput,
  MythDualStakeState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Myth Finance dualSTAKE redeem LST",
  description:
    "Redeems a Myth Finance dualSTAKE liquid-staking token for mostly ALGO plus a small " +
    "amount of the paired ASA (not 1:1 ALGO). " +
    "Builds an unsigned group: optional ASA opt-in, LST transfer, redeem app call.",
  supportedOpportunityTypes: ["staking", "farm"],
  opportunityRole: "exit",
  requiredInputs: ["userAddress", "amount", "appId"],
  sources: [
    {
      kind: "sdk",
      description:
        "@myth-finance/dualstake-ts-sdk DualStakeClient redeem app call + algosdk v3 axfer builders"
    }
  ],

  parseInput(raw: unknown): MythRedeemLstInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    const appIdRaw = value.appId ?? value.poolAppId;
    return {
      userAddress: parseMythAddress(value.userAddress),
      amount: parseMythAmount(value.amount),
      appId: parseMythAppId(appIdRaw)
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: MythRedeemLstInput
  ): Promise<MythDualStakeState> {
    return resolveDependencies().resolveState({
      network: context.network,
      algod: context.algod,
      userAddress: input.userAddress,
      appId: input.appId
    });
  },

  async build(
    context: ShapeBuildContext,
    input: MythRedeemLstInput,
    state: MythDualStakeState
  ): Promise<ShapeBuildResult> {
    const warnings: string[] = [];

    if (input.amount > state.userLstBalance) {
      warnings.push(
        `Requested redeem amount (${input.amount.toString()}) exceeds wallet LST balance ` +
          `(${state.userLstBalance.toString()} of asset ${state.lstId}).`
      );
    }

    let transactions: Transaction[];
    try {
      transactions = await resolveDependencies().buildRedeem({
        algod: context.algod,
        userAddress: input.userAddress,
        appId: input.appId,
        lstAmount: input.amount,
        state
      });
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Myth Finance redeem transactions.", {
        cause: error
      });
    }

    return {
      transactions: normalizeTransactions(transactions),
      warnings,
      metadata: {
        appId: state.appId,
        asaId: state.asaId,
        lstId: state.lstId,
        lstName: state.lstName,
        expectedAlgoOut: input.amount.toString(),
        includesAsaOptIn: state.needsAsaOptIn,
        rate: state.rate.toString()
      }
    };
  },

  validate(
    group: readonly SerializedTransaction[],
    input: MythRedeemLstInput,
    state: MythDualStakeState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const minCount = state.needsAsaOptIn ? 3 : 2;
    if (group.length < minCount) {
      errors.push(`Expected at least ${minCount} transactions, received ${group.length}.`);
    }
    if (input.appId !== state.appId) {
      errors.push("Input appId does not match resolved dualSTAKE app.");
    }
    const lstTransfer = group.find(
      (txn) =>
        txn.type === "axfer" &&
        txn.assetTransfer?.assetIndex === String(state.lstId) &&
        txn.assetTransfer.receiver === state.appAddress &&
        txn.assetTransfer.amount === input.amount.toString()
    );
    if (lstTransfer === undefined) {
      errors.push("Group must include an LST transfer to the dualSTAKE app for the redeem amount.");
    }
    const hasAppCall = group.some((txn) => txn.type === "appl");
    if (!hasAppCall) {
      errors.push("Group must include a redeem application call.");
    }
    if (input.amount > state.userLstBalance) {
      warnings.push("Redeem amount exceeds the current wallet LST balance.");
    }
    return { valid: errors.length === 0, errors, warnings };
  }
};
