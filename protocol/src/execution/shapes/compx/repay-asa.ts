import algosdk, { Transaction } from "algosdk";
import { buildRepayTransactions } from "@compx/sdk";

import { InvalidShapeInputError, ShapeBuildError } from "../../errors.js";
import { normalizeTransactions } from "../../normalize-transaction.js";
import {
  ShapeBuildContext,
  ShapeBuildResult,
  ShapeValidationResult,
  TransactionShapeIdentity,
  TransactionShapeSpec,
  buildShapeKey,
  type SerializedTransaction
} from "../../types.js";
import {
  type CompXLendingMarketState,
  resolveCompXLendingMarketState
} from "./market-state.js";
import {
  parseAddress,
  parseMarketSelector,
  parseOptionalPoolId,
  parsePositiveBaseUnitAmount
} from "./parse-input.js";
import {
  COMPX_LENDING_APP_CALL_MIN_FEE,
  DEFAULT_COMPX_APP_CALL_MAX_FEE,
  assertGroupedTransactions,
  createCompXBuilderAlgodClient,
  readAppCallSelectorHex,
  rejectUnexpectedSignerMetadata,
  type LendingTransactionBundle
} from "./shared.js";

const REPAY_METHOD_SELECTOR_HEX = "3dea8a60";

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "compx",
  protocolVersion: "v1",
  action: "repay",
  variant: "asa"
};

export interface CompXRepayAsaInput {
  userAddress: string;
  marketAppId: number;
  amount: bigint;
  poolId?: string;
}

export interface CompXRepayAsaDependencies {
  resolveMarketState: typeof resolveCompXLendingMarketState;
  buildRepayTransactions: typeof buildRepayTransactions;
}

let dependencyOverrides: Partial<CompXRepayAsaDependencies> | undefined;

export function setCompXRepayAsaDependenciesForTests(
  overrides?: Partial<CompXRepayAsaDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): CompXRepayAsaDependencies {
  return {
    resolveMarketState: resolveCompXLendingMarketState,
    buildRepayTransactions,
    ...dependencyOverrides
  };
}

export const compxRepayAsaShape: TransactionShapeSpec<
  CompXRepayAsaInput,
  CompXLendingMarketState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "CompX v1 ASA lending repay",
  description:
    "Repays outstanding base-ASA debt on a CompX lending market. Wraps " +
    "@compx/sdk buildRepayTransactions: base transfer then repayLoanASA(axfer,uint64)void. " +
    "amount is base-asset denominated.",
  supportedOpportunityTypes: ["lending"],
  opportunityRole: "exit",
  requiredInputs: ["userAddress", "marketAppId", "amount"],
  sources: [
    {
      kind: "sdk",
      description:
        "@compx/sdk buildRepayTransactions / repayLoanASA(axfer,uint64)void"
    }
  ],

  parseInput(raw: unknown): CompXRepayAsaInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    const poolId = parseOptionalPoolId(value.poolId);

    return {
      userAddress: parseAddress(value.userAddress),
      amount: parsePositiveBaseUnitAmount(value.amount, "amount"),
      ...parseMarketSelector(value),
      ...(poolId === undefined ? {} : { poolId })
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: CompXRepayAsaInput
  ): Promise<CompXLendingMarketState> {
    const dependencies = resolveDependencies();
    return dependencies.resolveMarketState({
      network: context.network,
      algod: context.algod,
      marketAppId: input.marketAppId,
      userAddress: input.userAddress
    });
  },

  async build(
    context: ShapeBuildContext,
    input: CompXRepayAsaInput,
    state: CompXLendingMarketState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings: string[] = [];

    if (input.amount > state.userBaseBalance) {
      warnings.push(
        `User base asset balance (${state.userBaseBalance.toString()}) is below the requested repay amount.`
      );
    }

    let bundle: LendingTransactionBundle;
    try {
      bundle = (await dependencies.buildRepayTransactions(
        createCompXBuilderAlgodClient(),
        {
          appId: input.marketAppId,
          sender: input.userAddress,
          amount: input.amount,
          appCallMaxFee: Number(DEFAULT_COMPX_APP_CALL_MAX_FEE)
        }
      )) as unknown as LendingTransactionBundle;
    } catch (error) {
      throw new ShapeBuildError(
        "Failed to generate CompX lending repay transactions.",
        { cause: error }
      );
    }

    rejectUnexpectedSignerMetadata(bundle.signers, input.userAddress);

    const transactions = normalizeTransactions(bundle.transactions);

    return {
      transactions,
      warnings,
      metadata: {
        marketAppId: state.marketAppId,
        marketAppAddress: state.marketAppAddress,
        baseTokenId: state.baseTokenId,
        lstTokenId: state.lstTokenId,
        amount: input.amount.toString(),
        amountDenomination: "base",
        optInsIncluded: bundle.metadata.optInsIncluded ?? [],
        appCallMaxFee: DEFAULT_COMPX_APP_CALL_MAX_FEE.toString(),
        ...(input.poolId === undefined ? {} : { poolId: input.poolId })
      }
    };
  },

  validate(
    group,
    input: CompXRepayAsaInput,
    state: CompXLendingMarketState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (group.length !== 2) {
      errors.push(`Expected exactly 2 transactions, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    validateBaseAssetTransferTxn({
      txn: group[0],
      label: "Transaction 1",
      userAddress: input.userAddress,
      receiver: state.marketAppAddress,
      assetId: state.baseTokenId,
      amount: input.amount,
      errors
    });

    validateRepayAppCallTxn({
      txn: group[1],
      label: "Transaction 2",
      userAddress: input.userAddress,
      marketAppId: state.marketAppId,
      errors
    });

    assertGroupedTransactions(group, errors);

    if (input.amount > state.userBaseBalance) {
      warnings.push(
        "Requested repay amount exceeds the resolved user base asset balance."
      );
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};

function validateBaseAssetTransferTxn(params: {
  txn: SerializedTransaction | undefined;
  label: string;
  userAddress: string;
  receiver: string;
  assetId: number;
  amount: bigint;
  errors: string[];
}): void {
  const { txn, label, userAddress, receiver, assetId, amount, errors } = params;
  if (txn === undefined || txn.type !== "axfer" || !txn.assetTransfer) {
    errors.push(`${label} must be a base asset transfer.`);
    return;
  }
  if (txn.sender !== userAddress) {
    errors.push(`${label} sender must be the user address.`);
  }
  if (txn.assetTransfer.receiver !== receiver) {
    errors.push(`${label} receiver must be the market application address.`);
  }
  if (txn.assetTransfer.assetIndex !== String(assetId)) {
    errors.push(`${label} asset must be base token id ${assetId}.`);
  }
  if (txn.assetTransfer.amount !== amount.toString()) {
    errors.push(`${label} amount must equal the requested repay amount.`);
  }
}

function validateRepayAppCallTxn(params: {
  txn: SerializedTransaction | undefined;
  label: string;
  userAddress: string;
  marketAppId: number;
  errors: string[];
}): void {
  const { txn, label, userAddress, marketAppId, errors } = params;
  if (txn === undefined || txn.type !== "appl" || !txn.applicationCall) {
    errors.push(`${label} must be an application call.`);
    return;
  }
  if (txn.sender !== userAddress) {
    errors.push(`${label} sender must be the user address.`);
  }
  if (txn.applicationCall.appIndex !== String(marketAppId)) {
    errors.push(`${label} must call market app id ${marketAppId}.`);
  }
  if (readAppCallSelectorHex(txn) !== REPAY_METHOD_SELECTOR_HEX) {
    errors.push(`${label} must call repayLoanASA(axfer,uint64)void.`);
  }
  if (BigInt(txn.fee) < COMPX_LENDING_APP_CALL_MIN_FEE) {
    errors.push(
      `${label} fee must be at least ${COMPX_LENDING_APP_CALL_MIN_FEE.toString()} microAlgos.`
    );
  }
}

export function buildMockRepayGroup(params: {
  user: algosdk.Account;
  marketAppId: number;
  marketAppAddress: string;
  baseTokenId: number;
  lstTokenId: number;
  amount: bigint;
  suggestedParams: algosdk.SuggestedParams;
}): Transaction[] {
  const txns: Transaction[] = [
    algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: params.user.addr,
      receiver: params.marketAppAddress,
      assetIndex: params.baseTokenId,
      amount: params.amount,
      suggestedParams: params.suggestedParams
    }),
    algosdk.makeApplicationNoOpTxnFromObject({
      sender: params.user.addr,
      appIndex: BigInt(params.marketAppId),
      appArgs: [Buffer.from(REPAY_METHOD_SELECTOR_HEX, "hex")],
      foreignAssets: [BigInt(params.baseTokenId), BigInt(params.lstTokenId)],
      suggestedParams: {
        ...params.suggestedParams,
        fee: DEFAULT_COMPX_APP_CALL_MAX_FEE,
        flatFee: true
      }
    })
  ];
  algosdk.assignGroupID(txns);
  return txns;
}
