import algosdk, { Algodv2, Transaction } from "algosdk";
import { buildBorrowTransactions } from "@compx/sdk";

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
  assertCompXAcceptedCollateral,
  setCompXAcceptedCollateralDependenciesForTests
} from "./accepted-collateral.js";
import {
  type CompXLendingMarketState,
  resolveCompXLendingMarketState
} from "./market-state.js";
import {
  parseAddress,
  parseMarketSelector,
  parseOptionalCollateralTokenId,
  parseOptionalPoolId,
  parsePositiveBaseUnitAmount
} from "./parse-input.js";
import {
  COMPX_LENDING_APP_CALL_MIN_FEE,
  DEFAULT_COMPX_APP_CALL_MAX_FEE,
  assertGroupedTransactions,
  createCompXBuilderAlgodClient,
  ensureCompXLendingAppCallMinFees,
  getAccountAssetBalance,
  readAppCallSelectorHex,
  rejectUnexpectedSignerMetadata,
  type LendingTransactionBundle
} from "./shared.js";

const GAS_METHOD_SELECTOR_HEX = "3172ca9d";
const BORROW_METHOD_SELECTOR_HEX = "d501c95d";

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "compx",
  protocolVersion: "v1",
  action: "borrow",
  variant: "asa"
};

export interface CompXBorrowAsaInput {
  userAddress: string;
  marketAppId: number;
  borrowAmount: bigint;
  collateralAmount: bigint;
  collateralTokenId?: number;
  poolId?: string;
}

export interface CompXBorrowAsaDependencies {
  resolveMarketState: typeof resolveCompXLendingMarketState;
  buildBorrowTransactions: typeof buildBorrowTransactions;
  assertAcceptedCollateral: typeof assertCompXAcceptedCollateral;
  getAccountAssetBalance: typeof getAccountAssetBalance;
}

let dependencyOverrides: Partial<CompXBorrowAsaDependencies> | undefined;

export function setCompXBorrowAsaDependenciesForTests(
  overrides?: Partial<CompXBorrowAsaDependencies>
): void {
  dependencyOverrides = overrides;
  if (overrides === undefined) {
    setCompXAcceptedCollateralDependenciesForTests(undefined);
  }
}

function resolveDependencies(): CompXBorrowAsaDependencies {
  return {
    resolveMarketState: resolveCompXLendingMarketState,
    buildBorrowTransactions,
    assertAcceptedCollateral: assertCompXAcceptedCollateral,
    getAccountAssetBalance,
    ...dependencyOverrides
  };
}

export const compxBorrowAsaShape: TransactionShapeSpec<
  CompXBorrowAsaInput,
  CompXLendingMarketState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.1",
  title: "CompX v1 ASA lending borrow",
  description:
    "Borrows a base ASA from a CompX lending market against accepted LST collateral. Wraps " +
    "@compx/sdk buildBorrowTransactions: optional base opt-in, gas()void, LST collateral " +
    "transfer, then borrow(axfer,uint64,uint64,uint64)void. collateralTokenId must be in the " +
    "market's on-chain accepted_collaterals set (often a cross-market LST such as cUSDC); " +
    "defaults to the market LST when omitted.",
  supportedOpportunityTypes: ["lending"],
  opportunityRole: "enter",
  requiredInputs: [
    "userAddress",
    "marketAppId",
    "borrowAmount",
    "collateralAmount"
  ],
  sources: [
    {
      kind: "sdk",
      description:
        "@compx/sdk buildBorrowTransactions / gas()void + borrow(axfer,uint64,uint64,uint64)void"
    }
  ],

  parseInput(raw: unknown): CompXBorrowAsaInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    const poolId = parseOptionalPoolId(value.poolId);
    const collateralTokenId = parseOptionalCollateralTokenId(
      value.collateralTokenId
    );

    return {
      userAddress: parseAddress(value.userAddress),
      borrowAmount: parsePositiveBaseUnitAmount(
        value.borrowAmount,
        "borrowAmount"
      ),
      collateralAmount: parsePositiveBaseUnitAmount(
        value.collateralAmount,
        "collateralAmount"
      ),
      ...parseMarketSelector(value),
      ...(collateralTokenId === undefined ? {} : { collateralTokenId }),
      ...(poolId === undefined ? {} : { poolId })
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: CompXBorrowAsaInput
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
    input: CompXBorrowAsaInput,
    state: CompXLendingMarketState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings: string[] = [];
    const collateralTokenId = input.collateralTokenId ?? state.lstTokenId;

    await dependencies.assertAcceptedCollateral({
      algod: context.algod,
      marketAppId: state.marketAppId,
      collateralTokenId
    });

    const userCollateralBalance = await resolveUserCollateralBalance({
      dependencies,
      algod: context.algod,
      userAddress: input.userAddress,
      collateralTokenId,
      state
    });

    if (input.collateralAmount > userCollateralBalance) {
      warnings.push(
        `User collateral balance (${userCollateralBalance.toString()}) is below the requested collateral amount.`
      );
    }

    let bundle: LendingTransactionBundle;
    try {
      bundle = (await dependencies.buildBorrowTransactions(
        createCompXBuilderAlgodClient(),
        {
          appId: input.marketAppId,
          sender: input.userAddress,
          borrowAmount: input.borrowAmount,
          collateralAmount: input.collateralAmount,
          collateralTokenId,
          appCallMaxFee: Number(DEFAULT_COMPX_APP_CALL_MAX_FEE)
        }
      )) as unknown as LendingTransactionBundle;
    } catch (error) {
      throw new ShapeBuildError(
        "Failed to generate CompX lending borrow transactions.",
        { cause: error }
      );
    }

    rejectUnexpectedSignerMetadata(bundle.signers, input.userAddress);

    const transactions = ensureCompXLendingAppCallMinFees(
      normalizeTransactions(bundle.transactions)
    );

    return {
      transactions,
      warnings,
      metadata: {
        marketAppId: state.marketAppId,
        marketAppAddress: state.marketAppAddress,
        baseTokenId: state.baseTokenId,
        lstTokenId: state.lstTokenId,
        borrowAmount: input.borrowAmount.toString(),
        collateralAmount: input.collateralAmount.toString(),
        collateralTokenId,
        amountDenomination: "base",
        optInsIncluded: bundle.metadata.optInsIncluded ?? [],
        appCallMaxFee: DEFAULT_COMPX_APP_CALL_MAX_FEE.toString(),
        ...(input.poolId === undefined ? {} : { poolId: input.poolId })
      }
    };
  },

  validate(
    group,
    input: CompXBorrowAsaInput,
    state: CompXLendingMarketState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const collateralTokenId = input.collateralTokenId ?? state.lstTokenId;

    const includesBaseOptIn = !state.userOptedIntoBase;
    const expectedLength = includesBaseOptIn ? 4 : 3;
    if (group.length !== expectedLength) {
      errors.push(
        `Expected exactly ${expectedLength} transactions, received ${group.length}.`
      );
      return { valid: false, errors, warnings };
    }

    let index = 0;
    if (includesBaseOptIn) {
      validateAssetOptInTxn({
        txn: group[0],
        label: "Transaction 1",
        userAddress: input.userAddress,
        assetId: state.baseTokenId,
        errors
      });
      index = 1;
    }

    validateGasAppCallTxn({
      txn: group[index],
      label: `Transaction ${index + 1}`,
      userAddress: input.userAddress,
      marketAppId: state.marketAppId,
      errors
    });

    validateCollateralTransferTxn({
      txn: group[index + 1],
      label: `Transaction ${index + 2}`,
      userAddress: input.userAddress,
      receiver: state.marketAppAddress,
      collateralTokenId,
      amount: input.collateralAmount,
      errors
    });

    validateBorrowAppCallTxn({
      txn: group[index + 2],
      label: `Transaction ${index + 3}`,
      userAddress: input.userAddress,
      marketAppId: state.marketAppId,
      errors
    });

    assertGroupedTransactions(group, errors);

    // Validate is sync; balance warnings for foreign collateral are emitted at build time.
    if (
      collateralTokenId === state.lstTokenId &&
      input.collateralAmount > state.userLstBalance
    ) {
      warnings.push(
        "Requested collateral amount exceeds the resolved user collateral balance."
      );
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};

async function resolveUserCollateralBalance(params: {
  dependencies: CompXBorrowAsaDependencies;
  algod: Algodv2;
  userAddress: string;
  collateralTokenId: number;
  state: CompXLendingMarketState;
}): Promise<bigint> {
  const { dependencies, algod, userAddress, collateralTokenId, state } = params;
  if (collateralTokenId === state.lstTokenId) {
    return state.userLstBalance;
  }
  return dependencies.getAccountAssetBalance(algod, userAddress, collateralTokenId);
}

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

function validateGasAppCallTxn(params: {
  txn: SerializedTransaction | undefined;
  label: string;
  userAddress: string;
  marketAppId: number;
  errors: string[];
}): void {
  const { txn, label, userAddress, marketAppId, errors } = params;
  if (txn === undefined || txn.type !== "appl" || !txn.applicationCall) {
    errors.push(`${label} must be a gas application call.`);
    return;
  }
  if (txn.sender !== userAddress) {
    errors.push(`${label} sender must be the user address.`);
  }
  if (txn.applicationCall.appIndex !== String(marketAppId)) {
    errors.push(`${label} must call market app id ${marketAppId}.`);
  }
  if (readAppCallSelectorHex(txn) !== GAS_METHOD_SELECTOR_HEX) {
    errors.push(`${label} must call gas()void.`);
  }
}

function validateCollateralTransferTxn(params: {
  txn: SerializedTransaction | undefined;
  label: string;
  userAddress: string;
  receiver: string;
  collateralTokenId: number;
  amount: bigint;
  errors: string[];
}): void {
  const {
    txn,
    label,
    userAddress,
    receiver,
    collateralTokenId,
    amount,
    errors
  } = params;
  if (txn === undefined || txn.type !== "axfer" || !txn.assetTransfer) {
    errors.push(`${label} must be an LST collateral transfer.`);
    return;
  }
  if (txn.sender !== userAddress) {
    errors.push(`${label} sender must be the user address.`);
  }
  if (txn.assetTransfer.receiver !== receiver) {
    errors.push(`${label} receiver must be the market application address.`);
  }
  if (txn.assetTransfer.assetIndex !== String(collateralTokenId)) {
    errors.push(
      `${label} asset must be collateral LST token id ${collateralTokenId}.`
    );
  }
  if (txn.assetTransfer.amount !== amount.toString()) {
    errors.push(`${label} amount must equal the requested collateral amount.`);
  }
}

function validateBorrowAppCallTxn(params: {
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
  if (readAppCallSelectorHex(txn) !== BORROW_METHOD_SELECTOR_HEX) {
    errors.push(
      `${label} must call borrow(axfer,uint64,uint64,uint64)void.`
    );
  }
  if (BigInt(txn.fee) < COMPX_LENDING_APP_CALL_MIN_FEE) {
    errors.push(
      `${label} fee must be at least ${COMPX_LENDING_APP_CALL_MIN_FEE.toString()} microAlgos.`
    );
  }
}

export function buildMockBorrowGroup(params: {
  user: algosdk.Account;
  marketAppId: number;
  marketAppAddress: string;
  baseTokenId: number;
  lstTokenId: number;
  borrowAmount: bigint;
  collateralAmount: bigint;
  collateralTokenId?: number;
  includeBaseOptIn: boolean;
  suggestedParams: algosdk.SuggestedParams;
}): Transaction[] {
  const collateralTokenId = params.collateralTokenId ?? params.lstTokenId;
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
    algosdk.makeApplicationNoOpTxnFromObject({
      sender: params.user.addr,
      appIndex: BigInt(params.marketAppId),
      appArgs: [Buffer.from(GAS_METHOD_SELECTOR_HEX, "hex")],
      suggestedParams: {
        ...params.suggestedParams,
        fee: DEFAULT_COMPX_APP_CALL_MAX_FEE,
        flatFee: true
      }
    })
  );
  txns.push(
    algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: params.user.addr,
      receiver: params.marketAppAddress,
      assetIndex: collateralTokenId,
      amount: params.collateralAmount,
      suggestedParams: params.suggestedParams
    })
  );
  txns.push(
    algosdk.makeApplicationNoOpTxnFromObject({
      sender: params.user.addr,
      appIndex: BigInt(params.marketAppId),
      appArgs: [Buffer.from(BORROW_METHOD_SELECTOR_HEX, "hex")],
      foreignAssets: [BigInt(params.baseTokenId), BigInt(collateralTokenId)],
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
