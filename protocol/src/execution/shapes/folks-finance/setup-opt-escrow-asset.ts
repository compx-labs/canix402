import algosdk, { Algodv2, SuggestedParams, Transaction } from "algosdk";
import { prepareOptDepositEscrowIntoAssetInDeposits } from "@folks-finance/algorand-sdk";

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
  parseOptionalPoolId,
  parsePoolSelector,
  parseRequiredEscrowAddress
} from "./parse-input.js";
import {
  FolksPoolState,
  MainnetDepositsAppId,
  MainnetPoolManagerAppId,
  getSuggestedParams,
  isAccountOptedIntoAsset,
  resolveFolksPoolState
} from "./pool-state.js";

const OPT_ESCROW_APP_CALL_FEE = 2000n;

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "folks-finance",
  protocolVersion: "v2",
  action: "setup",
  variant: "optEscrowAsset"
};

export interface FolksSetupOptEscrowAssetInput {
  userAddress: string;
  escrowAddress: string;
  poolAppId?: number;
  assetId?: number;
  poolId?: string;
}

export interface FolksSetupOptEscrowAssetDependencies {
  resolvePoolState: (params: {
    network: ShapeBuildContext["network"];
    algod: Algodv2;
    poolAppId?: number;
    assetId?: number;
  }) => Promise<FolksPoolState>;
  getSuggestedParams: (algod: Algodv2) => Promise<SuggestedParams>;
  prepareOptDepositEscrowIntoAssetInDeposits: typeof prepareOptDepositEscrowIntoAssetInDeposits;
  isAccountOptedIntoAsset: typeof isAccountOptedIntoAsset;
  mainnetDepositsAppId: number;
  mainnetPoolManagerAppId: number;
}

let dependencyOverrides: Partial<FolksSetupOptEscrowAssetDependencies> | undefined;

export function setFolksSetupOptEscrowAssetDependenciesForTests(
  overrides?: Partial<FolksSetupOptEscrowAssetDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): FolksSetupOptEscrowAssetDependencies {
  return {
    resolvePoolState: resolveFolksPoolState,
    getSuggestedParams,
    prepareOptDepositEscrowIntoAssetInDeposits,
    isAccountOptedIntoAsset,
    mainnetDepositsAppId: MainnetDepositsAppId,
    mainnetPoolManagerAppId: MainnetPoolManagerAppId,
    ...dependencyOverrides
  };
}

export const folksFinanceSetupOptEscrowAssetShape: TransactionShapeSpec<
  FolksSetupOptEscrowAssetInput,
  FolksPoolState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Folks Finance v2 opt deposit escrow into pool fAsset",
  description:
    "Opts an existing Folks Finance deposit escrow into a pool fAsset so it can receive deposits.",
  supportedOpportunityTypes: ["lending"],
  requiredInputs: ["userAddress", "escrowAddress"],
  sources: [
    {
      kind: "sdk",
      description: "@folks-finance/algorand-sdk prepareOptDepositEscrowIntoAssetInDeposits"
    }
  ],

  parseInput(raw: unknown): FolksSetupOptEscrowAssetInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    const poolSelector = parsePoolSelector(value);
    const poolId = parseOptionalPoolId(value.poolId);

    return {
      userAddress: parseAddress(value.userAddress),
      escrowAddress: parseRequiredEscrowAddress(value.escrowAddress),
      ...(poolId === undefined ? {} : { poolId }),
      ...poolSelector
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: FolksSetupOptEscrowAssetInput
  ): Promise<FolksPoolState> {
    const dependencies = resolveDependencies();
    return dependencies.resolvePoolState({
      network: context.network,
      algod: context.algod,
      ...(input.poolAppId === undefined ? {} : { poolAppId: input.poolAppId }),
      ...(input.assetId === undefined ? {} : { assetId: input.assetId })
    });
  },

  async build(
    context: ShapeBuildContext,
    input: FolksSetupOptEscrowAssetInput,
    state: FolksPoolState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings: string[] = [];

    const alreadyOpted = await dependencies.isAccountOptedIntoAsset(
      context.algod,
      input.escrowAddress,
      Number(state.pool.fAssetId)
    );
    if (alreadyOpted) {
      warnings.push("Escrow already appears opted into the pool fAsset.");
    }

    let params: SuggestedParams;
    try {
      params = await dependencies.getSuggestedParams(context.algod);
    } catch (error) {
      throw new ShapeBuildError("Failed to fetch suggested params for Folks escrow opt-in.", {
        cause: error
      });
    }

    let optTxn: Transaction;
    try {
      optTxn = dependencies.prepareOptDepositEscrowIntoAssetInDeposits(
        dependencies.mainnetDepositsAppId,
        dependencies.mainnetPoolManagerAppId,
        input.userAddress,
        input.escrowAddress,
        state.pool,
        params
      );
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Folks Finance escrow opt-in transaction.", {
        cause: error
      });
    }

    const transactions = normalizeTransactions([optTxn]);

    return {
      transactions,
      warnings,
      metadata: {
        symbol: state.symbol,
        poolAppId: state.pool.appId,
        escrowAddress: input.escrowAddress,
        fAssetId: Number(state.pool.fAssetId),
        ...(input.poolId === undefined ? {} : { poolId: input.poolId })
      }
    };
  },

  validate(
    group,
    input: FolksSetupOptEscrowAssetInput,
    state: FolksPoolState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const dependencies = resolveDependencies();

    if (group.length !== 1) {
      errors.push(`Expected exactly 1 transaction, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    const appTxn = group[0];
    if (appTxn === undefined || appTxn.type !== "appl" || !appTxn.applicationCall) {
      errors.push("Opt-in must be a deposits application call.");
    } else {
      if (appTxn.sender !== input.userAddress) {
        errors.push("Opt-in app call sender must be the user address.");
      }
      if (appTxn.applicationCall.appIndex !== String(dependencies.mainnetDepositsAppId)) {
        errors.push("Opt-in app call must target the Folks deposits application.");
      }
      if (BigInt(appTxn.fee) < OPT_ESCROW_APP_CALL_FEE) {
        errors.push(
          `Opt-in app call fee must be at least ${OPT_ESCROW_APP_CALL_FEE.toString()} microAlgos.`
        );
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};
