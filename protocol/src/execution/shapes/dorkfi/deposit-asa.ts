import algosdk, { Algodv2, Transaction } from "algosdk";

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
  DEFAULT_DORKFI_GROUP_FEE,
  DEPOSIT_METHOD_SELECTOR_HEX,
  MIN_ALGO_FEE
} from "./constants.js";
import { buildDorkFiAsaDepositTransactions } from "./lending-build.js";
import {
  type DorkFiLendingMarketState,
  resolveDorkFiLendingMarketState
} from "./market-state.js";
import {
  parseAddress,
  parseDorkFiMarketSelector,
  parseOptionalPoolId,
  parsePositiveBaseUnitAmount
} from "./parse-input.js";
import { assignCanonicalGroupID, assertGroupedTransactions, readAppCallSelectorHex } from "./shared.js";

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "dorkfi",
  protocolVersion: "v1",
  action: "deposit",
  variant: "asa"
};

export interface DorkFiDepositAsaInput {
  userAddress: string;
  poolAppId: number;
  marketAppId: number;
  assetId: number;
  amount: bigint;
  poolId?: string;
}

export interface DorkFiDepositAsaDependencies {
  resolveMarketState: typeof resolveDorkFiLendingMarketState;
  buildDepositTransactions: typeof buildDorkFiAsaDepositTransactions;
}

let dependencyOverrides: Partial<DorkFiDepositAsaDependencies> | undefined;

export function setDorkFiDepositAsaDependenciesForTests(
  overrides?: Partial<DorkFiDepositAsaDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): DorkFiDepositAsaDependencies {
  return {
    resolveMarketState: resolveDorkFiLendingMarketState,
    buildDepositTransactions: buildDorkFiAsaDepositTransactions,
    ...dependencyOverrides
  };
}

export const dorkfiDepositAsaShape: TransactionShapeSpec<
  DorkFiDepositAsaInput,
  DorkFiLendingMarketState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Dork.fi v1 ASA lending deposit",
  description:
    "Deposits an ASA into a Dork.fi lending market by wrapping through nt200, approving the pool, " +
    "and calling lending.deposit. Amount is underlying ASA base units.",
  supportedOpportunityTypes: ["lending"],
  opportunityRole: "enter",
  requiredInputs: ["userAddress", "poolAppId", "marketAppId", "assetId", "amount"],
  sources: [
    {
      kind: "docs",
      description: "Dork.fi lending pool ABI and DorkFiMCP ASA supply builder flow",
      url: "https://github.com/NautilusOSS/DorkFiMCP"
    }
  ],

  parseInput(raw: unknown): DorkFiDepositAsaInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    const poolId = parseOptionalPoolId(value.poolId);

    return {
      userAddress: parseAddress(value.userAddress),
      amount: parsePositiveBaseUnitAmount(value.amount, "amount"),
      ...parseDorkFiMarketSelector(value),
      ...(poolId === undefined ? {} : { poolId })
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: DorkFiDepositAsaInput
  ): Promise<DorkFiLendingMarketState> {
    const dependencies = resolveDependencies();
    return dependencies.resolveMarketState({
      network: context.network,
      algod: context.algod,
      poolAppId: input.poolAppId,
      marketAppId: input.marketAppId,
      assetId: input.assetId,
      userAddress: input.userAddress
    });
  },

  async build(
    context: ShapeBuildContext,
    input: DorkFiDepositAsaInput,
    state: DorkFiLendingMarketState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings: string[] = [];

    if (!state.userOptedIntoAsset) {
      warnings.push("User must opt into the underlying ASA before the deposit group can succeed.");
    }
    if (input.amount > state.userAssetBalance) {
      warnings.push(
        `User ASA balance (${state.userAssetBalance.toString()}) is below the requested deposit amount.`
      );
    }

    let transactions;
    try {
      transactions = await dependencies.buildDepositTransactions({
        algod: context.algod,
        userAddress: input.userAddress,
        amount: input.amount,
        state
      });
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Dork.fi ASA deposit transactions.", {
        cause: error
      });
    }

    assignCanonicalGroupID(transactions);

    return {
      transactions,
      warnings,
      metadata: {
        poolAppId: state.poolAppId,
        marketAppId: state.marketAppId,
        assetId: state.assetId,
        nTokenAppId: state.nTokenAppId,
        amount: input.amount.toString(),
        amountDenomination: "asa",
        symbol: state.symbol,
        ...(input.poolId === undefined ? {} : { poolId: input.poolId })
      }
    };
  },

  validate(
    group,
    input: DorkFiDepositAsaInput,
    state: DorkFiLendingMarketState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (group.length < 2 || group.length > 16) {
      errors.push(`Expected between 2 and 16 transactions, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    const depositIndex = findDepositTransferIndex(group, state.assetId);
    if (depositIndex === -1) {
      errors.push("Group must include an ASA transfer wrapping the deposit amount.");
    } else {
      validateAsaTransferTxn({
        txn: group[depositIndex],
        label: `Transaction ${depositIndex + 1}`,
        userAddress: input.userAddress,
        assetId: state.assetId,
        amount: input.amount,
        errors
      });
    }

    const lendingIndex = findLendingAppCallIndex(group, state.poolAppId, DEPOSIT_METHOD_SELECTOR_HEX);
    if (lendingIndex === -1) {
      errors.push("Group must include a lending pool deposit application call.");
    } else {
      validateLendingAppCallTxn({
        txn: group[lendingIndex],
        label: `Transaction ${lendingIndex + 1}`,
        userAddress: input.userAddress,
        poolAppId: state.poolAppId,
        selectorHex: DEPOSIT_METHOD_SELECTOR_HEX,
        errors
      });
    }

    assertGroupedTransactions(group, errors);

    for (const txn of group) {
      if (txn.sender !== input.userAddress) {
        errors.push("All transactions must be sent from the user address.");
        break;
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};

function findDepositTransferIndex(group: readonly SerializedTransaction[], assetId: number): number {
  return group.findIndex(
    (txn) =>
      txn.type === "axfer" &&
      txn.assetTransfer?.assetIndex === String(assetId) &&
      txn.assetTransfer.amount !== "0"
  );
}

function findLendingAppCallIndex(
  group: readonly SerializedTransaction[],
  poolAppId: number,
  selectorHex: string
): number {
  return group.findIndex(
    (txn) =>
      txn.type === "appl" &&
      txn.applicationCall?.appIndex === String(poolAppId) &&
      readAppCallSelectorHex(txn) === selectorHex
  );
}

function validateAsaTransferTxn(params: {
  txn: SerializedTransaction | undefined;
  label: string;
  userAddress: string;
  assetId: number;
  amount: bigint;
  errors: string[];
}): void {
  const { txn, label, userAddress, assetId, amount, errors } = params;
  if (txn === undefined || txn.type !== "axfer" || !txn.assetTransfer) {
    errors.push(`${label} must be an ASA transfer.`);
    return;
  }
  if (txn.sender !== userAddress) {
    errors.push(`${label} sender must be the user address.`);
  }
  if (txn.assetTransfer.assetIndex !== String(assetId)) {
    errors.push(`${label} must transfer asset id ${assetId}.`);
  }
  if (txn.assetTransfer.amount !== amount.toString()) {
    errors.push(`${label} amount must equal the requested deposit amount.`);
  }
}

function validateLendingAppCallTxn(params: {
  txn: SerializedTransaction | undefined;
  label: string;
  userAddress: string;
  poolAppId: number;
  selectorHex: string;
  errors: string[];
}): void {
  const { txn, label, userAddress, poolAppId, selectorHex, errors } = params;
  if (txn === undefined || txn.type !== "appl" || !txn.applicationCall) {
    errors.push(`${label} must be an application call.`);
    return;
  }
  if (txn.sender !== userAddress) {
    errors.push(`${label} sender must be the user address.`);
  }
  if (txn.applicationCall.appIndex !== String(poolAppId)) {
    errors.push(`${label} must call pool app id ${poolAppId}.`);
  }
  if (readAppCallSelectorHex(txn) !== selectorHex) {
    errors.push(`${label} must call the expected lending ABI method.`);
  }
  if (BigInt(txn.fee) < DEFAULT_DORKFI_GROUP_FEE) {
    errors.push(`${label} fee must be at least ${DEFAULT_DORKFI_GROUP_FEE.toString()} microAlgos.`);
  } else if (BigInt(txn.fee) < MIN_ALGO_FEE) {
    errors.push(`${label} fee must be at least ${MIN_ALGO_FEE.toString()} microAlgos.`);
  }
}

export function buildMockDorkFiDepositGroup(params: {
  user: algosdk.Account;
  poolAppId: number;
  marketAppId: number;
  assetId: number;
  amount: bigint;
  suggestedParams: algosdk.SuggestedParams;
}): Transaction[] {
  const depositSelector = Buffer.from(DEPOSIT_METHOD_SELECTOR_HEX, "hex");
  const txns: Transaction[] = [
    algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: params.user.addr,
      receiver: params.user.addr,
      assetIndex: params.assetId,
      amount: params.amount,
      suggestedParams: params.suggestedParams
    }),
    algosdk.makeApplicationNoOpTxnFromObject({
      sender: params.user.addr,
      appIndex: BigInt(params.poolAppId),
      appArgs: [depositSelector],
      foreignApps: [BigInt(3_333_688_254)],
      foreignAssets: [BigInt(params.assetId)],
      suggestedParams: {
        ...params.suggestedParams,
        fee: DEFAULT_DORKFI_GROUP_FEE,
        flatFee: true
      }
    })
  ];
  algosdk.assignGroupID(txns);
  return txns;
}
