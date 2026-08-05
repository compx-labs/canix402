import { Algodv2, SuggestedParams, Transaction } from "algosdk";
import {
  MainnetOracle,
  prepareSyncCollateralInLoan,
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
  parsePoolSelector
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

const SYNC_COLLATERAL_APP_CALL_FEE = 1000n;
const OPUP_INNER_TXNS = 0;

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "folks-finance",
  protocolVersion: "v2",
  action: "collateral",
  variant: "sync"
};

export interface FolksCollateralSyncInput {
  userAddress: string;
  escrowAddress: string;
  loanAppId: number;
  poolAppId?: number;
  assetId?: number;
  includeOpUp: boolean;
  poolId?: string;
}

export interface FolksCollateralSyncState {
  poolState: FolksPoolState;
  loanAppId: number;
}

export interface FolksCollateralSyncDependencies {
  resolvePoolState: (params: {
    network: ShapeBuildContext["network"];
    algod: Algodv2;
    poolAppId?: number;
    assetId?: number;
  }) => Promise<FolksPoolState>;
  getSuggestedParams: (algod: Algodv2) => Promise<SuggestedParams>;
  prepareSyncCollateralInLoan: typeof prepareSyncCollateralInLoan;
  prefixWithOpUp: typeof prefixWithOpUp;
  mainnetPoolManagerAppId: number;
  mainnetOracle: typeof MainnetOracle;
  mainnetOpUp: typeof MainnetOpUp;
}

let dependencyOverrides: Partial<FolksCollateralSyncDependencies> | undefined;

export function setFolksCollateralSyncDependenciesForTests(
  overrides?: Partial<FolksCollateralSyncDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): FolksCollateralSyncDependencies {
  return {
    resolvePoolState: resolveFolksPoolState,
    getSuggestedParams,
    prepareSyncCollateralInLoan,
    prefixWithOpUp,
    mainnetPoolManagerAppId: MainnetPoolManagerAppId,
    mainnetOracle: MainnetOracle,
    mainnetOpUp: MainnetOpUp,
    ...dependencyOverrides
  };
}

export const folksFinanceCollateralSyncShape: TransactionShapeSpec<
  FolksCollateralSyncInput,
  FolksCollateralSyncState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Folks Finance v2 sync loan collateral",
  description:
    "Registers fAsset balance held by a loan escrow as collateral via prepareSyncCollateralInLoan " +
    "(oracle price refresh + sync_collateral). includeOpUp defaults to true.",
  supportedOpportunityTypes: ["lending"],
  opportunityRole: "manage",
  requiredInputs: ["userAddress", "escrowAddress"],
  sources: [
    {
      kind: "sdk",
      description:
        "@folks-finance/algorand-sdk prepareSyncCollateralInLoan + prefixWithOpUp"
    }
  ],

  parseInput(raw: unknown): FolksCollateralSyncInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    const poolSelector = parsePoolSelector(value);
    const poolId = parseOptionalPoolId(value.poolId);

    return {
      userAddress: parseAddress(value.userAddress),
      escrowAddress: parseEscrowAddress(value.escrowAddress),
      loanAppId: parseLoanAppId(value.loanAppId),
      includeOpUp: parseIncludeOpUp(value.includeOpUp),
      ...(poolId === undefined ? {} : { poolId }),
      ...poolSelector
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: FolksCollateralSyncInput
  ): Promise<FolksCollateralSyncState> {
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
    input: FolksCollateralSyncInput,
    state: FolksCollateralSyncState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings: string[] = [
      "Ensure the loan escrow already holds the pool fAsset (deposit into the loan escrow after setup:addCollateral)."
    ];

    let params: SuggestedParams;
    try {
      params = await dependencies.getSuggestedParams(createFolksBuilderAlgodClient());
    } catch (error) {
      throw new ShapeBuildError("Failed to fetch suggested params for Folks collateral sync.", {
        cause: error
      });
    }

    let syncTxns: Transaction[];
    try {
      syncTxns = dependencies.prepareSyncCollateralInLoan(
        state.loanAppId,
        dependencies.mainnetPoolManagerAppId,
        input.userAddress,
        input.escrowAddress,
        state.poolState.pool,
        dependencies.mainnetOracle,
        params
      );
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Folks Finance sync-collateral transactions.", {
        cause: error
      });
    }

    const builderAlgosdk = getFolksBuilderAlgodSdk();
    let groupTxns = syncTxns;
    if (input.includeOpUp) {
      groupTxns = dependencies.prefixWithOpUp(
        dependencies.mainnetOpUp,
        input.userAddress,
        syncTxns,
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
        symbol: state.poolState.symbol,
        poolAppId: state.poolState.pool.appId,
        fAssetId: Number(state.poolState.pool.fAssetId),
        includeOpUp: input.includeOpUp,
        ...(input.poolId === undefined ? {} : { poolId: input.poolId })
      }
    };
  },

  validate(
    group,
    input: FolksCollateralSyncInput,
    state: FolksCollateralSyncState
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
      errors.push("Group must include a sync_collateral call targeting the loan application.");
    } else {
      if (loanAppTxn.sender !== input.userAddress) {
        errors.push("Sync collateral app call sender must be the user address.");
      }
      if (BigInt(loanAppTxn.fee) < SYNC_COLLATERAL_APP_CALL_FEE) {
        errors.push(
          `Sync collateral app call fee must be at least ${SYNC_COLLATERAL_APP_CALL_FEE.toString()} microAlgos.`
        );
      }
    }

    if (group.some((txn) => !txn.groupPresent)) {
      errors.push("All transactions must belong to a single atomic group.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};
