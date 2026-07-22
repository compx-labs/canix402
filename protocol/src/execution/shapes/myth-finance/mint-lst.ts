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
  buildMythMintTransactions,
  expectedAsaForMint,
  parseMythAddress,
  parseMythAmount,
  parseMythAppId,
  resolveMythDualStakeState
} from "./dualstake-state.js";

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "myth-finance",
  protocolVersion: "dualstake-v1",
  action: "mint",
  variant: "lst"
};

export interface MythMintLstInput {
  userAddress: string;
  amount: bigint;
  appId: number;
}

export interface MythMintLstDependencies {
  resolveState: typeof resolveMythDualStakeState;
  buildMint: typeof buildMythMintTransactions;
}

let dependencyOverrides: Partial<MythMintLstDependencies> | undefined;

export function setMythMintLstDependenciesForTests(
  overrides?: Partial<MythMintLstDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): MythMintLstDependencies {
  return {
    resolveState: resolveMythDualStakeState,
    buildMint: buildMythMintTransactions,
    ...dependencyOverrides
  };
}

export const mythFinanceMintLstShape: TransactionShapeSpec<
  MythMintLstInput,
  MythDualStakeState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Myth Finance dualSTAKE mint LST",
  description:
    "Mints a Myth Finance dualSTAKE liquid-staking token by depositing ALGO and a small paired-ASA " +
    "leg (receipt is not a pure ALGO 1:1 LST). " +
    "Builds an unsigned group: optional LST opt-in, mint app call, ALGO payment, ASA transfer. " +
    "ASA deposit is derived from the on-chain rate for the requested ALGO amount.",
  supportedOpportunityTypes: ["staking", "farm"],
  opportunityRole: "enter",
  requiredInputs: ["userAddress", "amount", "appId"],
  sources: [
    {
      kind: "sdk",
      description:
        "@myth-finance/dualstake-ts-sdk DualStakeClient mint app call + algosdk v3 payment/axfer builders"
    }
  ],

  parseInput(raw: unknown): MythMintLstInput {
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
    input: MythMintLstInput
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
    input: MythMintLstInput,
    state: MythDualStakeState
  ): Promise<ShapeBuildResult> {
    const warnings: string[] = [];
    const asaAmount = expectedAsaForMint(input.amount, state.rate);

    if (input.amount > state.userAlgoBalance) {
      warnings.push(
        `Requested mint amount (${input.amount.toString()}) exceeds wallet ALGO balance ` +
          `(${state.userAlgoBalance.toString()}).`
      );
    }
    if (asaAmount > state.userAsaBalance) {
      warnings.push(
        `Derived ASA deposit (${asaAmount.toString()} of asset ${state.asaId}) exceeds wallet balance ` +
          `(${state.userAsaBalance.toString()}).`
      );
    }
    if (!state.isOnline) {
      warnings.push("dualSTAKE contract is currently offline for consensus participation.");
    }

    let transactions: Transaction[];
    try {
      transactions = await resolveDependencies().buildMint({
        algod: context.algod,
        userAddress: input.userAddress,
        appId: input.appId,
        algoAmount: input.amount,
        state
      });
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Myth Finance mint transactions.", {
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
        expectedAsaIn: asaAmount.toString(),
        expectedLstOut: input.amount.toString(),
        includesLstOptIn: state.needsLstOptIn,
        rate: state.rate.toString()
      }
    };
  },

  validate(
    group: readonly SerializedTransaction[],
    input: MythMintLstInput,
    state: MythDualStakeState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const minCount = state.needsLstOptIn ? 4 : 3;
    if (group.length < minCount) {
      errors.push(`Expected at least ${minCount} transactions, received ${group.length}.`);
    }
    if (input.appId !== state.appId) {
      errors.push("Input appId does not match resolved dualSTAKE app.");
    }
    const payment = group.find(
      (txn) =>
        txn.type === "pay" &&
        txn.payment?.receiver === state.appAddress &&
        txn.payment.amount === input.amount.toString()
    );
    if (payment === undefined) {
      errors.push("Group must include an ALGO payment to the dualSTAKE app for the mint amount.");
    }
    const hasAppCall = group.some((txn) => txn.type === "appl");
    if (!hasAppCall) {
      errors.push("Group must include a mint application call.");
    }
    if (input.amount > state.userAlgoBalance) {
      warnings.push("Mint amount exceeds the current wallet ALGO balance.");
    }
    return { valid: errors.length === 0, errors, warnings };
  }
};
