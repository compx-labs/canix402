import { Algodv2, SuggestedParams, Transaction } from "algosdk";
import {
  MainnetReserveAddress,
  prepareRepayLoanWithTxn
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
  parseLoanAppId,
  parseOptionalIsStable,
  parseOptionalPoolId,
  parseOptionalReceiverAddress,
  parsePoolSelector,
  parsePositiveBaseUnitAmount
} from "./parse-input.js";
import {
  FolksPoolState,
  MainnetPoolManagerAppId,
  createFolksBuilderAlgodClient,
  getFolksBuilderAlgodSdk,
  getSuggestedParams,
  resolveFolksPoolState
} from "./pool-state.js";

const REPAY_APP_CALL_FEE = 10_000n;
const ALGO_ASSET_ID = 0;

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "folks-finance",
  protocolVersion: "v2",
  action: "repay",
  variant: "withTxn"
};

export interface FolksRepayWithTxnInput {
  userAddress: string;
  escrowAddress: string;
  loanAppId: number;
  repayAmount: bigint;
  poolAppId?: number;
  assetId?: number;
  receiverAddress: string;
  isStable: boolean;
  poolId?: string;
}

export interface FolksRepayWithTxnState {
  poolState: FolksPoolState;
  loanAppId: number;
}

export interface FolksRepayWithTxnDependencies {
  resolvePoolState: (params: {
    network: ShapeBuildContext["network"];
    algod: Algodv2;
    poolAppId?: number;
    assetId?: number;
  }) => Promise<FolksPoolState>;
  getSuggestedParams: (algod: Algodv2) => Promise<SuggestedParams>;
  prepareRepayLoanWithTxn: typeof prepareRepayLoanWithTxn;
  mainnetPoolManagerAppId: number;
  mainnetReserveAddress: typeof MainnetReserveAddress;
}

let dependencyOverrides: Partial<FolksRepayWithTxnDependencies> | undefined;

export function setFolksRepayWithTxnDependenciesForTests(
  overrides?: Partial<FolksRepayWithTxnDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): FolksRepayWithTxnDependencies {
  return {
    resolvePoolState: resolveFolksPoolState,
    getSuggestedParams,
    prepareRepayLoanWithTxn,
    mainnetPoolManagerAppId: MainnetPoolManagerAppId,
    mainnetReserveAddress: MainnetReserveAddress,
    ...dependencyOverrides
  };
}

export const folksFinanceRepayWithTxnShape: TransactionShapeSpec<
  FolksRepayWithTxnInput,
  FolksRepayWithTxnState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Folks Finance v2 repay loan with transfer",
  description:
    "Repays variable-rate Folks Finance debt by transferring the underlying asset from the " +
    "user wallet. Wraps prepareRepayLoanWithTxn with isStable=false by default and MainnetReserveAddress.",
  supportedOpportunityTypes: ["lending"],
  opportunityRole: "exit",
  requiredInputs: ["userAddress", "escrowAddress", "repayAmount"],
  sources: [
    {
      kind: "sdk",
      description: "@folks-finance/algorand-sdk prepareRepayLoanWithTxn"
    }
  ],

  parseInput(raw: unknown): FolksRepayWithTxnInput {
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
      repayAmount: parsePositiveBaseUnitAmount(value.repayAmount, "repayAmount"),
      receiverAddress,
      isStable: parseOptionalIsStable(value.isStable),
      ...(poolId === undefined ? {} : { poolId }),
      ...poolSelector
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: FolksRepayWithTxnInput
  ): Promise<FolksRepayWithTxnState> {
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
    input: FolksRepayWithTxnInput,
    state: FolksRepayWithTxnState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings: string[] = [];

    if (input.receiverAddress === input.userAddress) {
      warnings.push(
        "receiverAddress defaults to the user wallet; Folks typically sends reward residuals to the deposit escrow."
      );
    }
    if (input.isStable) {
      warnings.push("Repaying a stable-rate borrow; ensure the debt side matches isStable=true.");
    }

    let params: SuggestedParams;
    try {
      params = await dependencies.getSuggestedParams(createFolksBuilderAlgodClient());
    } catch (error) {
      throw new ShapeBuildError("Failed to fetch suggested params for Folks repay.", {
        cause: error
      });
    }

    let repayTxns: Transaction[];
    try {
      repayTxns = dependencies.prepareRepayLoanWithTxn(
        state.loanAppId,
        dependencies.mainnetPoolManagerAppId,
        input.userAddress,
        input.escrowAddress,
        input.receiverAddress,
        dependencies.mainnetReserveAddress,
        state.poolState.pool,
        input.repayAmount,
        input.isStable,
        params
      );
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Folks Finance repay transactions.", {
        cause: error
      });
    }

    const builderAlgosdk = getFolksBuilderAlgodSdk();
    builderAlgosdk.assignGroupID(repayTxns);
    const transactions = normalizeTransactions(repayTxns);

    return {
      transactions,
      warnings,
      metadata: {
        loanAppId: state.loanAppId,
        escrowAddress: input.escrowAddress,
        receiverAddress: input.receiverAddress,
        reserveAddress: dependencies.mainnetReserveAddress,
        symbol: state.poolState.symbol,
        poolAppId: state.poolState.pool.appId,
        underlyingAssetId: Number(state.poolState.pool.assetId),
        repayAmount: input.repayAmount.toString(),
        isStable: input.isStable,
        ...(input.poolId === undefined ? {} : { poolId: input.poolId })
      }
    };
  },

  validate(
    group,
    input: FolksRepayWithTxnInput,
    state: FolksRepayWithTxnState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (group.length !== 2) {
      errors.push(`Expected exactly 2 transactions, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    const transferTxn = group[0];
    const underlyingAssetId = Number(state.poolState.pool.assetId);
    if (underlyingAssetId === ALGO_ASSET_ID) {
      if (transferTxn === undefined || transferTxn.type !== "pay" || !transferTxn.payment) {
        errors.push("Repay transfer must be an ALGO payment when the pool asset is ALGO.");
      } else if (transferTxn.payment.amount !== input.repayAmount.toString()) {
        errors.push("Repay transfer amount must equal the requested repay amount.");
      } else if (transferTxn.payment.receiver !== state.poolState.poolAppAddress) {
        errors.push("Repay transfer receiver must be the pool application address.");
      }
    } else if (
      transferTxn === undefined ||
      transferTxn.type !== "axfer" ||
      !transferTxn.assetTransfer
    ) {
      errors.push("Repay transfer must be an asset transfer.");
    } else {
      if (transferTxn.assetTransfer.amount !== input.repayAmount.toString()) {
        errors.push("Repay transfer amount must equal the requested repay amount.");
      }
      if (transferTxn.assetTransfer.assetIndex !== String(underlyingAssetId)) {
        errors.push("Repay transfer asset must match the pool underlying asset.");
      }
      if (transferTxn.assetTransfer.receiver !== state.poolState.poolAppAddress) {
        errors.push("Repay transfer receiver must be the pool application address.");
      }
    }

    const appTxn = group[1];
    if (appTxn === undefined || appTxn.type !== "appl" || !appTxn.applicationCall) {
      errors.push("Second transaction must be the loan repay_with_txn application call.");
    } else {
      if (appTxn.sender !== input.userAddress) {
        errors.push("Repay app call sender must be the user address.");
      }
      if (appTxn.applicationCall.appIndex !== String(state.loanAppId)) {
        errors.push("Repay app call must target the loan application.");
      }
      if (BigInt(appTxn.fee) < REPAY_APP_CALL_FEE) {
        errors.push(
          `Repay app call fee must be at least ${REPAY_APP_CALL_FEE.toString()} microAlgos.`
        );
      }
    }

    if (group.some((txn) => !txn.groupPresent)) {
      errors.push("All transactions must belong to a single atomic group.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};
