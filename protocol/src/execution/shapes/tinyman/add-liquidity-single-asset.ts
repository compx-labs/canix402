import { Algodv2 } from "algosdk";
import { AddLiquidity } from "@tinymanorg/tinyman-js-sdk";
import type {
  SignerTransaction,
  V2PoolInfo,
  V2SingleAssetInAddLiquidityQuote
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

const MIN_ALGO_FEE = 1000n;
const SINGLE_ASSET_APP_CALL_FEE_MULTIPLIER = 3n;
const ALGO_ASSET_ID = 0;
const MAX_SLIPPAGE_BPS = 10_000;
const HIGH_SLIPPAGE_BPS = 500;

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "tinyman",
  protocolVersion: "v2",
  action: "addLiquidity",
  variant: "singleAsset"
};

export interface TinymanAddLiquiditySingleAssetInput {
  userAddress: string;
  assetAId: number;
  assetBId: number;
  depositAssetId: number;
  depositAmount: bigint;
  maxSlippageBps: number;
  poolId?: string;
}

export interface TinymanSingleAssetAddLiquidityDependencies {
  resolvePoolState: (params: {
    network: ShapeBuildContext["network"];
    algod: Algodv2;
    asset1Id: number;
    asset2Id: number;
  }) => Promise<TinymanV2PoolState>;
  getSingleAssetQuote: (params: {
    pool: V2PoolInfo;
    assetIn: { id: number; amount: bigint };
    decimals: { asset1: number; asset2: number };
    slippage: number;
  }) => V2SingleAssetInAddLiquidityQuote;
  generateSingleAssetTxns: (params: {
    client: Algodv2;
    network: ShapeBuildContext["network"];
    poolAddress: string;
    assetIn: { id: number; amount: bigint };
    poolTokenId: number;
    initiatorAddr: string;
    minPoolTokenAssetAmount: bigint;
  }) => Promise<SignerTransaction[]>;
}

let dependencyOverrides: Partial<TinymanSingleAssetAddLiquidityDependencies> | undefined;

export function setTinymanSingleAssetAddLiquidityDependenciesForTests(
  overrides?: Partial<TinymanSingleAssetAddLiquidityDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): TinymanSingleAssetAddLiquidityDependencies {
  return {
    resolvePoolState: resolveTinymanV2PoolState,
    getSingleAssetQuote: (params) => AddLiquidity.v2.withSingleAsset.getQuote(params),
    generateSingleAssetTxns: (params) => AddLiquidity.v2.withSingleAsset.generateTxns(params),
    ...dependencyOverrides
  };
}

export const tinymanAddLiquiditySingleAssetShape: TransactionShapeSpec<
  TinymanAddLiquiditySingleAssetInput,
  TinymanV2PoolState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Tinyman v2 single-asset add liquidity",
  description:
    "Adds one-sided liquidity to an existing Tinyman AMM v2 pool. Tinyman performs an " +
    "internal swap to balance the deposit and mints pool tokens. Generates the documented " +
    "2-transaction group (asset transfer/payment, add_liquidity app call) as unsigned transactions.",
  supportedOpportunityTypes: ["lp"],
  opportunityRole: "enter",
  requiredInputs: [
    "userAddress",
    "assetAId",
    "assetBId",
    "depositAssetId",
    "depositAmount",
    "maxSlippageBps"
  ],
  sources: [
    {
      kind: "sdk",
      description:
        "@tinymanorg/tinyman-js-sdk AddLiquidity.v2.withSingleAsset (getQuote/generateTxns)"
    },
    {
      kind: "docs",
      description: "Tinyman v2 integration: add subsequent liquidity (single asset)",
      url: "https://docs.tinyman.org/v2-integration/protocol-methods/add-subsequent-liquidity"
    }
  ],

  parseInput(raw: unknown): TinymanAddLiquiditySingleAssetInput {
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
    const depositAssetId = parseAssetId(value.depositAssetId, "depositAssetId");
    if (depositAssetId !== assetAId && depositAssetId !== assetBId) {
      throw new InvalidShapeInputError(
        "depositAssetId must match assetAId or assetBId for the pool pair.",
        { depositAssetId, assetAId, assetBId }
      );
    }
    const depositAmount = parseBaseUnitAmount(value.depositAmount, "depositAmount");
    const maxSlippageBps = parseSlippageBps(value.maxSlippageBps);
    const poolId = value.poolId === undefined ? undefined : parsePoolId(value.poolId);

    return {
      userAddress,
      assetAId,
      assetBId,
      depositAssetId,
      depositAmount,
      maxSlippageBps,
      ...(poolId === undefined ? {} : { poolId })
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: TinymanAddLiquiditySingleAssetInput
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
    input: TinymanAddLiquiditySingleAssetInput,
    state: TinymanV2PoolState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const slippage = input.maxSlippageBps / MAX_SLIPPAGE_BPS;

    let quote: V2SingleAssetInAddLiquidityQuote;
    try {
      quote = dependencies.getSingleAssetQuote({
        pool: state.poolInfo,
        assetIn: { id: input.depositAssetId, amount: input.depositAmount },
        decimals: { asset1: state.asset1Decimals, asset2: state.asset2Decimals },
        slippage
      });
    } catch (error) {
      throw new ShapeBuildError("Failed to compute Tinyman single-asset add-liquidity quote.", {
        cause: error
      });
    }

    let signerTxns: SignerTransaction[];
    try {
      signerTxns = await dependencies.generateSingleAssetTxns({
        client: context.algod,
        network: context.network,
        poolAddress: state.poolAddress,
        assetIn: { id: input.depositAssetId, amount: input.depositAmount },
        poolTokenId: state.poolTokenId,
        initiatorAddr: input.userAddress,
        minPoolTokenAssetAmount: quote.minPoolTokenAssetAmountWithSlippage
      });
    } catch (error) {
      throw new ShapeBuildError(
        "Failed to generate Tinyman single-asset add-liquidity transactions.",
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
        depositAssetId: input.depositAssetId,
        depositAmount: input.depositAmount.toString(),
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
    input: TinymanAddLiquiditySingleAssetInput,
    state: TinymanV2PoolState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (group.length !== 2) {
      errors.push(`Expected exactly 2 transactions, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    const [assetInTxn, appTxn] = group;

    if (input.depositAssetId === ALGO_ASSET_ID) {
      if (assetInTxn === undefined || assetInTxn.type !== "pay" || !assetInTxn.payment) {
        errors.push("Transaction 1 must be an ALGO payment when the deposit asset is ALGO.");
      } else {
        if (assetInTxn.sender !== input.userAddress) {
          errors.push("Transaction 1 sender must be the user address.");
        }
        if (assetInTxn.payment.receiver !== state.poolAddress) {
          errors.push("Transaction 1 receiver must be the pool address.");
        }
        if (assetInTxn.payment.amount !== input.depositAmount.toString()) {
          errors.push("Transaction 1 amount must equal the requested deposit amount.");
        }
      }
    } else if (
      assetInTxn === undefined ||
      assetInTxn.type !== "axfer" ||
      !assetInTxn.assetTransfer
    ) {
      errors.push("Transaction 1 must be an asset transfer for the deposit asset.");
    } else {
      if (assetInTxn.sender !== input.userAddress) {
        errors.push("Transaction 1 sender must be the user address.");
      }
      if (assetInTxn.assetTransfer.receiver !== state.poolAddress) {
        errors.push("Transaction 1 receiver must be the pool address.");
      }
      if (assetInTxn.assetTransfer.assetIndex !== String(input.depositAssetId)) {
        errors.push(
          `Transaction 1 asset must be the deposit asset (${input.depositAssetId}), got ${assetInTxn.assetTransfer.assetIndex}.`
        );
      }
      if (assetInTxn.assetTransfer.amount !== input.depositAmount.toString()) {
        errors.push("Transaction 1 amount must equal the requested deposit amount.");
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
      if (call.appArgsText[0] !== "add_liquidity") {
        errors.push('Transaction 2 first app arg must be "add_liquidity".');
      }
      if (call.appArgsText[1] !== "single") {
        errors.push('Transaction 2 second app arg must be "single".');
      }
      if (!call.foreignAssets.includes(String(state.poolTokenId))) {
        errors.push("Transaction 2 foreign assets must include the pool token id.");
      }
      if (!call.accounts.includes(state.poolAddress)) {
        errors.push("Transaction 2 accounts must include the pool address.");
      }
      const expectedFee = SINGLE_ASSET_APP_CALL_FEE_MULTIPLIER * MIN_ALGO_FEE;
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
