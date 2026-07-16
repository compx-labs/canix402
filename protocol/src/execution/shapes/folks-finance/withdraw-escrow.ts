import { Algodv2, SuggestedParams, Transaction } from "algosdk";
import { prepareWithdrawFromDepositEscrowInDeposits } from "@folks-finance/algorand-sdk";

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
  parseOptionalEscrowAddress,
  parseOptionalPoolId,
  parsePoolSelector,
  parsePositiveBaseUnitAmount
} from "./parse-input.js";
import {
  FolksEscrowContext,
  FolksPoolState,
  MainnetDepositsAppId,
  MainnetPoolManagerAppId,
  createFolksBuilderAlgodClient,
  getSuggestedParams,
  resolveFolksEscrowContext,
  resolveFolksPoolState
} from "./pool-state.js";

const WITHDRAW_ESCROW_APP_CALL_FEE = 6000n;

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "folks-finance",
  protocolVersion: "v2",
  action: "withdraw",
  variant: "escrow"
};

export interface FolksWithdrawEscrowInput {
  userAddress: string;
  amount: bigint;
  amountDenomination: "asset" | "fAsset";
  poolAppId?: number;
  assetId?: number;
  escrowAddress?: string;
  poolId?: string;
}

export interface FolksWithdrawEscrowState {
  poolState: FolksPoolState;
  escrow: FolksEscrowContext;
}

export interface FolksEscrowWithdrawParams {
  amount: bigint;
  isfAssetAmount: boolean;
  remainDeposited: boolean;
}

export interface FolksWithdrawEscrowDependencies {
  resolvePoolState: (params: {
    network: ShapeBuildContext["network"];
    algod: Algodv2;
    poolAppId?: number;
    assetId?: number;
  }) => Promise<FolksPoolState>;
  resolveEscrowContext: typeof resolveFolksEscrowContext;
  getSuggestedParams: (algod: Algodv2) => Promise<SuggestedParams>;
  prepareWithdrawFromDepositEscrowInDeposits: typeof prepareWithdrawFromDepositEscrowInDeposits;
  mainnetDepositsAppId: number;
  mainnetPoolManagerAppId: number;
}

let dependencyOverrides: Partial<FolksWithdrawEscrowDependencies> | undefined;

export function setFolksWithdrawEscrowDependenciesForTests(
  overrides?: Partial<FolksWithdrawEscrowDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): FolksWithdrawEscrowDependencies {
  return {
    resolvePoolState: resolveFolksPoolState,
    resolveEscrowContext: resolveFolksEscrowContext,
    getSuggestedParams,
    prepareWithdrawFromDepositEscrowInDeposits,
    mainnetDepositsAppId: MainnetDepositsAppId,
    mainnetPoolManagerAppId: MainnetPoolManagerAppId,
    ...dependencyOverrides
  };
}

export function computeEscrowWithdrawParams(
  input: FolksWithdrawEscrowInput
): FolksEscrowWithdrawParams {
  return {
    amount: input.amount,
    isfAssetAmount: input.amountDenomination === "fAsset",
    remainDeposited: false
  };
}

export const folksFinanceWithdrawEscrowShape: TransactionShapeSpec<
  FolksWithdrawEscrowInput,
  FolksWithdrawEscrowState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Folks Finance v2 escrow withdraw",
  description:
    "Withdraws underlying assets from a Folks Finance lending pool via a deposit " +
    "escrow. Generates the SDK deposits-app withdraw call; assets are sent to the user wallet.",
  supportedOpportunityTypes: ["lending"],
  requiredInputs: ["userAddress", "amount", "amountDenomination"],
  sources: [
    {
      kind: "sdk",
      description: "@folks-finance/algorand-sdk prepareWithdrawFromDepositEscrowInDeposits"
    }
  ],

  parseInput(raw: unknown): FolksWithdrawEscrowInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    const poolSelector = parsePoolSelector(value);
    const poolId = parseOptionalPoolId(value.poolId);
    const escrowAddress = parseOptionalEscrowAddress(value.escrowAddress);

    return {
      userAddress: parseAddress(value.userAddress),
      amount: parsePositiveBaseUnitAmount(value.amount, "amount"),
      amountDenomination: parseAmountDenomination(value.amountDenomination),
      ...(poolId === undefined ? {} : { poolId }),
      ...(escrowAddress === undefined ? {} : { escrowAddress }),
      ...poolSelector
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: FolksWithdrawEscrowInput
  ): Promise<FolksWithdrawEscrowState> {
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
      requireFAssetBalance: true,
      ...(input.escrowAddress === undefined ? {} : { escrowAddress: input.escrowAddress })
    });

    return { poolState, escrow };
  },

  async build(
    context: ShapeBuildContext,
    input: FolksWithdrawEscrowInput,
    state: FolksWithdrawEscrowState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings: string[] = [];
    const { poolState, escrow } = state;
    const withdrawParams = computeEscrowWithdrawParams(input);

    if (withdrawParams.isfAssetAmount && escrow.fAssetBalance < input.amount) {
      warnings.push(
        `Escrow fAsset balance (${escrow.fAssetBalance.toString()}) is below the requested withdraw amount.`
      );
    }

    let params: SuggestedParams;
    try {
      params = await dependencies.getSuggestedParams(createFolksBuilderAlgodClient());
    } catch (error) {
      throw new ShapeBuildError("Failed to fetch suggested params for Folks escrow withdraw.", {
        cause: error
      });
    }

    let withdrawTxn: Transaction;
    try {
      console.log("Preparing Folks escrow withdraw transaction...", {
        depositsAppId: dependencies.mainnetDepositsAppId,
        poolAppId: poolState.pool.appId,
        poolManagerAppId: dependencies.mainnetPoolManagerAppId,
        userAddress: input.userAddress,
        escrowAddress: escrow.escrowAddress,
        receiverAddress: input.userAddress,
        amount: withdrawParams.amount.toString(),
        amountDenomination: input.amountDenomination,
        isfAssetAmount: withdrawParams.isfAssetAmount,
        remainDeposited: withdrawParams.remainDeposited,
        escrowFAssetBalance: escrow.fAssetBalance.toString(),
        suggestedParams: {
          fee: params.fee.toString(),
          minFee: params.minFee.toString(),
          firstValid: params.firstValid.toString(),
          lastValid: params.lastValid.toString(),
          genesisID: params.genesisID,
          genesisHash:
            params.genesisHash === undefined
              ? undefined
              : Buffer.from(params.genesisHash).toString("base64"),
          flatFee: params.flatFee
        }
      });
      withdrawTxn = dependencies.prepareWithdrawFromDepositEscrowInDeposits(
        dependencies.mainnetDepositsAppId,
        poolState.pool,
        dependencies.mainnetPoolManagerAppId,
        input.userAddress,
        escrow.escrowAddress,
        input.userAddress,
        withdrawParams.amount,
        withdrawParams.isfAssetAmount,
        withdrawParams.remainDeposited,
        params
      );
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Folks Finance escrow withdraw transaction.", {
        cause: error
      });
    }

    const transactions = normalizeTransactions([withdrawTxn]);

    if (input.amountDenomination === "asset") {
      warnings.push(
        "Withdraw-by-asset uses on-chain state at quote time; re-quote before submit if balances move."
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
        escrowAddress: escrow.escrowAddress,
        underlyingAssetId: Number(poolState.pool.assetId),
        fAssetId: Number(poolState.pool.fAssetId),
        amount: input.amount.toString(),
        amountDenomination: input.amountDenomination,
        isfAssetAmount: withdrawParams.isfAssetAmount,
        remainDeposited: withdrawParams.remainDeposited,
        escrowFAssetBalance: escrow.fAssetBalance.toString(),
        ...(input.poolId === undefined ? {} : { poolId: input.poolId })
      }
    };
  },

  validate(
    group,
    input: FolksWithdrawEscrowInput,
    state: FolksWithdrawEscrowState
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
      errors.push("Withdraw must be a deposits application call.");
    } else {
      if (appTxn.sender !== input.userAddress) {
        errors.push("Withdraw app call sender must be the user address.");
      }
      if (appTxn.applicationCall.appIndex !== String(dependencies.mainnetDepositsAppId)) {
        errors.push("Withdraw app call must target the Folks deposits application.");
      }
      if (BigInt(appTxn.fee) < WITHDRAW_ESCROW_APP_CALL_FEE) {
        errors.push(
          `Withdraw app call fee must be at least ${WITHDRAW_ESCROW_APP_CALL_FEE.toString()} microAlgos.`
        );
      }
    }

    if (state.escrow.fAssetBalance < input.amount && input.amountDenomination === "fAsset") {
      warnings.push("Escrow fAsset balance may be insufficient for this withdrawal.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};
