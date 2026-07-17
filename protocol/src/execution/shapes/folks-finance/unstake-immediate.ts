import { Algodv2, SuggestedParams, Transaction } from "algosdk";
import {
  prepareUnstakeTransactions,
  prefixWithOpUp
} from "@folks-finance/algorand-sdk";

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
  parseAddress,
  parseIncludeOpUp,
  parseOptionalMinReceivedAmount,
  parseOptionalReceiverAddress,
  parsePositiveBaseUnitAmount
} from "./parse-input.js";
import {
  createFolksBuilderAlgodClient,
  getFolksBuilderAlgodSdk
} from "./pool-state.js";
import {
  FolksXAlgoState,
  MainnetConsensusConfig,
  MainnetOpUp,
  getSuggestedParams,
  resolveFolksXAlgoState
} from "./xalgo-state.js";

const OPUP_INNER_TXNS = 0;

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "folks-finance",
  protocolVersion: "xalgo-v1",
  action: "unstake",
  variant: "immediate"
};

export interface FolksUnstakeImmediateInput {
  userAddress: string;
  amount: bigint;
  receiverAddress: string;
  minReceivedAmount: bigint;
  includeOpUp: boolean;
}

export interface FolksUnstakeImmediateDependencies {
  resolveState: typeof resolveFolksXAlgoState;
  getSuggestedParams: (algod: Algodv2) => Promise<SuggestedParams>;
  prepareUnstakeTransactions: typeof prepareUnstakeTransactions;
  prefixWithOpUp: typeof prefixWithOpUp;
  consensusConfig: typeof MainnetConsensusConfig;
  mainnetOpUp: typeof MainnetOpUp;
}

let dependencyOverrides: Partial<FolksUnstakeImmediateDependencies> | undefined;

export function setFolksUnstakeImmediateDependenciesForTests(
  overrides?: Partial<FolksUnstakeImmediateDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): FolksUnstakeImmediateDependencies {
  return {
    resolveState: resolveFolksXAlgoState,
    getSuggestedParams,
    prepareUnstakeTransactions,
    prefixWithOpUp,
    consensusConfig: MainnetConsensusConfig,
    mainnetOpUp: MainnetOpUp,
    ...dependencyOverrides
  };
}

export const folksFinanceUnstakeImmediateShape: TransactionShapeSpec<
  FolksUnstakeImmediateInput,
  FolksXAlgoState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Folks Finance xALGO immediate unstake",
  description:
    "Burns xALGO to redeem ALGO from Folks Finance liquid staking immediately. Builds the " +
    "SDK burn group (xALGO transfer + consensus app call, with optional OpUp and " +
    "resource-allocation dummy calls) as unsigned transactions.",
  supportedOpportunityTypes: ["staking"],
  opportunityRole: "exit",
  requiredInputs: ["userAddress", "amount"],
  sources: [
    {
      kind: "sdk",
      description: "@folks-finance/algorand-sdk prepareUnstakeTransactions + prefixWithOpUp"
    }
  ],

  parseInput(raw: unknown): FolksUnstakeImmediateInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    const userAddress = parseAddress(value.userAddress);
    return {
      userAddress,
      amount: parsePositiveBaseUnitAmount(value.amount, "amount"),
      receiverAddress: parseOptionalReceiverAddress(value.receiverAddress) ?? userAddress,
      minReceivedAmount: parseOptionalMinReceivedAmount(value.minReceivedAmount),
      includeOpUp: parseIncludeOpUp(value.includeOpUp)
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: FolksUnstakeImmediateInput
  ): Promise<FolksXAlgoState> {
    return resolveDependencies().resolveState({
      network: context.network,
      algod: context.algod,
      userAddress: input.userAddress
    });
  },

  async build(
    context: ShapeBuildContext,
    input: FolksUnstakeImmediateInput,
    state: FolksXAlgoState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings: string[] = [];

    if (input.amount > state.userXAlgoBalance) {
      warnings.push(
        `Requested unstake amount (${input.amount.toString()}) exceeds current wallet xALGO ` +
          `balance (${state.userXAlgoBalance.toString()}).`
      );
    }

    let params: SuggestedParams;
    try {
      params = await dependencies.getSuggestedParams(createFolksBuilderAlgodClient());
    } catch (error) {
      throw new ShapeBuildError("Failed to fetch suggested params for Folks xALGO unstake.", {
        cause: error
      });
    }

    let unstakeTxns: Transaction[];
    try {
      unstakeTxns = dependencies.prepareUnstakeTransactions(
        dependencies.consensusConfig,
        state.consensusState,
        input.userAddress,
        input.receiverAddress,
        input.amount,
        input.minReceivedAmount,
        params
      );
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Folks Finance xALGO unstake transactions.", {
        cause: error
      });
    }

    let groupTxns = unstakeTxns;
    if (input.includeOpUp) {
      groupTxns = dependencies.prefixWithOpUp(
        dependencies.mainnetOpUp,
        input.userAddress,
        unstakeTxns,
        OPUP_INNER_TXNS,
        params
      );
    }

    const builderAlgosdk = getFolksBuilderAlgodSdk();
    builderAlgosdk.assignGroupID(groupTxns);
    const transactions = normalizeTransactions(groupTxns);
    const expectedAlgoOut = state.expectedAlgoFromXAlgo(input.amount);

    return {
      transactions,
      warnings,
      metadata: {
        consensusAppId: state.consensusAppId,
        consensusAppAddress: state.consensusAppAddress,
        xAlgoId: state.xAlgoId,
        amountIn: input.amount.toString(),
        receiverAddress: input.receiverAddress,
        minReceivedAmount: input.minReceivedAmount.toString(),
        expectedAlgoOut: expectedAlgoOut.toString(),
        algoBalance: state.consensusState.algoBalance.toString(),
        xAlgoCirculatingSupply: state.consensusState.xAlgoCirculatingSupply.toString(),
        includeOpUp: input.includeOpUp
      }
    };
  },

  validate(
    group,
    input: FolksUnstakeImmediateInput,
    state: FolksXAlgoState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const minCount = input.includeOpUp ? 3 : 2;
    if (group.length < minCount) {
      errors.push(`Expected at least ${minCount} transactions, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    if (input.includeOpUp) {
      const opUpTxn = group[0];
      if (opUpTxn === undefined || opUpTxn.type !== "appl" || !opUpTxn.applicationCall) {
        errors.push("Transaction 1 must be an OpUp application call when includeOpUp is true.");
      } else if (opUpTxn.sender !== input.userAddress) {
        errors.push("OpUp transaction sender must be the user address.");
      }
    }

    const transferTxn = group.find(
      (txn) =>
        txn.type === "axfer" &&
        txn.assetTransfer !== undefined &&
        txn.assetTransfer.assetIndex === String(state.xAlgoId) &&
        txn.assetTransfer.receiver === state.consensusAppAddress &&
        txn.assetTransfer.amount === input.amount.toString()
    );
    if (transferTxn === undefined) {
      errors.push(
        "Group must include an xALGO transfer to the consensus app for the unstake amount."
      );
    } else if (transferTxn.sender !== input.userAddress) {
      errors.push("Unstake transfer sender must be the user address.");
    }

    const appTxn = group.find(
      (txn) =>
        txn.type === "appl" &&
        txn.applicationCall !== undefined &&
        txn.applicationCall.appIndex === String(state.consensusAppId) &&
        txn.sender === input.userAddress
    );
    if (appTxn === undefined) {
      errors.push("Group must include a consensus app call from the user address.");
    }

    if (group.some((txn) => !txn.groupPresent)) {
      errors.push("All transactions must belong to a single atomic group.");
    }

    if (input.amount > state.userXAlgoBalance) {
      warnings.push("Unstake amount exceeds the current wallet xALGO balance.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};
