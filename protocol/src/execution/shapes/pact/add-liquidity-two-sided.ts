import algosdk, { Algodv2 } from "algosdk";
import type { LiquidityAddition, Pool } from "@pactfi/pactsdk";

import { InvalidShapeInputError, ShapeBuildError } from "../../errors.js";
import { normalizeTransactions } from "../../normalize-transaction.js";
import {
  ShapeBuildContext,
  ShapeBuildResult,
  ShapeValidationResult,
  TransactionShapeIdentity,
  TransactionShapeSpec,
  buildShapeKey
} from "../../types.js";
import {
  ALGO_ASSET_ID,
  parseAddress,
  parseAssetId,
  parseBaseUnitAmount,
  parsePoolAppId,
  parsePoolId,
  parseSlippageBps,
  slippageBpsToPct,
  toSdkAmount
} from "./parse-input.js";
import {
  PactPoolState,
  createPactBuilderAlgodClient,
  mapAssetsToPactAmounts,
  normalizeSuggestedParamsForPact,
  resolvePactPoolState
} from "./pool-state.js";

const HIGH_SLIPPAGE_BPS = 500;
const MIN_ALGO_FEE = 1000n;

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "pact",
  protocolVersion: "v1",
  action: "addLiquidity",
  variant: "twoSided"
};

export interface PactAddLiquidityTwoSidedInput {
  userAddress: string;
  poolAppId: number;
  assetAId: number;
  assetAAmount: bigint;
  assetBId: number;
  assetBAmount: bigint;
  maxSlippageBps: number;
  poolId?: string;
}

export interface PactAddLiquidityTwoSidedDependencies {
  resolvePoolState: (params: {
    network: ShapeBuildContext["network"];
    algod: Algodv2;
    poolAppId: number;
    assetAId: number;
    assetBId: number;
  }) => Promise<PactPoolState>;
  prepareAddLiquidity: (
    pool: Pool,
    options: {
      primaryAssetAmount: number;
      secondaryAssetAmount: number;
      slippagePct: number;
    }
  ) => LiquidityAddition;
  buildAddLiquidityTxs: (
    pool: Pool,
    options: {
      liquidityAddition: LiquidityAddition;
      address: string;
      suggestedParams: algosdk.SuggestedParams;
    }
  ) => algosdk.Transaction[];
  getSuggestedParams: (algod: Algodv2) => Promise<algosdk.SuggestedParams>;
}

let dependencyOverrides: Partial<PactAddLiquidityTwoSidedDependencies> | undefined;

export function setPactAddLiquidityTwoSidedDependenciesForTests(
  overrides?: Partial<PactAddLiquidityTwoSidedDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): PactAddLiquidityTwoSidedDependencies {
  return {
    resolvePoolState: resolvePactPoolState,
    prepareAddLiquidity: (pool, options) => pool.prepareAddLiquidity(options),
    buildAddLiquidityTxs: (pool, options) =>
      pool.buildAddLiquidityTxs({
        liquidityAddition: options.liquidityAddition,
        address: options.address,
        suggestedParams: options.suggestedParams as never
      }) as unknown as algosdk.Transaction[],
    getSuggestedParams: async () => createPactBuilderAlgodClient().getTransactionParams().do(),
    ...dependencyOverrides
  };
}

export const pactAddLiquidityTwoSidedShape: TransactionShapeSpec<
  PactAddLiquidityTwoSidedInput,
  PactPoolState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Pact v1 two-sided add liquidity",
  description:
    "Adds two-sided liquidity to an existing Pact AMM pool. Generates the documented " +
    "3-transaction group (primary asset deposit, secondary asset deposit, ADDLIQ app call) " +
    "as unsigned transactions.",
  supportedOpportunityTypes: ["lp"],
  opportunityRole: "enter",
  requiredInputs: [
    "userAddress",
    "poolAppId",
    "assetAId",
    "assetAAmount",
    "assetBId",
    "assetBAmount",
    "maxSlippageBps"
  ],
  sources: [
    {
      kind: "sdk",
      description: "@pactfi/pactsdk Pool.prepareAddLiquidity / buildAddLiquidityTxs"
    },
    {
      kind: "docs",
      description: "Pact JS SDK pool liquidity management",
      url: "https://pactfi.github.io/pact-js-sdk/latest/classes/Pool.html"
    }
  ],

  parseInput(raw: unknown): PactAddLiquidityTwoSidedInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;

    const userAddress = parseAddress(value.userAddress);
    const poolAppId = parsePoolAppId(value.poolAppId);
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
      poolAppId,
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
    input: PactAddLiquidityTwoSidedInput
  ): Promise<PactPoolState> {
    const dependencies = resolveDependencies();
    return dependencies.resolvePoolState({
      network: context.network,
      algod: context.algod,
      poolAppId: input.poolAppId,
      assetAId: input.assetAId,
      assetBId: input.assetBId
    });
  },

  async build(
    context: ShapeBuildContext,
    input: PactAddLiquidityTwoSidedInput,
    state: PactPoolState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const { primaryAssetAmount, secondaryAssetAmount } = mapAssetsToPactAmounts({
      assetAId: input.assetAId,
      assetAAmount: input.assetAAmount,
      assetBId: input.assetBId,
      assetBAmount: input.assetBAmount,
      primaryAssetId: state.primaryAssetId,
      secondaryAssetId: state.secondaryAssetId
    });

    const slippagePct = slippageBpsToPct(input.maxSlippageBps);

    let liquidityAddition: LiquidityAddition;
    try {
      liquidityAddition = dependencies.prepareAddLiquidity(state.pool, {
        primaryAssetAmount: toSdkAmount(primaryAssetAmount, "primaryAssetAmount"),
        secondaryAssetAmount: toSdkAmount(secondaryAssetAmount, "secondaryAssetAmount"),
        slippagePct
      });
    } catch (error) {
      throw new ShapeBuildError("Failed to compute Pact add-liquidity quote.", {
        cause: error
      });
    }

    let rawTxns: algosdk.Transaction[];
    try {
      const suggestedParams = await dependencies.getSuggestedParams(
        createPactBuilderAlgodClient()
      );
      rawTxns = dependencies.buildAddLiquidityTxs(state.pool, {
        liquidityAddition,
        address: input.userAddress,
        suggestedParams: normalizeSuggestedParamsForPact(suggestedParams)
      });
      algosdk.assignGroupID(rawTxns);
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Pact add-liquidity transactions.", {
        cause: error
      });
    }

    const warnings: string[] = [];
    if (input.maxSlippageBps >= HIGH_SLIPPAGE_BPS) {
      warnings.push(
        `Tolerated slippage is high (${input.maxSlippageBps} bps); confirm this is intentional.`
      );
    }
    if (state.reserves.totalLiquidity === 0) {
      warnings.push(
        "Pool appears empty; first liquidity must satisfy sqrt(a*b) - 1000 > 0 and 1000 LP tokens are permanently locked."
      );
    }

    return {
      transactions: normalizeTransactions(rawTxns),
      warnings,
      metadata: {
        poolAppId: state.poolAppId,
        escrowAddress: state.escrowAddress,
        liquidityAssetId: state.liquidityAssetId,
        primaryAssetId: state.primaryAssetId,
        secondaryAssetId: state.secondaryAssetId,
        primaryAssetAmountIn: primaryAssetAmount.toString(),
        secondaryAssetAmountIn: secondaryAssetAmount.toString(),
        expectedMintedLiquidityTokens: String(liquidityAddition.effect.mintedLiquidityTokens),
        minimumMintedLiquidityTokens: String(
          liquidityAddition.effect.minimumMintedLiquidityTokens
        ),
        addLiquidityAppFee: liquidityAddition.effect.txFee,
        poolType: state.poolType,
        contractVersion: state.contractVersion,
        slippageBps: input.maxSlippageBps,
        ...(input.poolId === undefined ? {} : { poolId: input.poolId })
      }
    };
  },

  validate(
    group,
    input: PactAddLiquidityTwoSidedInput,
    state: PactPoolState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (group.length !== 3) {
      errors.push(`Expected exactly 3 transactions, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    const { primaryAssetAmount, secondaryAssetAmount } = mapAssetsToPactAmounts({
      assetAId: input.assetAId,
      assetAAmount: input.assetAAmount,
      assetBId: input.assetBId,
      assetBAmount: input.assetBAmount,
      primaryAssetId: state.primaryAssetId,
      secondaryAssetId: state.secondaryAssetId
    });

    const [primaryTxn, secondaryTxn, appTxn] = group;

    validateDepositTxn({
      txn: primaryTxn,
      label: "Transaction 1",
      userAddress: input.userAddress,
      escrowAddress: state.escrowAddress,
      assetId: state.primaryAssetId,
      amount: primaryAssetAmount,
      errors
    });

    validateDepositTxn({
      txn: secondaryTxn,
      label: "Transaction 2",
      userAddress: input.userAddress,
      escrowAddress: state.escrowAddress,
      assetId: state.secondaryAssetId,
      amount: secondaryAssetAmount,
      errors
    });

    if (appTxn === undefined || appTxn.type !== "appl" || !appTxn.applicationCall) {
      errors.push("Transaction 3 must be an application call.");
    } else {
      const call = appTxn.applicationCall;
      if (appTxn.sender !== input.userAddress) {
        errors.push("Transaction 3 sender must be the user address.");
      }
      if (call.appIndex !== String(state.poolAppId)) {
        errors.push(
          `Transaction 3 must call the Pact pool app (${state.poolAppId}), got ${call.appIndex}.`
        );
      }
      if (call.appArgsText[0] !== "ADDLIQ") {
        errors.push('Transaction 3 first app arg must be "ADDLIQ".');
      }
      if (!call.foreignAssets.includes(String(state.primaryAssetId))) {
        errors.push("Transaction 3 foreign assets must include the primary pool asset.");
      }
      if (!call.foreignAssets.includes(String(state.secondaryAssetId))) {
        errors.push("Transaction 3 foreign assets must include the secondary pool asset.");
      }
      if (!call.foreignAssets.includes(String(state.liquidityAssetId))) {
        errors.push("Transaction 3 foreign assets must include the liquidity (LP) asset.");
      }
      if (BigInt(appTxn.fee) < MIN_ALGO_FEE) {
        errors.push(
          `Transaction 3 fee must be at least ${MIN_ALGO_FEE} microAlgos, got ${appTxn.fee}.`
        );
      }
    }

    if (group.some((txn) => !txn.groupPresent)) {
      errors.push("All transactions must belong to a single atomic group.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};

function validateDepositTxn(params: {
  txn: import("../../types.js").SerializedTransaction | undefined;
  label: string;
  userAddress: string;
  escrowAddress: string;
  assetId: number;
  amount: bigint;
  errors: string[];
}): void {
  const { txn, label, userAddress, escrowAddress, assetId, amount, errors } = params;

  if (assetId === ALGO_ASSET_ID) {
    if (txn === undefined || txn.type !== "pay" || !txn.payment) {
      errors.push(`${label} must be an ALGO payment when the primary asset is ALGO.`);
      return;
    }
    if (txn.sender !== userAddress) {
      errors.push(`${label} sender must be the user address.`);
    }
    if (txn.payment.receiver !== escrowAddress) {
      errors.push(`${label} receiver must be the pool escrow address.`);
    }
    if (txn.payment.amount !== amount.toString()) {
      errors.push(`${label} amount must equal the requested primary asset amount.`);
    }
    return;
  }

  if (txn === undefined || txn.type !== "axfer" || !txn.assetTransfer) {
    errors.push(`${label} must be an asset transfer.`);
    return;
  }
  if (txn.sender !== userAddress) {
    errors.push(`${label} sender must be the user address.`);
  }
  if (txn.assetTransfer.receiver !== escrowAddress) {
    errors.push(`${label} receiver must be the pool escrow address.`);
  }
  if (txn.assetTransfer.assetIndex !== String(assetId)) {
    errors.push(`${label} asset must be asset id ${assetId}, got ${txn.assetTransfer.assetIndex}.`);
  }
  if (txn.assetTransfer.amount !== amount.toString()) {
    errors.push(`${label} amount must equal the requested asset amount.`);
  }
}
