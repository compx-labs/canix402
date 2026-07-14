import algosdk, { Algodv2, Transaction } from "algosdk";
import { buildWithdrawTransactions } from "@compx/sdk";

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
  readAppCallSelectorHex,
  rejectUnexpectedSignerMetadata,
  type LendingTransactionBundle
} from "./shared.js";

const WITHDRAW_METHOD_SELECTOR_HEX = "f445489b";

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "compx",
  protocolVersion: "v1",
  action: "withdraw",
  variant: "asa"
};

export interface CompXWithdrawAsaInput {
  userAddress: string;
  marketAppId: number;
  amount: bigint;
  poolId?: string;
}

export interface CompXWithdrawAsaDependencies {
  resolveMarketState: typeof resolveCompXLendingMarketState;
  buildWithdrawTransactions: typeof buildWithdrawTransactions;
}

let dependencyOverrides: Partial<CompXWithdrawAsaDependencies> | undefined;

export function setCompXWithdrawAsaDependenciesForTests(
  overrides?: Partial<CompXWithdrawAsaDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): CompXWithdrawAsaDependencies {
  return {
    resolveMarketState: resolveCompXLendingMarketState,
    buildWithdrawTransactions,
    ...dependencyOverrides
  };
}

export const compxWithdrawAsaShape: TransactionShapeSpec<
  CompXWithdrawAsaInput,
  CompXLendingMarketState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "CompX v1 ASA lending withdraw",
  description:
    "Withdraws base ASA from a CompX lending market by burning LST tokens. The amount is " +
    "LST-denominated. Wraps @compx/sdk buildWithdrawTransactions, including the optional " +
    "leading base-asset opt-in when needed.",
  supportedOpportunityTypes: ["lending"],
  requiredInputs: ["userAddress", "marketAppId", "amount"],
  sources: [
    {
      kind: "sdk",
      description: "@compx/sdk buildWithdrawTransactions / withdrawDeposit(axfer,uint64)void"
    }
  ],

  parseInput(raw: unknown): CompXWithdrawAsaInput {
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
    input: CompXWithdrawAsaInput
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
    input: CompXWithdrawAsaInput,
    state: CompXLendingMarketState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings: string[] = [];

    if (input.amount > state.userLstBalance) {
      warnings.push(
        `User LST balance (${state.userLstBalance.toString()}) is below the requested withdraw amount.`
      );
    }

    let bundle: LendingTransactionBundle;
    try {
      bundle = (await dependencies.buildWithdrawTransactions(context.algod, {
        appId: input.marketAppId,
        sender: input.userAddress,
        amount: input.amount,
        appCallMaxFee: Number(DEFAULT_COMPX_APP_CALL_MAX_FEE)
      })) as unknown as LendingTransactionBundle;
    } catch (error) {
      throw new ShapeBuildError("Failed to generate CompX lending withdraw transactions.", {
        cause: error
      });
    }

    rejectUnexpectedSignerMetadata(bundle.signers, input.userAddress);

    const transactions = normalizeTransactions(bundle.transactions);
    algosdk.assignGroupID(transactions);

    return {
      transactions,
      warnings,
      metadata: {
        marketAppId: state.marketAppId,
        marketAppAddress: state.marketAppAddress,
        baseTokenId: state.baseTokenId,
        lstTokenId: state.lstTokenId,
        amount: input.amount.toString(),
        amountDenomination: "lst",
        optInsIncluded: bundle.metadata.optInsIncluded ?? [],
        appCallMaxFee: DEFAULT_COMPX_APP_CALL_MAX_FEE.toString(),
        ...(input.poolId === undefined ? {} : { poolId: input.poolId })
      }
    };
  },

  validate(
    group,
    input: CompXWithdrawAsaInput,
    state: CompXLendingMarketState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const includesBaseOptIn = !state.userOptedIntoBase;
    const expectedLength = includesBaseOptIn ? 3 : 2;
    if (group.length !== expectedLength) {
      errors.push(`Expected exactly ${expectedLength} transactions, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    let transferIndex = 0;
    if (includesBaseOptIn) {
      validateAssetOptInTxn({
        txn: group[0],
        label: "Transaction 1",
        userAddress: input.userAddress,
        assetId: state.baseTokenId,
        errors
      });
      transferIndex = 1;
    }

    const transferTxn = group[transferIndex];
    validateLstTransferTxn({
      txn: transferTxn,
      label: `Transaction ${transferIndex + 1}`,
      userAddress: input.userAddress,
      receiver: state.marketAppAddress,
      lstTokenId: state.lstTokenId,
      amount: input.amount,
      errors
    });

    const appTxn = group[transferIndex + 1];
    validateWithdrawAppCallTxn({
      txn: appTxn,
      label: `Transaction ${transferIndex + 2}`,
      userAddress: input.userAddress,
      marketAppId: state.marketAppId,
      baseTokenId: state.baseTokenId,
      errors
    });

    assertGroupedTransactions(group, errors);

    if (input.amount > state.userLstBalance) {
      warnings.push("Requested LST amount exceeds the resolved user LST balance.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};

function validateAssetOptInTxn(params: {
  txn: SerializedTransaction | undefined;
  label: string;
  userAddress: string;
  assetId: number;
  errors: string[];
}): void {
  const { txn, label, userAddress, assetId, errors } = params;
  if (txn === undefined || txn.type !== "axfer" || !txn.assetTransfer) {
    errors.push(`${label} must be an asset opt-in transfer.`);
    return;
  }
  if (txn.sender !== userAddress) {
    errors.push(`${label} sender must be the user address.`);
  }
  if (txn.assetTransfer.receiver !== userAddress) {
    errors.push(`${label} receiver must be the user address for opt-in.`);
  }
  if (txn.assetTransfer.assetIndex !== String(assetId)) {
    errors.push(`${label} must opt into asset id ${assetId}.`);
  }
  if (txn.assetTransfer.amount !== "0") {
    errors.push(`${label} opt-in amount must be zero.`);
  }
}

function validateLstTransferTxn(params: {
  txn: SerializedTransaction | undefined;
  label: string;
  userAddress: string;
  receiver: string;
  lstTokenId: number;
  amount: bigint;
  errors: string[];
}): void {
  const { txn, label, userAddress, receiver, lstTokenId, amount, errors } = params;
  if (txn === undefined || txn.type !== "axfer" || !txn.assetTransfer) {
    errors.push(`${label} must be an LST asset transfer.`);
    return;
  }
  if (txn.sender !== userAddress) {
    errors.push(`${label} sender must be the user address.`);
  }
  if (txn.assetTransfer.receiver !== receiver) {
    errors.push(`${label} receiver must be the market application address.`);
  }
  if (txn.assetTransfer.assetIndex !== String(lstTokenId)) {
    errors.push(`${label} asset must be LST token id ${lstTokenId}.`);
  }
  if (txn.assetTransfer.amount !== amount.toString()) {
    errors.push(`${label} amount must equal the requested LST withdraw amount.`);
  }
}

function validateWithdrawAppCallTxn(params: {
  txn: SerializedTransaction | undefined;
  label: string;
  userAddress: string;
  marketAppId: number;
  baseTokenId: number;
  errors: string[];
}): void {
  const { txn, label, userAddress, marketAppId, baseTokenId, errors } = params;
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
  if (readAppCallSelectorHex(txn) !== WITHDRAW_METHOD_SELECTOR_HEX) {
    errors.push(`${label} must call withdrawDeposit(axfer,uint64)void.`);
  }
  if (!txn.applicationCall.foreignAssets.includes(String(baseTokenId))) {
    errors.push(`${label} foreign assets must include the base token.`);
  }
  if (BigInt(txn.fee) < COMPX_LENDING_APP_CALL_MIN_FEE) {
    errors.push(
      `${label} fee must be at least ${COMPX_LENDING_APP_CALL_MIN_FEE.toString()} microAlgos.`
    );
  }
}

export function buildMockWithdrawGroup(params: {
  user: algosdk.Account;
  marketAppId: number;
  marketAppAddress: string;
  baseTokenId: number;
  lstTokenId: number;
  amount: bigint;
  includeBaseOptIn: boolean;
  suggestedParams: algosdk.SuggestedParams;
}): Transaction[] {
  const txns: Transaction[] = [];
  if (params.includeBaseOptIn) {
    txns.push(
      algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: params.user.addr,
        receiver: params.user.addr,
        assetIndex: params.baseTokenId,
        amount: 0n,
        suggestedParams: params.suggestedParams
      })
    );
  }
  txns.push(
    algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: params.user.addr,
      receiver: params.marketAppAddress,
      assetIndex: params.lstTokenId,
      amount: params.amount,
      suggestedParams: params.suggestedParams
    })
  );
  txns.push(
    algosdk.makeApplicationNoOpTxnFromObject({
      sender: params.user.addr,
      appIndex: BigInt(params.marketAppId),
      appArgs: [Buffer.from(WITHDRAW_METHOD_SELECTOR_HEX, "hex")],
      foreignAssets: [BigInt(params.baseTokenId), BigInt(params.lstTokenId)],
      suggestedParams: {
        ...params.suggestedParams,
        fee: DEFAULT_COMPX_APP_CALL_MAX_FEE,
        flatFee: true
      }
    })
  );
  algosdk.assignGroupID(txns);
  return txns;
}
