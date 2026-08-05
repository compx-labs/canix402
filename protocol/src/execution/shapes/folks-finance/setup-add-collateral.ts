import { Algodv2, SuggestedParams, Transaction } from "algosdk";
import { prepareAddCollateralToLoan } from "@folks-finance/algorand-sdk";

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
  parseOptionalPoolId,
  parsePoolSelector
} from "./parse-input.js";
import {
  FolksPoolState,
  MainnetPoolManagerAppId,
  createFolksBuilderAlgodClient,
  getFolksBuilderAlgodSdk,
  getSuggestedParams,
  resolveFolksPoolState
} from "./pool-state.js";

const ADD_COLLATERAL_APP_CALL_FEE = 2000n;

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "folks-finance",
  protocolVersion: "v2",
  action: "setup",
  variant: "addCollateral"
};

export interface FolksSetupAddCollateralInput {
  userAddress: string;
  escrowAddress: string;
  loanAppId: number;
  poolAppId?: number;
  assetId?: number;
  poolId?: string;
}

export interface FolksSetupAddCollateralState {
  poolState: FolksPoolState;
  loanAppId: number;
}

export interface FolksSetupAddCollateralDependencies {
  resolvePoolState: (params: {
    network: ShapeBuildContext["network"];
    algod: Algodv2;
    poolAppId?: number;
    assetId?: number;
  }) => Promise<FolksPoolState>;
  getSuggestedParams: (algod: Algodv2) => Promise<SuggestedParams>;
  prepareAddCollateralToLoan: typeof prepareAddCollateralToLoan;
  mainnetPoolManagerAppId: number;
}

let dependencyOverrides: Partial<FolksSetupAddCollateralDependencies> | undefined;

export function setFolksSetupAddCollateralDependenciesForTests(
  overrides?: Partial<FolksSetupAddCollateralDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): FolksSetupAddCollateralDependencies {
  return {
    resolvePoolState: resolveFolksPoolState,
    getSuggestedParams,
    prepareAddCollateralToLoan,
    mainnetPoolManagerAppId: MainnetPoolManagerAppId,
    ...dependencyOverrides
  };
}

export const folksFinanceSetupAddCollateralShape: TransactionShapeSpec<
  FolksSetupAddCollateralInput,
  FolksSetupAddCollateralState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Folks Finance v2 add collateral slot to loan",
  description:
    "Opts a Folks Finance loan escrow into a pool fAsset so collateral can be deposited " +
    "and synced. Wraps prepareAddCollateralToLoan.",
  supportedOpportunityTypes: ["lending"],
  opportunityRole: "enter",
  requiredInputs: ["userAddress", "escrowAddress"],
  sources: [
    {
      kind: "sdk",
      description: "@folks-finance/algorand-sdk prepareAddCollateralToLoan"
    }
  ],

  parseInput(raw: unknown): FolksSetupAddCollateralInput {
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
      ...(poolId === undefined ? {} : { poolId }),
      ...poolSelector
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: FolksSetupAddCollateralInput
  ): Promise<FolksSetupAddCollateralState> {
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
    input: FolksSetupAddCollateralInput,
    state: FolksSetupAddCollateralState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings = [
      "After addCollateral confirms, deposit fAssets into the loan escrow (deposit:escrow with escrowAddress=loan escrow), then run collateral:sync."
    ];

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
      throw new ShapeBuildError("Failed to fetch suggested params for Folks add collateral.", {
        cause: error
      });
    }

    let addCollateralTxn: Transaction;
    try {
      addCollateralTxn = dependencies.prepareAddCollateralToLoan(
        state.loanAppId,
        dependencies.mainnetPoolManagerAppId,
        input.userAddress,
        input.escrowAddress,
        state.poolState.pool,
        params
      );
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Folks Finance add-collateral transaction.", {
        cause: error
      });
    }

    const builderAlgosdk = getFolksBuilderAlgodSdk();
    const groupTxns = [addCollateralTxn];
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
        ...(input.poolId === undefined ? {} : { poolId: input.poolId })
      }
    };
  },

  validate(
    group,
    input: FolksSetupAddCollateralInput,
    state: FolksSetupAddCollateralState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (group.length !== 1) {
      errors.push(`Expected exactly 1 transaction, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    const appTxn = group[0];
    if (appTxn === undefined || appTxn.type !== "appl" || !appTxn.applicationCall) {
      errors.push("Transaction must be the loan add_collateral application call.");
    } else {
      if (appTxn.sender !== input.userAddress) {
        errors.push("Add collateral app call sender must be the user address.");
      }
      if (appTxn.applicationCall.appIndex !== String(state.loanAppId)) {
        errors.push("Add collateral app call must target the loan application.");
      }
      if (BigInt(appTxn.fee) < ADD_COLLATERAL_APP_CALL_FEE) {
        errors.push(
          `Add collateral app call fee must be at least ${ADD_COLLATERAL_APP_CALL_FEE.toString()} microAlgos.`
        );
      }
    }

    if (group.some((txn) => !txn.groupPresent)) {
      errors.push("All transactions must belong to a single atomic group.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};
