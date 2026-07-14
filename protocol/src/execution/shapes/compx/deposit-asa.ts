import algosdk, { Algodv2, Transaction } from "algosdk";
import { buildDepositTransactions } from "@compx/sdk";

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
  getSuggestedParams,
  readAppCallSelectorHex,
  rejectUnexpectedSignerMetadata,
  validateSingleUserSigners,
  type LendingTransactionBundle
} from "./shared.js";

const DEPOSIT_METHOD_SELECTOR_HEX = "3acbfb6f";

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "compx",
  protocolVersion: "v1",
  action: "deposit",
  variant: "asa"
};

export interface CompXDepositAsaInput {
  userAddress: string;
  marketAppId: number;
  amount: bigint;
  poolId?: string;
}

export interface CompXDepositAsaDependencies {
  resolveMarketState: typeof resolveCompXLendingMarketState;
  buildDepositTransactions: typeof buildDepositTransactions;
  getSuggestedParams: (algod: Algodv2) => Promise<algosdk.SuggestedParams>;
}

let dependencyOverrides: Partial<CompXDepositAsaDependencies> | undefined;

export function setCompXDepositAsaDependenciesForTests(
  overrides?: Partial<CompXDepositAsaDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): CompXDepositAsaDependencies {
  return {
    resolveMarketState: resolveCompXLendingMarketState,
    buildDepositTransactions,
    getSuggestedParams,
    ...dependencyOverrides
  };
}

export const compxDepositAsaShape: TransactionShapeSpec<
  CompXDepositAsaInput,
  CompXLendingMarketState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "CompX v1 ASA lending deposit",
  description:
    "Deposits a base ASA into a CompX lending market and receives LST tokens. Wraps " +
    "@compx/sdk buildDepositTransactions, including the optional leading LST opt-in when needed.",
  supportedOpportunityTypes: ["lending"],
  requiredInputs: ["userAddress", "marketAppId", "amount"],
  sources: [
    {
      kind: "sdk",
      description: "@compx/sdk buildDepositTransactions / depositASA(axfer,uint64)void"
    }
  ],

  parseInput(raw: unknown): CompXDepositAsaInput {
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
    input: CompXDepositAsaInput
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
    input: CompXDepositAsaInput,
    state: CompXLendingMarketState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings: string[] = [];

    if (input.amount > state.userBaseBalance) {
      warnings.push(
        `User base asset balance (${state.userBaseBalance.toString()}) is below the requested deposit amount.`
      );
    }

    let bundle: LendingTransactionBundle;
    try {
      console.log("Building deposit transactions... marketAppId:", input.marketAppId);
      console.log("Building deposit transactions... sender:", input.userAddress);
      console.log("Building deposit transactions... amount:", input.amount);
      console.log("Building deposit transactions... appCallMaxFee:", DEFAULT_COMPX_APP_CALL_MAX_FEE);
      bundle = (await dependencies.buildDepositTransactions(createCompXBuilderAlgodClient(), {
        appId: input.marketAppId,
        sender: input.userAddress,
        amount: input.amount,
        appCallMaxFee: Number(DEFAULT_COMPX_APP_CALL_MAX_FEE)
      })) as unknown as LendingTransactionBundle;
    } catch (error) {
      throw new ShapeBuildError("Failed to generate CompX lending deposit transactions.", {
        cause: error
      });
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
    input: CompXDepositAsaInput,
    state: CompXLendingMarketState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const includesLstOptIn = !state.userOptedIntoLst;
    const expectedLength = includesLstOptIn ? 3 : 2;
    if (group.length !== expectedLength) {
      errors.push(`Expected exactly ${expectedLength} transactions, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    let transferIndex = 0;
    if (includesLstOptIn) {
      validateAssetOptInTxn({
        txn: group[0],
        label: "Transaction 1",
        userAddress: input.userAddress,
        assetId: state.lstTokenId,
        errors
      });
      transferIndex = 1;
    }

    const transferTxn = group[transferIndex];
    validateBaseAssetTransferTxn({
      txn: transferTxn,
      label: `Transaction ${transferIndex + 1}`,
      userAddress: input.userAddress,
      receiver: state.marketAppAddress,
      assetId: state.baseTokenId,
      amount: input.amount,
      errors
    });

    const appTxn = group[transferIndex + 1];
    validateDepositAppCallTxn({
      txn: appTxn,
      label: `Transaction ${transferIndex + 2}`,
      userAddress: input.userAddress,
      marketAppId: state.marketAppId,
      lstTokenId: state.lstTokenId,
      errors
    });

    assertGroupedTransactions(group, errors);

    if (!state.userOptedIntoLst) {
      warnings.push("User must opt into the market LST before the deposit group can succeed.");
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
    errors.push(`${label} amount must equal the requested deposit amount.`);
  }
}

function validateDepositAppCallTxn(params: {
  txn: SerializedTransaction | undefined;
  label: string;
  userAddress: string;
  marketAppId: number;
  lstTokenId: number;
  errors: string[];
}): void {
  const { txn, label, userAddress, marketAppId, lstTokenId, errors } = params;
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
  if (readAppCallSelectorHex(txn) !== DEPOSIT_METHOD_SELECTOR_HEX) {
    errors.push(`${label} must call depositASA(axfer,uint64)void.`);
  }
  if (!txn.applicationCall.foreignAssets.includes(String(lstTokenId))) {
    errors.push(`${label} foreign assets must include the LST token.`);
  }
  if (BigInt(txn.fee) < COMPX_LENDING_APP_CALL_MIN_FEE) {
    errors.push(
      `${label} fee must be at least ${COMPX_LENDING_APP_CALL_MIN_FEE.toString()} microAlgos.`
    );
  }
}

export function validateCompXDepositSigners(
  signers: LendingTransactionBundle["signers"],
  userAddress: string,
  transactionCount: number
): ShapeValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  validateSingleUserSigners({ userAddress, signers, transactionCount, errors });
  return { valid: errors.length === 0, errors, warnings };
}

export function buildMockDepositGroup(params: {
  user: algosdk.Account;
  marketAppId: number;
  marketAppAddress: string;
  baseTokenId: number;
  lstTokenId: number;
  amount: bigint;
  includeLstOptIn: boolean;
  suggestedParams: algosdk.SuggestedParams;
}): Transaction[] {
  const txns: Transaction[] = [];
  if (params.includeLstOptIn) {
    txns.push(
      algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: params.user.addr,
        receiver: params.user.addr,
        assetIndex: params.lstTokenId,
        amount: 0n,
        suggestedParams: params.suggestedParams
      })
    );
  }
  txns.push(
    algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: params.user.addr,
      receiver: params.marketAppAddress,
      assetIndex: params.baseTokenId,
      amount: params.amount,
      suggestedParams: params.suggestedParams
    })
  );
  txns.push(
    algosdk.makeApplicationNoOpTxnFromObject({
      sender: params.user.addr,
      appIndex: BigInt(params.marketAppId),
      appArgs: [Buffer.from(DEPOSIT_METHOD_SELECTOR_HEX, "hex")],
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
