import { Algodv2 } from "algosdk";
import {
  RemoveLiquidity,
  applySlippageToAmount
} from "@tinymanorg/tinyman-js-sdk";
import type {
  PoolReserves,
  SignerTransaction,
  V2PoolInfo,
  V2SingleAssetRemoveLiquidityQuote
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

const MIN_ALGO_FEE = 1000n;
const REMOVE_LIQUIDITY_APP_CALL_FEE_MULTIPLIER = 3n;
const MAX_SLIPPAGE_BPS = 10_000;
const HIGH_SLIPPAGE_BPS = 500;

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "tinyman",
  protocolVersion: "v2",
  action: "removeLiquidity",
  variant: "singleAssetOut"
};

export interface TinymanRemoveLiquiditySingleAssetOutInput {
  userAddress: string;
  assetAId: number;
  assetBId: number;
  outputAssetId: number;
  poolTokenAmount: bigint;
  maxSlippageBps: number;
  poolId?: string;
}

export interface TinymanRemoveLiquiditySingleAssetOutDependencies {
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
  getSingleAssetRemoveLiquidityQuote: (params: {
    pool: V2PoolInfo;
    reserves: PoolReserves;
    poolTokenIn: bigint;
    assetOutID: number;
    decimals: { assetIn: number; assetOut: number };
  }) => V2SingleAssetRemoveLiquidityQuote;
  generateSingleAssetOutTxns: (params: {
    client: Algodv2;
    pool: V2PoolInfo;
    initiatorAddr: string;
    poolTokenIn: bigint;
    outputAssetId: number;
    minOutputAssetAmount: bigint;
    slippage: number;
  }) => Promise<SignerTransaction[]>;
}

let dependencyOverrides:
  | Partial<TinymanRemoveLiquiditySingleAssetOutDependencies>
  | undefined;

export function setTinymanRemoveLiquiditySingleAssetOutDependenciesForTests(
  overrides?: Partial<TinymanRemoveLiquiditySingleAssetOutDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): TinymanRemoveLiquiditySingleAssetOutDependencies {
  return {
    resolvePoolState: resolveTinymanV2PoolState,
    resolvePoolReserves: resolveTinymanV2PoolReserves,
    getSingleAssetRemoveLiquidityQuote: (params) =>
      RemoveLiquidity.v2.getSingleAssetRemoveLiquidityQuote(params),
    generateSingleAssetOutTxns: (params) =>
      RemoveLiquidity.v2.generateSingleAssetOutTxns(params),
    ...dependencyOverrides
  };
}

export const tinymanRemoveLiquiditySingleAssetOutShape: TransactionShapeSpec<
  TinymanRemoveLiquiditySingleAssetOutInput,
  TinymanV2PoolState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Tinyman v2 remove liquidity (single asset out)",
  description:
    "Removes liquidity from an existing Tinyman AMM v2 pool, returning a single chosen " +
    "pool asset via an internal swap. Generates the documented 2-transaction group " +
    "(pool token transfer, remove_liquidity app call) as unsigned transactions.",
  supportedOpportunityTypes: ["lp"],
  requiredInputs: [
    "userAddress",
    "assetAId",
    "assetBId",
    "outputAssetId",
    "poolTokenAmount",
    "maxSlippageBps"
  ],
  sources: [
    {
      kind: "sdk",
      description:
        "@tinymanorg/tinyman-js-sdk RemoveLiquidity.v2 (getSingleAssetRemoveLiquidityQuote/generateSingleAssetOutTxns)"
    },
    {
      kind: "docs",
      description: "Tinyman v2 integration: remove liquidity (single asset out)",
      url: "https://docs.tinyman.org/v2-integration/protocol-methods/remove-liquidity"
    }
  ],

  parseInput(raw: unknown): TinymanRemoveLiquiditySingleAssetOutInput {
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
    const outputAssetId = parseAssetId(value.outputAssetId, "outputAssetId");
    if (outputAssetId !== assetAId && outputAssetId !== assetBId) {
      throw new InvalidShapeInputError(
        "outputAssetId must match assetAId or assetBId for the pool pair.",
        { outputAssetId, assetAId, assetBId }
      );
    }
    const poolTokenAmount = parseBaseUnitAmount(value.poolTokenAmount, "poolTokenAmount");
    const maxSlippageBps = parseSlippageBps(value.maxSlippageBps);
    const poolId = value.poolId === undefined ? undefined : parsePoolId(value.poolId);

    return {
      userAddress,
      assetAId,
      assetBId,
      outputAssetId,
      poolTokenAmount,
      maxSlippageBps,
      ...(poolId === undefined ? {} : { poolId })
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: TinymanRemoveLiquiditySingleAssetOutInput
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
    input: TinymanRemoveLiquiditySingleAssetOutInput,
    state: TinymanV2PoolState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const slippage = input.maxSlippageBps / MAX_SLIPPAGE_BPS;

    const outputDecimals =
      input.outputAssetId === state.asset1Id ? state.asset1Decimals : state.asset2Decimals;
    const inputDecimals =
      input.outputAssetId === state.asset1Id ? state.asset2Decimals : state.asset1Decimals;

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

    let quote: V2SingleAssetRemoveLiquidityQuote;
    try {
      quote = dependencies.getSingleAssetRemoveLiquidityQuote({
        pool: state.poolInfo,
        reserves,
        poolTokenIn: input.poolTokenAmount,
        assetOutID: input.outputAssetId,
        decimals: { assetIn: inputDecimals, assetOut: outputDecimals }
      });
    } catch (error) {
      throw new ShapeBuildError(
        "Failed to compute Tinyman single-asset-out remove-liquidity quote.",
        { cause: error }
      );
    }

    const minOutputAssetAmount = applySlippageToAmount(
      "negative",
      slippage,
      quote.assetOut.amount
    );

    let signerTxns: SignerTransaction[];
    try {
      signerTxns = await dependencies.generateSingleAssetOutTxns({
        client: context.algod,
        pool: state.poolInfo,
        poolTokenIn: input.poolTokenAmount,
        initiatorAddr: input.userAddress,
        outputAssetId: input.outputAssetId,
        minOutputAssetAmount,
        slippage
      });
    } catch (error) {
      throw new ShapeBuildError(
        "Failed to generate Tinyman single-asset-out remove-liquidity transactions.",
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
        outputAssetId: input.outputAssetId,
        poolTokenAmountIn: input.poolTokenAmount.toString(),
        expectedAssetOut: quote.assetOut.amount.toString(),
        minAssetOut: minOutputAssetAmount.toString(),
        slippageBps: input.maxSlippageBps,
        ...(input.poolId === undefined ? {} : { poolId: input.poolId })
      }
    };
  },

  validate(
    group,
    input: TinymanRemoveLiquiditySingleAssetOutInput,
    state: TinymanV2PoolState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (group.length !== 2) {
      errors.push(`Expected exactly 2 transactions, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    const [poolTokenTxn, appTxn] = group;

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
      if (call.foreignAssets.length !== 1) {
        errors.push(
          `Transaction 2 foreign assets must include only the output asset (${input.outputAssetId}).`
        );
      } else if (call.foreignAssets[0] !== String(input.outputAssetId)) {
        errors.push(
          `Transaction 2 foreign asset must be the output asset (${input.outputAssetId}), got ${call.foreignAssets[0]}.`
        );
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
