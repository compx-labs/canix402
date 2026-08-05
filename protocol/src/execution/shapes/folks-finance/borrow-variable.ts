import { Algodv2, SuggestedParams, Transaction } from "algosdk";
import {
  MainnetOracle,
  prepareBorrowFromLoan,
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
  parseEscrowAddress,
  parseIncludeOpUp,
  parseLoanAppId,
  parseOptionalPoolId,
  parseOptionalReceiverAddress,
  parsePoolSelector,
  parsePositiveBaseUnitAmount
} from "./parse-input.js";
import {
  FolksPoolState,
  MainnetOpUp,
  MainnetPoolManagerAppId,
  createFolksBuilderAlgodClient,
  getFolksBuilderAlgodSdk,
  getSuggestedParams,
  resolveFolksPoolState
} from "./pool-state.js";

const BORROW_APP_CALL_FEE = 8000n;
const OPUP_INNER_TXNS = 0;
const VARIABLE_MAX_STABLE_RATE = 0n;

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "folks-finance",
  protocolVersion: "v2",
  action: "borrow",
  variant: "variable"
};

export interface FolksBorrowVariableInput {
  userAddress: string;
  escrowAddress: string;
  loanAppId: number;
  borrowAmount: bigint;
  poolAppId?: number;
  assetId?: number;
  receiverAddress: string;
  includeOpUp: boolean;
  poolId?: string;
}

export interface FolksBorrowVariableState {
  poolState: FolksPoolState;
  loanAppId: number;
}

export interface FolksBorrowVariableDependencies {
  resolvePoolState: (params: {
    network: ShapeBuildContext["network"];
    algod: Algodv2;
    poolAppId?: number;
    assetId?: number;
  }) => Promise<FolksPoolState>;
  getSuggestedParams: (algod: Algodv2) => Promise<SuggestedParams>;
  prepareBorrowFromLoan: typeof prepareBorrowFromLoan;
  prefixWithOpUp: typeof prefixWithOpUp;
  mainnetPoolManagerAppId: number;
  mainnetOracle: typeof MainnetOracle;
  mainnetOpUp: typeof MainnetOpUp;
}

let dependencyOverrides: Partial<FolksBorrowVariableDependencies> | undefined;

export function setFolksBorrowVariableDependenciesForTests(
  overrides?: Partial<FolksBorrowVariableDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): FolksBorrowVariableDependencies {
  return {
    resolvePoolState: resolveFolksPoolState,
    getSuggestedParams,
    prepareBorrowFromLoan,
    prefixWithOpUp,
    mainnetPoolManagerAppId: MainnetPoolManagerAppId,
    mainnetOracle: MainnetOracle,
    mainnetOpUp: MainnetOpUp,
    ...dependencyOverrides
  };
}

export const folksFinanceBorrowVariableShape: TransactionShapeSpec<
  FolksBorrowVariableInput,
  FolksBorrowVariableState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Folks Finance v2 variable-rate borrow",
  description:
    "Borrows an underlying asset from a Folks Finance pool against loan escrow collateral " +
    "at a variable rate (maxStableRate=0). Wraps prepareBorrowFromLoan with optional OpUp.",
  supportedOpportunityTypes: ["lending"],
  opportunityRole: "enter",
  requiredInputs: ["userAddress", "escrowAddress", "borrowAmount"],
  sources: [
    {
      kind: "sdk",
      description:
        "@folks-finance/algorand-sdk prepareBorrowFromLoan + prefixWithOpUp"
    }
  ],

  parseInput(raw: unknown): FolksBorrowVariableInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    const poolSelector = parsePoolSelector(value);
    const poolId = parseOptionalPoolId(value.poolId);
    const userAddress = parseAddress(value.userAddress);
    const receiverAddress =
      parseOptionalReceiverAddress(value.receiverAddress) ?? userAddress;

    return {
      userAddress,
      escrowAddress: parseEscrowAddress(value.escrowAddress),
      loanAppId: parseLoanAppId(value.loanAppId),
      borrowAmount: parsePositiveBaseUnitAmount(value.borrowAmount, "borrowAmount"),
      receiverAddress,
      includeOpUp: parseIncludeOpUp(value.includeOpUp),
      ...(poolId === undefined ? {} : { poolId }),
      ...poolSelector
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: FolksBorrowVariableInput
  ): Promise<FolksBorrowVariableState> {
    const dependencies = resolveDependencies();
    const poolState = await dependencies.resolvePoolState({
      network: context.network,
      algod: context.algod,
      ...(input.poolAppId === undefined ? {} : { poolAppId: input.poolAppId }),
      ...(input.assetId === undefined ? {} : { assetId: input.assetId })
    });
    return { poolState, loanAppId: input.loanAppId };
  },

  async build(
    _context: ShapeBuildContext,
    input: FolksBorrowVariableInput,
    state: FolksBorrowVariableState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings: string[] = [];

    if (state.poolState.pool.loans[state.loanAppId] === undefined) {
      throw new ShapeBuildError("Pool is not enabled for the requested Folks loan app.", {
        details: {
          poolAppId: state.poolState.pool.appId,
          loanAppId: state.loanAppId
        }
      });
    }

    let params: SuggestedParams;
    try {
      params = await dependencies.getSuggestedParams(createFolksBuilderAlgodClient());
    } catch (error) {
      throw new ShapeBuildError("Failed to fetch suggested params for Folks borrow.", {
        cause: error
      });
    }

    const baseAssetIds = [Number(state.poolState.pool.assetId)];
    let borrowTxns: Transaction[];
    try {
      borrowTxns = dependencies.prepareBorrowFromLoan(
        state.loanAppId,
        dependencies.mainnetPoolManagerAppId,
        input.userAddress,
        input.escrowAddress,
        input.receiverAddress,
        state.poolState.pool,
        dependencies.mainnetOracle,
        [],
        baseAssetIds,
        input.borrowAmount,
        VARIABLE_MAX_STABLE_RATE,
        params
      );
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Folks Finance borrow transactions.", {
        cause: error
      });
    }

    const builderAlgosdk = getFolksBuilderAlgodSdk();
    let groupTxns = borrowTxns;
    if (input.includeOpUp) {
      groupTxns = dependencies.prefixWithOpUp(
        dependencies.mainnetOpUp,
        input.userAddress,
        borrowTxns,
        OPUP_INNER_TXNS,
        params
      );
    }

    builderAlgosdk.assignGroupID(groupTxns);
    const transactions = normalizeTransactions(groupTxns);

    return {
      transactions,
      warnings,
      metadata: {
        loanAppId: state.loanAppId,
        escrowAddress: input.escrowAddress,
        receiverAddress: input.receiverAddress,
        symbol: state.poolState.symbol,
        poolAppId: state.poolState.pool.appId,
        underlyingAssetId: Number(state.poolState.pool.assetId),
        borrowAmount: input.borrowAmount.toString(),
        maxStableRate: VARIABLE_MAX_STABLE_RATE.toString(),
        borrowType: "variable",
        includeOpUp: input.includeOpUp,
        ...(input.poolId === undefined ? {} : { poolId: input.poolId })
      }
    };
  },

  validate(
    group,
    input: FolksBorrowVariableInput,
    state: FolksBorrowVariableState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const minLength = input.includeOpUp ? 2 : 1;

    if (group.length < minLength) {
      errors.push(
        `Expected at least ${minLength} transactions, received ${group.length}.`
      );
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

    const loanAppTxn = [...group]
      .reverse()
      .find(
        (txn) =>
          txn.type === "appl" &&
          txn.applicationCall?.appIndex === String(state.loanAppId)
      );
    if (loanAppTxn === undefined) {
      errors.push("Group must include a borrow call targeting the loan application.");
    } else {
      if (loanAppTxn.sender !== input.userAddress) {
        errors.push("Borrow app call sender must be the user address.");
      }
      if (BigInt(loanAppTxn.fee) < BORROW_APP_CALL_FEE) {
        errors.push(
          `Borrow app call fee must be at least ${BORROW_APP_CALL_FEE.toString()} microAlgos.`
        );
      }
    }

    if (group.some((txn) => !txn.groupPresent)) {
      errors.push("All transactions must belong to a single atomic group.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};
