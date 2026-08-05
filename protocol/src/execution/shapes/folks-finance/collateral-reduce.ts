import { Algodv2, SuggestedParams, Transaction } from "algosdk";
import {
  MainnetOracle,
  prepareReduceCollateralFromLoan,
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
  parseAmountDenomination,
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

const REDUCE_COLLATERAL_APP_CALL_FEE = 6000n;
const OPUP_INNER_TXNS = 0;

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "folks-finance",
  protocolVersion: "v2",
  action: "collateral",
  variant: "reduce"
};

export interface FolksCollateralReduceInput {
  userAddress: string;
  escrowAddress: string;
  loanAppId: number;
  amount: bigint;
  amountDenomination: "asset" | "fAsset";
  poolAppId?: number;
  assetId?: number;
  receiverAddress: string;
  includeOpUp: boolean;
  poolId?: string;
}

export interface FolksCollateralReduceState {
  poolState: FolksPoolState;
  loanAppId: number;
}

export interface FolksCollateralReduceDependencies {
  resolvePoolState: (params: {
    network: ShapeBuildContext["network"];
    algod: Algodv2;
    poolAppId?: number;
    assetId?: number;
  }) => Promise<FolksPoolState>;
  getSuggestedParams: (algod: Algodv2) => Promise<SuggestedParams>;
  prepareReduceCollateralFromLoan: typeof prepareReduceCollateralFromLoan;
  prefixWithOpUp: typeof prefixWithOpUp;
  mainnetPoolManagerAppId: number;
  mainnetOracle: typeof MainnetOracle;
  mainnetOpUp: typeof MainnetOpUp;
}

let dependencyOverrides: Partial<FolksCollateralReduceDependencies> | undefined;

export function setFolksCollateralReduceDependenciesForTests(
  overrides?: Partial<FolksCollateralReduceDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): FolksCollateralReduceDependencies {
  return {
    resolvePoolState: resolveFolksPoolState,
    getSuggestedParams,
    prepareReduceCollateralFromLoan,
    prefixWithOpUp,
    mainnetPoolManagerAppId: MainnetPoolManagerAppId,
    mainnetOracle: MainnetOracle,
    mainnetOpUp: MainnetOpUp,
    ...dependencyOverrides
  };
}

export const folksFinanceCollateralReduceShape: TransactionShapeSpec<
  FolksCollateralReduceInput,
  FolksCollateralReduceState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Folks Finance v2 reduce loan collateral",
  description:
    "Withdraws collateral from a Folks Finance loan escrow back to a receiver " +
    "(typically the deposit escrow) via prepareReduceCollateralFromLoan. includeOpUp defaults to true.",
  supportedOpportunityTypes: ["lending"],
  opportunityRole: "exit",
  requiredInputs: ["userAddress", "escrowAddress", "amount", "amountDenomination"],
  sources: [
    {
      kind: "sdk",
      description:
        "@folks-finance/algorand-sdk prepareReduceCollateralFromLoan + prefixWithOpUp"
    }
  ],

  parseInput(raw: unknown): FolksCollateralReduceInput {
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
      amount: parsePositiveBaseUnitAmount(value.amount, "amount"),
      amountDenomination: parseAmountDenomination(value.amountDenomination),
      receiverAddress,
      includeOpUp: parseIncludeOpUp(value.includeOpUp),
      ...(poolId === undefined ? {} : { poolId }),
      ...poolSelector
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: FolksCollateralReduceInput
  ): Promise<FolksCollateralReduceState> {
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
    input: FolksCollateralReduceInput,
    state: FolksCollateralReduceState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings: string[] = [];

    if (input.receiverAddress === input.userAddress) {
      warnings.push(
        "receiverAddress defaults to the user wallet; Folks typically returns collateral to the deposit escrow."
      );
    }

    let params: SuggestedParams;
    try {
      params = await dependencies.getSuggestedParams(createFolksBuilderAlgodClient());
    } catch (error) {
      throw new ShapeBuildError(
        "Failed to fetch suggested params for Folks reduce collateral.",
        { cause: error }
      );
    }

    const baseAssetIds = [Number(state.poolState.pool.assetId)];
    const isfAssetAmount = input.amountDenomination === "fAsset";
    let reduceTxns: Transaction[];
    try {
      reduceTxns = dependencies.prepareReduceCollateralFromLoan(
        state.loanAppId,
        dependencies.mainnetPoolManagerAppId,
        input.userAddress,
        input.escrowAddress,
        input.receiverAddress,
        state.poolState.pool,
        dependencies.mainnetOracle,
        [],
        baseAssetIds,
        input.amount,
        isfAssetAmount,
        params
      );
    } catch (error) {
      throw new ShapeBuildError(
        "Failed to generate Folks Finance reduce-collateral transactions.",
        { cause: error }
      );
    }

    const builderAlgosdk = getFolksBuilderAlgodSdk();
    let groupTxns = reduceTxns;
    if (input.includeOpUp) {
      groupTxns = dependencies.prefixWithOpUp(
        dependencies.mainnetOpUp,
        input.userAddress,
        reduceTxns,
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
        fAssetId: Number(state.poolState.pool.fAssetId),
        underlyingAssetId: Number(state.poolState.pool.assetId),
        amount: input.amount.toString(),
        amountDenomination: input.amountDenomination,
        includeOpUp: input.includeOpUp,
        ...(input.poolId === undefined ? {} : { poolId: input.poolId })
      }
    };
  },

  validate(
    group,
    input: FolksCollateralReduceInput,
    state: FolksCollateralReduceState
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
      errors.push(
        "Group must include a reduce_collateral call targeting the loan application."
      );
    } else {
      if (loanAppTxn.sender !== input.userAddress) {
        errors.push("Reduce collateral app call sender must be the user address.");
      }
      if (BigInt(loanAppTxn.fee) < REDUCE_COLLATERAL_APP_CALL_FEE) {
        errors.push(
          `Reduce collateral app call fee must be at least ${REDUCE_COLLATERAL_APP_CALL_FEE.toString()} microAlgos.`
        );
      }
    }

    if (group.some((txn) => !txn.groupPresent)) {
      errors.push("All transactions must belong to a single atomic group.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};
