import algosdk, { Transaction } from "algosdk";

import { InvalidShapeInputError, ShapeBuildError } from "../../errors.js";
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
  BORROW_METHOD_SELECTOR_HEX,
  DEFAULT_DORKFI_GROUP_FEE,
  MIN_ALGO_FEE
} from "./constants.js";
import { buildDorkFiAsaBorrowTransactions } from "./lending-build.js";
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
  action: "borrow",
  variant: "asa"
};

export interface DorkFiBorrowAsaInput {
  userAddress: string;
  poolAppId: number;
  marketAppId: number;
  assetId: number;
  amount: bigint;
  poolId?: string;
}

export interface DorkFiBorrowAsaDependencies {
  resolveMarketState: typeof resolveDorkFiLendingMarketState;
  buildBorrowTransactions: typeof buildDorkFiAsaBorrowTransactions;
}

let dependencyOverrides: Partial<DorkFiBorrowAsaDependencies> | undefined;

export function setDorkFiBorrowAsaDependenciesForTests(
  overrides?: Partial<DorkFiBorrowAsaDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): DorkFiBorrowAsaDependencies {
  return {
    resolveMarketState: resolveDorkFiLendingMarketState,
    buildBorrowTransactions: buildDorkFiAsaBorrowTransactions,
    ...dependencyOverrides
  };
}

export const dorkfiBorrowAsaShape: TransactionShapeSpec<
  DorkFiBorrowAsaInput,
  DorkFiLendingMarketState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Dork.fi v1 ASA lending borrow",
  description:
    "Borrows an ASA from a Dork.fi lending market against existing collateral. Calls " +
    "lending.borrow then unwraps nt200 to deliver underlying ASA. Amount is underlying ASA base units.",
  supportedOpportunityTypes: ["lending"],
  opportunityRole: "enter",
  requiredInputs: ["userAddress", "poolAppId", "marketAppId", "assetId", "amount"],
  sources: [
    {
      kind: "docs",
      description: "Dork.fi lending pool ABI and DorkFiMCP ASA borrow builder flow",
      url: "https://github.com/NautilusOSS/DorkFiMCP"
    }
  ],

  parseInput(raw: unknown): DorkFiBorrowAsaInput {
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
    input: DorkFiBorrowAsaInput
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
    input: DorkFiBorrowAsaInput,
    state: DorkFiLendingMarketState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings: string[] = [];

    if (!state.userOptedIntoAsset) {
      warnings.push("User must opt into the underlying ASA before the borrow group can succeed.");
    }

    let transactions;
    try {
      transactions = await dependencies.buildBorrowTransactions({
        algod: context.algod,
        userAddress: input.userAddress,
        amount: input.amount,
        state
      });
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Dork.fi ASA borrow transactions.", {
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
    input: DorkFiBorrowAsaInput,
    state: DorkFiLendingMarketState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (group.length < 2 || group.length > 16) {
      errors.push(`Expected between 2 and 16 transactions, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    const lendingIndex = findLendingAppCallIndex(group, state.poolAppId, BORROW_METHOD_SELECTOR_HEX);
    if (lendingIndex === -1) {
      errors.push("Group must include a lending pool borrow application call.");
    } else {
      validateLendingAppCallTxn({
        txn: group[lendingIndex],
        label: `Transaction ${lendingIndex + 1}`,
        userAddress: input.userAddress,
        poolAppId: state.poolAppId,
        selectorHex: BORROW_METHOD_SELECTOR_HEX,
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

export function buildMockDorkFiBorrowGroup(params: {
  user: algosdk.Account;
  poolAppId: number;
  marketAppId: number;
  assetId: number;
  amount: bigint;
  suggestedParams: algosdk.SuggestedParams;
}): Transaction[] {
  const borrowSelector = Buffer.from(BORROW_METHOD_SELECTOR_HEX, "hex");
  const txns: Transaction[] = [
    algosdk.makeApplicationNoOpTxnFromObject({
      sender: params.user.addr,
      appIndex: BigInt(params.poolAppId),
      appArgs: [borrowSelector],
      foreignApps: [BigInt(3_333_688_254)],
      foreignAssets: [BigInt(params.assetId)],
      suggestedParams: {
        ...params.suggestedParams,
        fee: DEFAULT_DORKFI_GROUP_FEE,
        flatFee: true
      }
    }),
    algosdk.makeApplicationNoOpTxnFromObject({
      sender: params.user.addr,
      appIndex: BigInt(params.marketAppId),
      appArgs: [Buffer.from("00000000", "hex")],
      suggestedParams: params.suggestedParams
    })
  ];
  algosdk.assignGroupID(txns);
  return txns;
}
