import { Algodv2, SuggestedParams, Transaction } from "algosdk";
import {
  calcDepositReturn,
  prepareDepositIntoPool,
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
  parseOptionalEscrowAddress,
  parseOptionalPoolId,
  parsePoolSelector,
  parsePositiveBaseUnitAmount
} from "./parse-input.js";
import {
  FolksEscrowContext,
  FolksPoolState,
  MainnetOpUp,
  MainnetPoolManagerAppId,
  createFolksBuilderAlgodClient,
  getAccountAssetBalance,
  getFolksBuilderAlgodSdk,
  getSuggestedParams,
  resolveFolksEscrowContext,
  resolveFolksPoolState
} from "./pool-state.js";

const ALGO_ASSET_ID = 0;
const DEPOSIT_APP_CALL_FEE = 4000n;
const OPUP_INNER_TXNS = 0;

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "folks-finance",
  protocolVersion: "v2",
  action: "deposit",
  variant: "escrow"
};

export interface FolksDepositEscrowInput {
  userAddress: string;
  assetAmount: bigint;
  poolAppId?: number;
  assetId?: number;
  escrowAddress?: string;
  includeOpUp: boolean;
  poolId?: string;
}

export interface FolksDepositEscrowState {
  poolState: FolksPoolState;
  escrow: FolksEscrowContext;
}

export interface FolksDepositEscrowDependencies {
  resolvePoolState: (params: {
    network: ShapeBuildContext["network"];
    algod: Algodv2;
    poolAppId?: number;
    assetId?: number;
  }) => Promise<FolksPoolState>;
  resolveEscrowContext: typeof resolveFolksEscrowContext;
  getSuggestedParams: (algod: Algodv2) => Promise<SuggestedParams>;
  prepareDepositIntoPool: typeof prepareDepositIntoPool;
  prefixWithOpUp: typeof prefixWithOpUp;
  getAccountAssetBalance: typeof getAccountAssetBalance;
  mainnetPoolManagerAppId: number;
  mainnetOpUp: typeof MainnetOpUp;
}

let dependencyOverrides: Partial<FolksDepositEscrowDependencies> | undefined;

export function setFolksDepositEscrowDependenciesForTests(
  overrides?: Partial<FolksDepositEscrowDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): FolksDepositEscrowDependencies {
  return {
    resolvePoolState: resolveFolksPoolState,
    resolveEscrowContext: resolveFolksEscrowContext,
    getSuggestedParams,
    prepareDepositIntoPool,
    prefixWithOpUp,
    getAccountAssetBalance,
    mainnetPoolManagerAppId: MainnetPoolManagerAppId,
    mainnetOpUp: MainnetOpUp,
    ...dependencyOverrides
  };
}

export const folksFinanceDepositEscrowShape: TransactionShapeSpec<
  FolksDepositEscrowInput,
  FolksDepositEscrowState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Folks Finance v2 escrow deposit",
  description:
    "Deposits an underlying asset into a Folks Finance lending pool via a deposit " +
    "escrow. fAssets accrue in the escrow rather than the user's wallet. Generates " +
    "the SDK deposit group (asset transfer + deposit app call), optionally prefixed with OpUp.",
  supportedOpportunityTypes: ["lending"],
  opportunityRole: "enter",
  requiredInputs: ["userAddress", "assetAmount"],
  sources: [
    {
      kind: "sdk",
      description:
        "@folks-finance/algorand-sdk prepareDepositIntoPool (escrow receiver) + prefixWithOpUp"
    }
  ],

  parseInput(raw: unknown): FolksDepositEscrowInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    const poolSelector = parsePoolSelector(value);
    const poolId = parseOptionalPoolId(value.poolId);
    const escrowAddress = parseOptionalEscrowAddress(value.escrowAddress);

    return {
      userAddress: parseAddress(value.userAddress),
      assetAmount: parsePositiveBaseUnitAmount(value.assetAmount, "assetAmount"),
      includeOpUp: parseIncludeOpUp(value.includeOpUp),
      ...(poolId === undefined ? {} : { poolId }),
      ...(escrowAddress === undefined ? {} : { escrowAddress }),
      ...poolSelector
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: FolksDepositEscrowInput
  ): Promise<FolksDepositEscrowState> {
    const dependencies = resolveDependencies();
    const poolState = await dependencies.resolvePoolState({
      network: context.network,
      algod: context.algod,
      ...(input.poolAppId === undefined ? {} : { poolAppId: input.poolAppId }),
      ...(input.assetId === undefined ? {} : { assetId: input.assetId })
    });
    const escrow = await dependencies.resolveEscrowContext({
      algod: context.algod,
      userAddress: input.userAddress,
      pool: poolState.pool,
      ...(input.escrowAddress === undefined ? {} : { escrowAddress: input.escrowAddress })
    });

    return { poolState, escrow };
  },

  async build(
    context: ShapeBuildContext,
    input: FolksDepositEscrowInput,
    state: FolksDepositEscrowState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings: string[] = [];
    const { poolState, escrow } = state;

    if (!escrow.optedIntoFAsset) {
      throw new ShapeBuildError(
        "Deposit escrow is not opted into the pool fAsset; compile setup:optEscrowAsset first.",
        {
          details: {
            escrowAddress: escrow.escrowAddress,
            fAssetId: poolState.pool.fAssetId
          }
        }
      );
    }

    let params: SuggestedParams;
    try {
      params = await dependencies.getSuggestedParams(createFolksBuilderAlgodClient());
    } catch (error) {
      throw new ShapeBuildError("Failed to fetch suggested params for Folks escrow deposit.", {
        cause: error
      });
    }

    let depositTxns: Transaction[];
    try {
      depositTxns = dependencies.prepareDepositIntoPool(
        poolState.pool,
        dependencies.mainnetPoolManagerAppId,
        input.userAddress,
        escrow.escrowAddress,
        input.assetAmount,
        params
      );
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Folks Finance escrow deposit transactions.", {
        cause: error
      });
    }

    const builderAlgosdk = getFolksBuilderAlgodSdk();
    let groupTxns = depositTxns;
    if (input.includeOpUp) {
      groupTxns = dependencies.prefixWithOpUp(
        dependencies.mainnetOpUp,
        input.userAddress,
        depositTxns,
        OPUP_INNER_TXNS,
        params
      );
    }

    builderAlgosdk.assignGroupID(groupTxns);
    const transactions = normalizeTransactions(groupTxns);

    const expectedFAssetOut = calcDepositReturn(
      input.assetAmount,
      poolState.depositInterestIndex
    );
    const assetBalance = await dependencies.getAccountAssetBalance(
      context.algod,
      input.userAddress,
      Number(poolState.pool.assetId)
    );

    if (assetBalance < input.assetAmount) {
      warnings.push(
        `User underlying asset balance (${assetBalance.toString()}) is below the requested deposit amount.`
      );
    }
    if (poolState.poolInfo.config.depreciated) {
      warnings.push("Pool is marked depreciated in on-chain config.");
    }

    return {
      transactions,
      warnings,
      metadata: {
        symbol: poolState.symbol,
        poolAppId: poolState.pool.appId,
        poolAppAddress: poolState.poolAppAddress,
        escrowAddress: escrow.escrowAddress,
        underlyingAssetId: Number(poolState.pool.assetId),
        fAssetId: Number(poolState.pool.fAssetId),
        assetAmount: input.assetAmount.toString(),
        depositInterestIndex: poolState.depositInterestIndex.toString(),
        expectedFAssetOut: expectedFAssetOut.toString(),
        includeOpUp: input.includeOpUp,
        ...(input.poolId === undefined ? {} : { poolId: input.poolId })
      }
    };
  },

  validate(
    group,
    input: FolksDepositEscrowInput,
    state: FolksDepositEscrowState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const { poolState, escrow } = state;
    const expectedLength = input.includeOpUp ? 3 : 2;

    if (group.length !== expectedLength) {
      errors.push(`Expected exactly ${expectedLength} transactions, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    const transferIndex = input.includeOpUp ? 1 : 0;
    const appIndex = input.includeOpUp ? 2 : 1;

    if (input.includeOpUp) {
      const opUpTxn = group[0];
      if (opUpTxn === undefined || opUpTxn.type !== "appl" || !opUpTxn.applicationCall) {
        errors.push("Transaction 1 must be an OpUp application call when includeOpUp is true.");
      } else if (opUpTxn.sender !== input.userAddress) {
        errors.push("OpUp transaction sender must be the user address.");
      }
    }

    const transferTxn = group[transferIndex];
    const underlyingAssetId = Number(poolState.pool.assetId);
    if (underlyingAssetId === ALGO_ASSET_ID) {
      if (transferTxn === undefined || transferTxn.type !== "pay" || !transferTxn.payment) {
        errors.push("Deposit transfer must be an ALGO payment when the pool asset is ALGO.");
      } else if (transferTxn.payment.receiver !== poolState.poolAppAddress) {
        errors.push("Deposit transfer receiver must be the pool application address.");
      } else if (transferTxn.payment.amount !== input.assetAmount.toString()) {
        errors.push("Deposit transfer amount must equal the requested asset amount.");
      }
    } else if (
      transferTxn === undefined ||
      transferTxn.type !== "axfer" ||
      !transferTxn.assetTransfer
    ) {
      errors.push("Deposit transfer must be an asset transfer.");
    } else if (transferTxn.assetTransfer.receiver !== poolState.poolAppAddress) {
      errors.push("Deposit transfer receiver must be the pool application address.");
    } else if (transferTxn.assetTransfer.amount !== input.assetAmount.toString()) {
      errors.push("Deposit transfer amount must equal the requested asset amount.");
    }

    const appTxn = group[appIndex];
    if (appTxn === undefined || appTxn.type !== "appl" || !appTxn.applicationCall) {
      errors.push("Final transaction must be the pool deposit application call.");
    } else {
      if (appTxn.sender !== input.userAddress) {
        errors.push("Deposit app call sender must be the user address.");
      }
      if (appTxn.applicationCall.appIndex !== String(poolState.pool.appId)) {
        errors.push("Deposit app call must target the pool application.");
      }
      if (BigInt(appTxn.fee) < DEPOSIT_APP_CALL_FEE) {
        errors.push(
          `Deposit app call fee must be at least ${DEPOSIT_APP_CALL_FEE.toString()} microAlgos.`
        );
      }
    }

    if (group.some((txn) => !txn.groupPresent)) {
      errors.push("All transactions must belong to a single atomic group.");
    }

    if (!escrow.optedIntoFAsset) {
      warnings.push("Escrow must be opted into the pool fAsset before submit.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};
