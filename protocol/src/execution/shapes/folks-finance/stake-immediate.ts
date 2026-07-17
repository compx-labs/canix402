import { Algodv2, SuggestedParams, Transaction } from "algosdk";
import {
  prepareImmediateStakeTransactions,
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
  action: "stake",
  variant: "immediate"
};

export interface FolksStakeImmediateInput {
  userAddress: string;
  amount: bigint;
  receiverAddress: string;
  minReceivedAmount: bigint;
  includeOpUp: boolean;
}

export interface FolksStakeImmediateDependencies {
  resolveState: typeof resolveFolksXAlgoState;
  getSuggestedParams: (algod: Algodv2) => Promise<SuggestedParams>;
  prepareImmediateStakeTransactions: typeof prepareImmediateStakeTransactions;
  prefixWithOpUp: typeof prefixWithOpUp;
  consensusConfig: typeof MainnetConsensusConfig;
  mainnetOpUp: typeof MainnetOpUp;
}

let dependencyOverrides: Partial<FolksStakeImmediateDependencies> | undefined;

export function setFolksStakeImmediateDependenciesForTests(
  overrides?: Partial<FolksStakeImmediateDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): FolksStakeImmediateDependencies {
  return {
    resolveState: resolveFolksXAlgoState,
    getSuggestedParams,
    prepareImmediateStakeTransactions,
    prefixWithOpUp,
    consensusConfig: MainnetConsensusConfig,
    mainnetOpUp: MainnetOpUp,
    ...dependencyOverrides
  };
}

export const folksFinanceStakeImmediateShape: TransactionShapeSpec<
  FolksStakeImmediateInput,
  FolksXAlgoState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Folks Finance xALGO immediate stake",
  description:
    "Stakes ALGO into Folks Finance liquid staking and mints xALGO immediately. Builds the " +
    "SDK immediate_mint group (ALGO payment + consensus app call, with optional OpUp and " +
    "resource-allocation dummy calls) as unsigned transactions.",
  supportedOpportunityTypes: ["staking"],
  opportunityRole: "enter",
  requiredInputs: ["userAddress", "amount"],
  sources: [
    {
      kind: "sdk",
      description:
        "@folks-finance/algorand-sdk prepareImmediateStakeTransactions + prefixWithOpUp"
    }
  ],

  parseInput(raw: unknown): FolksStakeImmediateInput {
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
    input: FolksStakeImmediateInput
  ): Promise<FolksXAlgoState> {
    return resolveDependencies().resolveState({
      network: context.network,
      algod: context.algod,
      userAddress: input.userAddress
    });
  },

  async build(
    context: ShapeBuildContext,
    input: FolksStakeImmediateInput,
    state: FolksXAlgoState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings: string[] = [];

    if (!state.consensusState.canImmediateStake) {
      throw new ShapeBuildError(
        "Folks Finance xALGO immediate staking is currently disabled on-chain."
      );
    }

    if (state.needsXAlgoOptIn) {
      warnings.push(
        "User is not opted into xALGO; opt into asset " +
          `${state.xAlgoId} before submitting this group.`
      );
    }

    if (input.amount > state.userAlgoBalance) {
      warnings.push(
        `Requested stake amount (${input.amount.toString()}) exceeds current wallet ALGO balance ` +
          `(${state.userAlgoBalance.toString()}).`
      );
    }

    let params: SuggestedParams;
    try {
      params = await dependencies.getSuggestedParams(createFolksBuilderAlgodClient());
    } catch (error) {
      throw new ShapeBuildError("Failed to fetch suggested params for Folks xALGO stake.", {
        cause: error
      });
    }

    let stakeTxns: Transaction[];
    try {
      stakeTxns = dependencies.prepareImmediateStakeTransactions(
        dependencies.consensusConfig,
        state.consensusState,
        input.userAddress,
        input.receiverAddress,
        input.amount,
        input.minReceivedAmount,
        params
      );
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Folks Finance xALGO stake transactions.", {
        cause: error
      });
    }

    let groupTxns = stakeTxns;
    if (input.includeOpUp) {
      groupTxns = dependencies.prefixWithOpUp(
        dependencies.mainnetOpUp,
        input.userAddress,
        stakeTxns,
        OPUP_INNER_TXNS,
        params
      );
    }

    const builderAlgosdk = getFolksBuilderAlgodSdk();
    builderAlgosdk.assignGroupID(groupTxns);
    const transactions = normalizeTransactions(groupTxns);
    const expectedXAlgoOut = state.expectedXAlgoFromAlgo(input.amount);

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
        expectedXAlgoOut: expectedXAlgoOut.toString(),
        algoBalance: state.consensusState.algoBalance.toString(),
        xAlgoCirculatingSupply: state.consensusState.xAlgoCirculatingSupply.toString(),
        premium: state.consensusState.premium.toString(),
        includeOpUp: input.includeOpUp,
        needsXAlgoOptIn: state.needsXAlgoOptIn
      }
    };
  },

  validate(
    group,
    input: FolksStakeImmediateInput,
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

    const paymentTxn = group.find(
      (txn) =>
        txn.type === "pay" &&
        txn.payment !== undefined &&
        txn.payment.receiver === state.consensusAppAddress &&
        txn.payment.amount === input.amount.toString()
    );
    if (paymentTxn === undefined) {
      errors.push(
        "Group must include an ALGO payment to the consensus app for the stake amount."
      );
    } else if (paymentTxn.sender !== input.userAddress) {
      errors.push("Stake payment sender must be the user address.");
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

    if (state.needsXAlgoOptIn) {
      warnings.push(`User must opt into xALGO (${state.xAlgoId}) before submit.`);
    }
    if (input.amount > state.userAlgoBalance) {
      warnings.push("Stake amount exceeds the current wallet ALGO balance.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};
