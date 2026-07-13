import algosdk, { Algodv2 } from "algosdk";
import type { Pool } from "@pactfi/pactsdk";

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
  parseAddress,
  parseBaseUnitAmount,
  parsePoolAppId,
  parsePoolId,
  toSdkAmount
} from "./parse-input.js";
import { PactPoolState, resolvePactPoolState } from "./pool-state.js";

const REMOVE_LIQUIDITY_APP_CALL_FEE = 3000n;
const MIN_ALGO_FEE = 1000n;

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "pact",
  protocolVersion: "v1",
  action: "removeLiquidity",
  variant: "proportional"
};

export interface PactRemoveLiquidityProportionalInput {
  userAddress: string;
  poolAppId: number;
  poolTokenAmount: bigint;
  poolId?: string;
}

export interface PactRemoveLiquidityProportionalDependencies {
  resolvePoolState: (params: {
    network: ShapeBuildContext["network"];
    algod: Algodv2;
    poolAppId: number;
  }) => Promise<PactPoolState>;
  buildRemoveLiquidityTxs: (
    pool: Pool,
    options: {
      address: string;
      amount: number;
      suggestedParams: algosdk.SuggestedParams;
    }
  ) => algosdk.Transaction[];
  getSuggestedParams: (algod: Algodv2) => Promise<algosdk.SuggestedParams>;
}

let dependencyOverrides: Partial<PactRemoveLiquidityProportionalDependencies> | undefined;

export function setPactRemoveLiquidityProportionalDependenciesForTests(
  overrides?: Partial<PactRemoveLiquidityProportionalDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): PactRemoveLiquidityProportionalDependencies {
  return {
    resolvePoolState: (params) =>
      resolvePactPoolState({
        network: params.network,
        algod: params.algod,
        poolAppId: params.poolAppId
      }),
    buildRemoveLiquidityTxs: (pool, options) =>
      pool.buildRemoveLiquidityTxs({
        address: options.address,
        amount: options.amount,
        suggestedParams: options.suggestedParams as never
      }) as unknown as algosdk.Transaction[],
    getSuggestedParams: async (algod) => algod.getTransactionParams().do(),
    ...dependencyOverrides
  };
}

export const pactRemoveLiquidityProportionalShape: TransactionShapeSpec<
  PactRemoveLiquidityProportionalInput,
  PactPoolState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Pact v1 proportional remove liquidity",
  description:
    "Removes liquidity from an existing Pact AMM pool proportionally. Generates the documented " +
    "2-transaction group (LP token deposit, REMLIQ app call) as unsigned transactions.",
  supportedOpportunityTypes: ["lp"],
  requiredInputs: ["userAddress", "poolAppId", "poolTokenAmount"],
  sources: [
    {
      kind: "sdk",
      description: "@pactfi/pactsdk Pool.buildRemoveLiquidityTxs"
    },
    {
      kind: "docs",
      description: "Pact JS SDK pool liquidity management",
      url: "https://pactfi.github.io/pact-js-sdk/latest/classes/Pool.html"
    }
  ],

  parseInput(raw: unknown): PactRemoveLiquidityProportionalInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;

    const userAddress = parseAddress(value.userAddress);
    const poolAppId = parsePoolAppId(value.poolAppId);
    const poolTokenAmount = parseBaseUnitAmount(value.poolTokenAmount, "poolTokenAmount");
    const poolId = value.poolId === undefined ? undefined : parsePoolId(value.poolId);

    return {
      userAddress,
      poolAppId,
      poolTokenAmount,
      ...(poolId === undefined ? {} : { poolId })
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: PactRemoveLiquidityProportionalInput
  ): Promise<PactPoolState> {
    const dependencies = resolveDependencies();
    return dependencies.resolvePoolState({
      network: context.network,
      algod: context.algod,
      poolAppId: input.poolAppId
    });
  },

  async build(
    context: ShapeBuildContext,
    input: PactRemoveLiquidityProportionalInput,
    state: PactPoolState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();

    let rawTxns: algosdk.Transaction[];
    try {
      const suggestedParams = await dependencies.getSuggestedParams(context.algod);
      rawTxns = dependencies.buildRemoveLiquidityTxs(state.pool, {
        address: input.userAddress,
        amount: toSdkAmount(input.poolTokenAmount, "poolTokenAmount"),
        suggestedParams
      });
      algosdk.assignGroupID(rawTxns);
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Pact remove-liquidity transactions.", {
        cause: error
      });
    }

    const warnings = [
      "Pact SDK v0.8.1 encodes REMLIQ minimum asset outputs as 0/0; confirm on-chain results before signing if slippage protection is required."
    ];

    return {
      transactions: normalizeTransactions(rawTxns),
      warnings,
      metadata: {
        poolAppId: state.poolAppId,
        escrowAddress: state.escrowAddress,
        liquidityAssetId: state.liquidityAssetId,
        primaryAssetId: state.primaryAssetId,
        secondaryAssetId: state.secondaryAssetId,
        poolTokenAmountIn: input.poolTokenAmount.toString(),
        removeLiquidityAppFee: Number(REMOVE_LIQUIDITY_APP_CALL_FEE),
        poolType: state.poolType,
        contractVersion: state.contractVersion,
        ...(input.poolId === undefined ? {} : { poolId: input.poolId })
      }
    };
  },

  validate(
    group,
    input: PactRemoveLiquidityProportionalInput,
    state: PactPoolState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [
      "Minimum primary/secondary outputs are not enforced by the current Pact SDK remove builder (REMLIQ args are 0/0)."
    ];

    if (group.length !== 2) {
      errors.push(`Expected exactly 2 transactions, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    const [lpTokenTxn, appTxn] = group;

    if (lpTokenTxn === undefined || lpTokenTxn.type !== "axfer" || !lpTokenTxn.assetTransfer) {
      errors.push("Transaction 1 must be an LP token asset transfer.");
    } else {
      if (lpTokenTxn.sender !== input.userAddress) {
        errors.push("Transaction 1 sender must be the user address.");
      }
      if (lpTokenTxn.assetTransfer.receiver !== state.escrowAddress) {
        errors.push("Transaction 1 receiver must be the pool escrow address.");
      }
      if (lpTokenTxn.assetTransfer.assetIndex !== String(state.liquidityAssetId)) {
        errors.push(
          `Transaction 1 asset must be the LP token (${state.liquidityAssetId}), got ${lpTokenTxn.assetTransfer.assetIndex}.`
        );
      }
      if (lpTokenTxn.assetTransfer.amount !== input.poolTokenAmount.toString()) {
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
      if (call.appIndex !== String(state.poolAppId)) {
        errors.push(
          `Transaction 2 must call the Pact pool app (${state.poolAppId}), got ${call.appIndex}.`
        );
      }
      if (call.appArgsText[0] !== "REMLIQ") {
        errors.push('Transaction 2 first app arg must be "REMLIQ".');
      }
      if (!call.foreignAssets.includes(String(state.primaryAssetId))) {
        errors.push("Transaction 2 foreign assets must include the primary pool asset.");
      }
      if (!call.foreignAssets.includes(String(state.secondaryAssetId))) {
        errors.push("Transaction 2 foreign assets must include the secondary pool asset.");
      }
      if (BigInt(appTxn.fee) < REMOVE_LIQUIDITY_APP_CALL_FEE) {
        errors.push(
          `Transaction 2 fee must be at least ${REMOVE_LIQUIDITY_APP_CALL_FEE} microAlgos, got ${appTxn.fee}.`
        );
      }
    }

    if (group.some((txn) => !txn.groupPresent)) {
      errors.push("All transactions must belong to a single atomic group.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};
