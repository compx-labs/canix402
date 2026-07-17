import { Algodv2 } from "algosdk";
import { AddLiquidity } from "@tinymanorg/tinyman-js-sdk";
import type {
  SignerTransaction,
  V2FlexibleAddLiquidityQuote,
  V2PoolInfo
} from "@tinymanorg/tinyman-js-sdk";

import { InvalidShapeInputError, ShapeBuildError } from "../../errors.js";
import {
  ShapeBuildContext,
  ShapeBuildResult,
  ShapeValidationResult,
  TransactionShapeIdentity,
  TransactionShapeSpec,
  buildShapeKey
} from "../../types.js";
import {
  TinymanV2PoolState,
  orderTinymanAssets,
  resolveTinymanV2PoolState
} from "./pool-state.js";

/**
 * Minimum protocol fee on Algorand (microAlgos). Tinyman flexible add-liquidity
 * loads the app-call transaction with a flat fee covering its inner
 * transactions (per Tinyman v2 docs: 3 * min_fee).
 */
const MIN_ALGO_FEE = 1000n;
const FLEXIBLE_APP_CALL_FEE_MULTIPLIER = 3n;
const ALGO_ASSET_ID = 0;
const MAX_SLIPPAGE_BPS = 10_000;
/** Warn callers when tolerated slippage is unusually wide. */
const HIGH_SLIPPAGE_BPS = 500;

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "tinyman",
  protocolVersion: "v2",
  action: "addLiquidity",
  variant: "flexible"
};

export interface TinymanAddLiquidityFlexibleInput {
  /** Address that will sign and own the resulting LP position. */
  userAddress: string;
  /** First asset the caller wants to deposit. */
  assetAId: number;
  /** Amount of asset A in base units. */
  assetAAmount: bigint;
  /** Second asset the caller wants to deposit. */
  assetBId: number;
  /** Amount of asset B in base units. */
  assetBAmount: bigint;
  /** Maximum tolerated slippage in basis points (1 bp = 0.01%). */
  maxSlippageBps: number;
  /** Optional opportunity/pool id carried from discovery for traceability. */
  poolId?: string;
}

export interface TinymanFlexibleAddLiquidityDependencies {
  resolvePoolState: (params: {
    network: ShapeBuildContext["network"];
    algod: Algodv2;
    asset1Id: number;
    asset2Id: number;
  }) => Promise<TinymanV2PoolState>;
  getFlexibleQuote: (params: {
    pool: V2PoolInfo;
    asset1: { amount: bigint; decimals: number };
    asset2: { amount: bigint; decimals: number };
    slippage: number;
  }) => V2FlexibleAddLiquidityQuote;
  generateFlexibleTxns: (params: {
    client: Algodv2;
    network: ShapeBuildContext["network"];
    poolAddress: string;
    asset1In: { id: number; amount: bigint };
    asset2In: { id: number; amount: bigint };
    poolTokenOut: { id: number; amount: bigint };
    initiatorAddr: string;
    minPoolTokenAssetAmount: bigint;
  }) => Promise<SignerTransaction[]>;
}

let dependencyOverrides: Partial<TinymanFlexibleAddLiquidityDependencies> | undefined;

export function setTinymanFlexibleAddLiquidityDependenciesForTests(
  overrides?: Partial<TinymanFlexibleAddLiquidityDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): TinymanFlexibleAddLiquidityDependencies {
  return {
    resolvePoolState: resolveTinymanV2PoolState,
    getFlexibleQuote: (params) => AddLiquidity.v2.flexible.getQuote(params),
    generateFlexibleTxns: (params) => AddLiquidity.v2.flexible.generateTxns(params),
    ...dependencyOverrides
  };
}

export const tinymanAddLiquidityFlexibleShape: TransactionShapeSpec<
  TinymanAddLiquidityFlexibleInput,
  TinymanV2PoolState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Tinyman v2 flexible add liquidity",
  description:
    "Adds two-sided liquidity to an existing Tinyman AMM v2 pool using flexible amounts. " +
    "Generates the documented 3-transaction group (asset1 transfer, asset2 transfer/payment, " +
    "add_liquidity app call) as unsigned transactions.",
  supportedOpportunityTypes: ["lp"],
  opportunityRole: "enter",
  requiredInputs: [
    "userAddress",
    "assetAId",
    "assetAAmount",
    "assetBId",
    "assetBAmount",
    "maxSlippageBps"
  ],
  sources: [
    {
      kind: "sdk",
      description: "@tinymanorg/tinyman-js-sdk AddLiquidity.v2.flexible (getQuote/generateTxns)"
    },
    {
      kind: "docs",
      description: "Tinyman v2 integration: add subsequent liquidity (flexible)",
      url: "https://docs.tinyman.org/v2-integration/protocol-methods/add-subsequent-liquidity"
    }
  ],

  parseInput(raw: unknown): TinymanAddLiquidityFlexibleInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;

    const userAddress = parseAddress(value.userAddress);
    const assetAId = parseAssetId(value.assetAId, "assetAId");
    const assetBId = parseAssetId(value.assetBId, "assetBId");
    if (assetAId === assetBId) {
      throw new InvalidShapeInputError("assetAId and assetBId must be different assets.", {
        assetAId,
        assetBId
      });
    }
    const assetAAmount = parseBaseUnitAmount(value.assetAAmount, "assetAAmount");
    const assetBAmount = parseBaseUnitAmount(value.assetBAmount, "assetBAmount");
    const maxSlippageBps = parseSlippageBps(value.maxSlippageBps);
    const poolId = value.poolId === undefined ? undefined : parsePoolId(value.poolId);

    return {
      userAddress,
      assetAId,
      assetAAmount,
      assetBId,
      assetBAmount,
      maxSlippageBps,
      ...(poolId === undefined ? {} : { poolId })
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: TinymanAddLiquidityFlexibleInput
  ): Promise<TinymanV2PoolState> {
    const dependencies = resolveDependencies();
    const { asset1Id, asset2Id } = orderTinymanAssets(input.assetAId, input.assetBId);
    return dependencies.resolvePoolState({
      network: context.network,
      algod: context.algod,
      asset1Id,
      asset2Id
    });
  },

  async build(
    context: ShapeBuildContext,
    input: TinymanAddLiquidityFlexibleInput,
    state: TinymanV2PoolState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();

    const asset1Amount =
      input.assetAId === state.asset1Id ? input.assetAAmount : input.assetBAmount;
    const asset2Amount =
      input.assetAId === state.asset1Id ? input.assetBAmount : input.assetAAmount;
    const slippage = input.maxSlippageBps / MAX_SLIPPAGE_BPS;

    let quote: V2FlexibleAddLiquidityQuote;
    try {
      quote = dependencies.getFlexibleQuote({
        pool: state.poolInfo,
        asset1: { amount: asset1Amount, decimals: state.asset1Decimals },
        asset2: { amount: asset2Amount, decimals: state.asset2Decimals },
        slippage
      });
    } catch (error) {
      throw new ShapeBuildError("Failed to compute Tinyman flexible add-liquidity quote.", {
        cause: error
      });
    }

    let signerTxns: SignerTransaction[];
    try {
      signerTxns = await dependencies.generateFlexibleTxns({
        client: context.algod,
        network: context.network,
        poolAddress: state.poolAddress,
        asset1In: { id: state.asset1Id, amount: asset1Amount },
        asset2In: { id: state.asset2Id, amount: asset2Amount },
        poolTokenOut: { id: state.poolTokenId, amount: quote.poolTokenOut.amount },
        initiatorAddr: input.userAddress,
        minPoolTokenAssetAmount: quote.minPoolTokenAssetAmountWithSlippage
      });
    } catch (error) {
      throw new ShapeBuildError(
        "Failed to generate Tinyman flexible add-liquidity transactions.",
        { cause: error }
      );
    }

    const warnings: string[] = [];
    if (input.maxSlippageBps >= HIGH_SLIPPAGE_BPS) {
      warnings.push(
        `Tolerated slippage is high (${input.maxSlippageBps} bps); confirm this is intentional.`
      );
    }

    return {
      transactions: signerTxns.map((signerTxn) => signerTxn.txn),
      warnings,
      metadata: {
        poolAddress: state.poolAddress,
        poolTokenId: state.poolTokenId,
        asset1Id: state.asset1Id,
        asset2Id: state.asset2Id,
        asset1AmountIn: asset1Amount.toString(),
        asset2AmountIn: asset2Amount.toString(),
        expectedPoolTokenOut: quote.poolTokenOut.amount.toString(),
        minPoolTokenOut: quote.minPoolTokenAssetAmountWithSlippage.toString(),
        poolShare: quote.share,
        slippageBps: input.maxSlippageBps,
        ...(input.poolId === undefined ? {} : { poolId: input.poolId })
      }
    };
  },

  validate(
    group,
    input: TinymanAddLiquidityFlexibleInput,
    state: TinymanV2PoolState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (group.length !== 3) {
      errors.push(`Expected exactly 3 transactions, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    const asset1Amount =
      input.assetAId === state.asset1Id ? input.assetAAmount : input.assetBAmount;
    const asset2Amount =
      input.assetAId === state.asset1Id ? input.assetBAmount : input.assetAAmount;

    const [asset1Txn, asset2Txn, appTxn] = group;

    // Transaction 1: asset1 transfer from user to pool.
    if (asset1Txn === undefined || asset1Txn.type !== "axfer" || !asset1Txn.assetTransfer) {
      errors.push("Transaction 1 must be an asset transfer for asset 1.");
    } else {
      if (asset1Txn.sender !== input.userAddress) {
        errors.push("Transaction 1 sender must be the user address.");
      }
      if (asset1Txn.assetTransfer.receiver !== state.poolAddress) {
        errors.push("Transaction 1 receiver must be the pool address.");
      }
      if (asset1Txn.assetTransfer.assetIndex !== String(state.asset1Id)) {
        errors.push(
          `Transaction 1 asset must be asset1 (${state.asset1Id}), got ${asset1Txn.assetTransfer.assetIndex}.`
        );
      }
      if (asset1Txn.assetTransfer.amount !== asset1Amount.toString()) {
        errors.push("Transaction 1 amount must equal the requested asset1 amount.");
      }
    }

    // Transaction 2: asset2 transfer, or ALGO payment when asset2 is ALGO.
    if (state.asset2Id === ALGO_ASSET_ID) {
      if (asset2Txn === undefined || asset2Txn.type !== "pay" || !asset2Txn.payment) {
        errors.push("Transaction 2 must be an ALGO payment when asset 2 is ALGO.");
      } else {
        if (asset2Txn.sender !== input.userAddress) {
          errors.push("Transaction 2 sender must be the user address.");
        }
        if (asset2Txn.payment.receiver !== state.poolAddress) {
          errors.push("Transaction 2 receiver must be the pool address.");
        }
        if (asset2Txn.payment.amount !== asset2Amount.toString()) {
          errors.push("Transaction 2 amount must equal the requested asset2 amount.");
        }
      }
    } else if (
      asset2Txn === undefined ||
      asset2Txn.type !== "axfer" ||
      !asset2Txn.assetTransfer
    ) {
      errors.push("Transaction 2 must be an asset transfer for asset 2.");
    } else {
      if (asset2Txn.sender !== input.userAddress) {
        errors.push("Transaction 2 sender must be the user address.");
      }
      if (asset2Txn.assetTransfer.receiver !== state.poolAddress) {
        errors.push("Transaction 2 receiver must be the pool address.");
      }
      if (asset2Txn.assetTransfer.assetIndex !== String(state.asset2Id)) {
        errors.push(
          `Transaction 2 asset must be asset2 (${state.asset2Id}), got ${asset2Txn.assetTransfer.assetIndex}.`
        );
      }
      if (asset2Txn.assetTransfer.amount !== asset2Amount.toString()) {
        errors.push("Transaction 2 amount must equal the requested asset2 amount.");
      }
    }

    // Transaction 3: add_liquidity flexible app call to the validator app.
    if (appTxn === undefined || appTxn.type !== "appl" || !appTxn.applicationCall) {
      errors.push("Transaction 3 must be an application call.");
    } else {
      const call = appTxn.applicationCall;
      if (appTxn.sender !== input.userAddress) {
        errors.push("Transaction 3 sender must be the user address.");
      }
      if (call.appIndex !== String(state.validatorAppId)) {
        errors.push(
          `Transaction 3 must call the Tinyman validator app (${state.validatorAppId}), got ${call.appIndex}.`
        );
      }
      if (call.appArgsText[0] !== "add_liquidity") {
        errors.push('Transaction 3 first app arg must be "add_liquidity".');
      }
      if (call.appArgsText[1] !== "flexible") {
        errors.push('Transaction 3 second app arg must be "flexible".');
      }
      if (!call.foreignAssets.includes(String(state.poolTokenId))) {
        errors.push("Transaction 3 foreign assets must include the pool token id.");
      }
      if (!call.accounts.includes(state.poolAddress)) {
        errors.push("Transaction 3 accounts must include the pool address.");
      }
      const expectedFee = FLEXIBLE_APP_CALL_FEE_MULTIPLIER * MIN_ALGO_FEE;
      if (BigInt(appTxn.fee) < expectedFee) {
        errors.push(
          `Transaction 3 fee must cover inner transactions (>= ${expectedFee} microAlgos), got ${appTxn.fee}.`
        );
      }
    }

    // All transactions must be atomically grouped.
    if (group.some((txn) => !txn.groupPresent)) {
      errors.push("All transactions must belong to a single atomic group.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};

function parseAddress(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidShapeInputError("userAddress must be a non-empty string.");
  }
  // Basic length/character sanity; full checksum validation happens when the
  // SDK builds the transactions.
  if (!/^[A-Z2-7]{58}$/.test(value)) {
    throw new InvalidShapeInputError("userAddress must be a valid Algorand address.");
  }
  return value;
}

function parseAssetId(value: unknown, field: string): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isInteger(numeric) || numeric < 0) {
    throw new InvalidShapeInputError(`${field} must be a non-negative integer asset id.`, {
      [field]: value
    });
  }
  return numeric;
}

function parseBaseUnitAmount(value: unknown, field: string): bigint {
  let result: bigint;
  if (typeof value === "bigint") {
    result = value;
  } else if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new InvalidShapeInputError(`${field} must be an integer amount in base units.`, {
        [field]: value
      });
    }
    result = BigInt(value);
  } else if (typeof value === "string" && /^\d+$/.test(value)) {
    result = BigInt(value);
  } else {
    throw new InvalidShapeInputError(
      `${field} must be a positive integer amount in base units.`,
      { [field]: value }
    );
  }
  if (result <= 0n) {
    throw new InvalidShapeInputError(`${field} must be greater than zero.`, {
      [field]: value
    });
  }
  return result;
}

function parseSlippageBps(value: unknown): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (
    typeof numeric !== "number" ||
    !Number.isInteger(numeric) ||
    numeric < 0 ||
    numeric > MAX_SLIPPAGE_BPS
  ) {
    throw new InvalidShapeInputError(
      `maxSlippageBps must be an integer between 0 and ${MAX_SLIPPAGE_BPS}.`,
      { maxSlippageBps: value }
    );
  }
  return numeric;
}

function parsePoolId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidShapeInputError("poolId must be a non-empty string when provided.");
  }
  return value;
}
