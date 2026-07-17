import { Algodv2 } from "algosdk";
import {
  RemoveLiquidity,
  applySlippageToAmount
} from "@tinymanorg/tinyman-js-sdk";
import type {
  PoolReserves,
  SignerTransaction,
  V2PoolInfo,
  V2RemoveLiquidityQuote
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
  resolveTinymanV2PoolReserves,
  resolveTinymanV2PoolState
} from "./pool-state.js";

/**
 * Tinyman v2 remove-liquidity loads the app-call transaction with a flat fee
 * covering its inner transactions (per Tinyman v2 docs: 3 * min_fee).
 */
const MIN_ALGO_FEE = 1000n;
const REMOVE_LIQUIDITY_APP_CALL_FEE_MULTIPLIER = 3n;
const MAX_SLIPPAGE_BPS = 10_000;
/** Warn callers when tolerated slippage is unusually wide. */
const HIGH_SLIPPAGE_BPS = 500;

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "tinyman",
  protocolVersion: "v2",
  action: "removeLiquidity",
  variant: "multipleAssetsOut"
};

export interface TinymanRemoveLiquidityMultipleAssetsOutInput {
  /** Address that will sign and receive the withdrawn assets. */
  userAddress: string;
  /** First asset identifying the pool pair. */
  assetAId: number;
  /** Second asset identifying the pool pair. */
  assetBId: number;
  /** Pool token amount to burn in base units. */
  poolTokenAmount: bigint;
  /** Maximum tolerated slippage in basis points (1 bp = 0.01%). */
  maxSlippageBps: number;
  /** Optional opportunity/pool id carried from discovery for traceability. */
  poolId?: string;
}

export interface TinymanRemoveLiquidityMultipleAssetsOutDependencies {
  resolvePoolState: (params: {
    network: ShapeBuildContext["network"];
    algod: Algodv2;
    asset1Id: number;
    asset2Id: number;
  }) => Promise<TinymanV2PoolState>;
  resolvePoolReserves: (params: {
    algod: Algodv2;
    poolInfo: V2PoolInfo;
  }) => Promise<PoolReserves>;
  getRemoveLiquidityQuote: (params: {
    pool: V2PoolInfo;
    reserves: PoolReserves;
    poolTokenIn: bigint;
  }) => V2RemoveLiquidityQuote;
  generateRemoveLiquidityTxns: (params: {
    client: Algodv2;
    pool: V2PoolInfo;
    poolTokenIn: bigint;
    initiatorAddr: string;
    minAsset1Amount: bigint;
    minAsset2Amount: bigint;
    slippage: number;
  }) => Promise<SignerTransaction[]>;
}

let dependencyOverrides:
  | Partial<TinymanRemoveLiquidityMultipleAssetsOutDependencies>
  | undefined;

export function setTinymanRemoveLiquidityDependenciesForTests(
  overrides?: Partial<TinymanRemoveLiquidityMultipleAssetsOutDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): TinymanRemoveLiquidityMultipleAssetsOutDependencies {
  return {
    resolvePoolState: resolveTinymanV2PoolState,
    resolvePoolReserves: resolveTinymanV2PoolReserves,
    getRemoveLiquidityQuote: (params) => RemoveLiquidity.v2.getQuote(params),
    generateRemoveLiquidityTxns: (params) => RemoveLiquidity.v2.generateTxns(params),
    ...dependencyOverrides
  };
}

export const tinymanRemoveLiquidityMultipleAssetsOutShape: TransactionShapeSpec<
  TinymanRemoveLiquidityMultipleAssetsOutInput,
  TinymanV2PoolState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Tinyman v2 remove liquidity (multiple assets out)",
  description:
    "Removes liquidity from an existing Tinyman AMM v2 pool, returning both pool assets " +
    "proportionally. Generates the documented 2-transaction group (pool token transfer, " +
    "remove_liquidity app call) as unsigned transactions.",
  supportedOpportunityTypes: ["lp"],
  opportunityRole: "exit",
  requiredInputs: [
    "userAddress",
    "assetAId",
    "assetBId",
    "poolTokenAmount",
    "maxSlippageBps"
  ],
  sources: [
    {
      kind: "sdk",
      description:
        "@tinymanorg/tinyman-js-sdk RemoveLiquidity.v2 (getQuote/generateTxns)"
    },
    {
      kind: "docs",
      description: "Tinyman v2 integration: remove liquidity (multiple assets out)",
      url: "https://docs.tinyman.org/v2-integration/protocol-methods/remove-liquidity"
    }
  ],

  parseInput(raw: unknown): TinymanRemoveLiquidityMultipleAssetsOutInput {
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
    const poolTokenAmount = parseBaseUnitAmount(value.poolTokenAmount, "poolTokenAmount");
    const maxSlippageBps = parseSlippageBps(value.maxSlippageBps);
    const poolId = value.poolId === undefined ? undefined : parsePoolId(value.poolId);

    return {
      userAddress,
      assetAId,
      assetBId,
      poolTokenAmount,
      maxSlippageBps,
      ...(poolId === undefined ? {} : { poolId })
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: TinymanRemoveLiquidityMultipleAssetsOutInput
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
    input: TinymanRemoveLiquidityMultipleAssetsOutInput,
    state: TinymanV2PoolState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const slippage = input.maxSlippageBps / MAX_SLIPPAGE_BPS;

    let reserves: PoolReserves;
    try {
      reserves = await dependencies.resolvePoolReserves({
        algod: context.algod,
        poolInfo: state.poolInfo
      });
    } catch (error) {
      throw new ShapeBuildError("Failed to resolve Tinyman pool reserves for remove liquidity.", {
        cause: error
      });
    }

    let quote: V2RemoveLiquidityQuote;
    try {
      quote = dependencies.getRemoveLiquidityQuote({
        pool: state.poolInfo,
        reserves,
        poolTokenIn: input.poolTokenAmount
      });
    } catch (error) {
      throw new ShapeBuildError("Failed to compute Tinyman remove-liquidity quote.", {
        cause: error
      });
    }

    let signerTxns: SignerTransaction[];
    try {
      signerTxns = await dependencies.generateRemoveLiquidityTxns({
        client: context.algod,
        pool: state.poolInfo,
        poolTokenIn: input.poolTokenAmount,
        initiatorAddr: input.userAddress,
        minAsset1Amount: quote.asset1Out.amount,
        minAsset2Amount: quote.asset2Out.amount,
        slippage
      });
    } catch (error) {
      throw new ShapeBuildError(
        "Failed to generate Tinyman remove-liquidity transactions.",
        { cause: error }
      );
    }

    const minAsset1Out = applySlippageToAmount("negative", slippage, quote.asset1Out.amount);
    const minAsset2Out = applySlippageToAmount("negative", slippage, quote.asset2Out.amount);

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
        poolTokenAmountIn: input.poolTokenAmount.toString(),
        expectedAsset1Out: quote.asset1Out.amount.toString(),
        expectedAsset2Out: quote.asset2Out.amount.toString(),
        minAsset1Out: minAsset1Out.toString(),
        minAsset2Out: minAsset2Out.toString(),
        slippageBps: input.maxSlippageBps,
        ...(input.poolId === undefined ? {} : { poolId: input.poolId })
      }
    };
  },

  validate(
    group,
    input: TinymanRemoveLiquidityMultipleAssetsOutInput,
    state: TinymanV2PoolState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (group.length !== 2) {
      errors.push(`Expected exactly 2 transactions, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    const [poolTokenTxn, appTxn] = group;

    // Transaction 1: pool token transfer from user to pool.
    if (
      poolTokenTxn === undefined ||
      poolTokenTxn.type !== "axfer" ||
      !poolTokenTxn.assetTransfer
    ) {
      errors.push("Transaction 1 must be a pool token asset transfer.");
    } else {
      if (poolTokenTxn.sender !== input.userAddress) {
        errors.push("Transaction 1 sender must be the user address.");
      }
      if (poolTokenTxn.assetTransfer.receiver !== state.poolAddress) {
        errors.push("Transaction 1 receiver must be the pool address.");
      }
      if (poolTokenTxn.assetTransfer.assetIndex !== String(state.poolTokenId)) {
        errors.push(
          `Transaction 1 asset must be the pool token (${state.poolTokenId}), got ${poolTokenTxn.assetTransfer.assetIndex}.`
        );
      }
      if (poolTokenTxn.assetTransfer.amount !== input.poolTokenAmount.toString()) {
        errors.push("Transaction 1 amount must equal the requested pool token amount.");
      }
    }

    // Transaction 2: remove_liquidity app call to the validator app.
    if (appTxn === undefined || appTxn.type !== "appl" || !appTxn.applicationCall) {
      errors.push("Transaction 2 must be an application call.");
    } else {
      const call = appTxn.applicationCall;
      if (appTxn.sender !== input.userAddress) {
        errors.push("Transaction 2 sender must be the user address.");
      }
      if (call.appIndex !== String(state.validatorAppId)) {
        errors.push(
          `Transaction 2 must call the Tinyman validator app (${state.validatorAppId}), got ${call.appIndex}.`
        );
      }
      if (call.appArgsText[0] !== "remove_liquidity") {
        errors.push('Transaction 2 first app arg must be "remove_liquidity".');
      }
      if (!call.foreignAssets.includes(String(state.asset1Id))) {
        errors.push("Transaction 2 foreign assets must include asset 1.");
      }
      if (!call.foreignAssets.includes(String(state.asset2Id))) {
        errors.push("Transaction 2 foreign assets must include asset 2.");
      }
      if (!call.accounts.includes(state.poolAddress)) {
        errors.push("Transaction 2 accounts must include the pool address.");
      }
      const expectedFee = REMOVE_LIQUIDITY_APP_CALL_FEE_MULTIPLIER * MIN_ALGO_FEE;
      if (BigInt(appTxn.fee) < expectedFee) {
        errors.push(
          `Transaction 2 fee must cover inner transactions (>= ${expectedFee} microAlgos), got ${appTxn.fee}.`
        );
      }
    }

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
