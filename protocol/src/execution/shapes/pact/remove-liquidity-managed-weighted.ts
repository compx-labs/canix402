import algosdk, { Algodv2 } from "algosdk";

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
  PACT_V201_APP_CALL_FEE,
  PACT_V201_REMOVE_LIQUIDITY_SELECTOR,
  PactManagedWeightedPoolState,
  nonAlgoForeignAssets,
  proportionalMinimumOuts,
  resolvePactManagedWeightedPoolState
} from "./managed-weighted-state.js";
import {
  parseAddress,
  parseBaseUnitAmount,
  parsePoolAppId,
  parsePoolId,
  parseSlippageBps
} from "./parse-input.js";

const HIGH_SLIPPAGE_BPS = 500;
const MIN_ALGO_FEE = 1000n;

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "pact",
  protocolVersion: "v201",
  action: "removeLiquidity",
  variant: "proportional"
};

export interface PactManagedWeightedRemoveLiquidityInput {
  userAddress: string;
  poolAppId: number;
  liquidityAmount: bigint;
  maxSlippageBps: number;
  poolId?: string;
}

export interface PactManagedWeightedRemoveLiquidityDependencies {
  resolvePoolState: typeof resolvePactManagedWeightedPoolState;
  getSuggestedParams: (algod: Algodv2) => Promise<algosdk.SuggestedParams>;
}

let dependencyOverrides: Partial<PactManagedWeightedRemoveLiquidityDependencies> | undefined;

export function setPactManagedWeightedRemoveLiquidityDependenciesForTests(
  overrides?: Partial<PactManagedWeightedRemoveLiquidityDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): PactManagedWeightedRemoveLiquidityDependencies {
  return {
    resolvePoolState: resolvePactManagedWeightedPoolState,
    getSuggestedParams: async (algod) => algod.getTransactionParams().do(),
    ...dependencyOverrides
  };
}

export const pactManagedWeightedRemoveLiquidityShape: TransactionShapeSpec<
  PactManagedWeightedRemoveLiquidityInput,
  PactManagedWeightedPoolState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Pact v201 proportional remove liquidity",
  description:
    "Removes liquidity from a Pact managed-weighted pool. Sends LP tokens to the pool app " +
    "address, then calls the pool with proportional minimum outputs for both assets.",
  supportedOpportunityTypes: ["lp"],
  opportunityRole: "exit",
  requiredInputs: ["userAddress", "poolAppId", "liquidityAmount", "maxSlippageBps"],
  sources: [
    {
      kind: "docs",
      description: "Mainnet managed-weighted remove group (LP transfer + pool app call)"
    }
  ],

  parseInput(raw: unknown): PactManagedWeightedRemoveLiquidityInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    const userAddress = parseAddress(value.userAddress);
    const poolAppId = parsePoolAppId(value.poolAppId);
    const liquidityAmount = parseBaseUnitAmount(value.liquidityAmount, "liquidityAmount");
    const maxSlippageBps = parseSlippageBps(value.maxSlippageBps);
    const poolId = value.poolId === undefined ? undefined : parsePoolId(value.poolId);
    return {
      userAddress,
      poolAppId,
      liquidityAmount,
      maxSlippageBps,
      ...(poolId === undefined ? {} : { poolId })
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: PactManagedWeightedRemoveLiquidityInput
  ): Promise<PactManagedWeightedPoolState> {
    return resolveDependencies().resolvePoolState({
      algod: context.algod,
      poolAppId: input.poolAppId
    });
  },

  async build(
    context: ShapeBuildContext,
    input: PactManagedWeightedRemoveLiquidityInput,
    state: PactManagedWeightedPoolState
  ): Promise<ShapeBuildResult> {
    const { minA, minB } = proportionalMinimumOuts({
      liquidityAmount: input.liquidityAmount,
      reserveA: state.reserveA,
      reserveB: state.reserveB,
      issuedLp: state.issuedLp,
      maxSlippageBps: input.maxSlippageBps
    });

    const dependencies = resolveDependencies();
    let suggestedParams: algosdk.SuggestedParams;
    try {
      suggestedParams = await dependencies.getSuggestedParams(context.algod);
    } catch (error) {
      throw new ShapeBuildError("Failed to fetch suggested params for Pact remove liquidity.", {
        cause: error
      });
    }

    const lpTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: input.userAddress,
      receiver: state.poolAddress,
      assetIndex: state.lpAssetId,
      amount: input.liquidityAmount,
      suggestedParams: withFlatFee(suggestedParams, MIN_ALGO_FEE)
    });
    const appTxn = algosdk.makeApplicationCallTxnFromObject({
      sender: input.userAddress,
      appIndex: BigInt(state.poolAppId),
      onComplete: algosdk.OnApplicationComplete.NoOpOC,
      appArgs: [
        PACT_V201_REMOVE_LIQUIDITY_SELECTOR,
        algosdk.encodeUint64(minA),
        algosdk.encodeUint64(minB)
      ],
      foreignApps: [BigInt(state.vaultAppId)],
      foreignAssets: nonAlgoForeignAssets(state),
      suggestedParams: withFlatFee(suggestedParams, PACT_V201_APP_CALL_FEE)
    });
    const txns = [lpTxn, appTxn];
    algosdk.assignGroupID(txns);

    const warnings: string[] = [];
    if (input.maxSlippageBps >= HIGH_SLIPPAGE_BPS) {
      warnings.push(
        `Tolerated slippage is high (${input.maxSlippageBps} bps); confirm this is intentional.`
      );
    }

    return {
      transactions: normalizeTransactions(txns),
      warnings,
      metadata: {
        poolAppId: state.poolAppId,
        vaultAppId: state.vaultAppId,
        poolAddress: state.poolAddress,
        liquidityAssetId: state.lpAssetId,
        liquidityAmountIn: input.liquidityAmount.toString(),
        minimumAssetAOut: minA.toString(),
        minimumAssetBOut: minB.toString(),
        removeLiquidityAppFee: Number(PACT_V201_APP_CALL_FEE),
        slippageBps: input.maxSlippageBps,
        ...(input.poolId === undefined ? {} : { poolId: input.poolId })
      }
    };
  },

  validate(group, input, state): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (group.length !== 2) {
      errors.push(`Expected exactly 2 transactions, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    const [lpTxn, appTxn] = group;
    if (lpTxn === undefined || lpTxn.type !== "axfer" || !lpTxn.assetTransfer) {
      errors.push("Transaction 1 must be an LP token asset transfer.");
    } else {
      if (lpTxn.sender !== input.userAddress) {
        errors.push("Transaction 1 sender must be the user address.");
      }
      if (lpTxn.assetTransfer.receiver !== state.poolAddress) {
        errors.push("Transaction 1 receiver must be the pool application address.");
      }
      if (lpTxn.assetTransfer.assetIndex !== String(state.lpAssetId)) {
        errors.push("Transaction 1 asset must be the pool LP token.");
      }
      if (lpTxn.assetTransfer.amount !== input.liquidityAmount.toString()) {
        errors.push("Transaction 1 amount must equal liquidityAmount.");
      }
    }

    const { minA, minB } = proportionalMinimumOuts({
      liquidityAmount: input.liquidityAmount,
      reserveA: state.reserveA,
      reserveB: state.reserveB,
      issuedLp: state.issuedLp,
      maxSlippageBps: input.maxSlippageBps
    });

    if (appTxn === undefined || appTxn.type !== "appl" || !appTxn.applicationCall) {
      errors.push("Transaction 2 must be an application call.");
    } else {
      const call = appTxn.applicationCall;
      if (appTxn.sender !== input.userAddress) {
        errors.push("Transaction 2 sender must be the user address.");
      }
      if (call.appIndex !== String(state.poolAppId)) {
        errors.push(`Transaction 2 must target pool ${state.poolAppId}.`);
      }
      if (call.appArgsBase64[0] !== Buffer.from(PACT_V201_REMOVE_LIQUIDITY_SELECTOR).toString("base64")) {
        errors.push("Remove-liquidity app call selector does not match the managed-weighted pool.");
      }
      const minAArg = call.appArgsBase64[1];
      const minBArg = call.appArgsBase64[2];
      if (
        minAArg === undefined ||
        minBArg === undefined ||
        decodeUint64(minAArg) !== minA ||
        decodeUint64(minBArg) !== minB
      ) {
        errors.push("Remove-liquidity minimum outputs must match the proportional quote.");
      }
      if (!call.foreignApps.includes(String(state.vaultAppId))) {
        errors.push("Remove-liquidity app call must include the vault foreign app.");
      }
      for (const assetId of nonAlgoForeignAssets(state)) {
        if (!call.foreignAssets.includes(assetId.toString())) {
          errors.push(`Remove-liquidity app call must include foreign asset ${assetId.toString()}.`);
        }
      }
      if (BigInt(appTxn.fee) < PACT_V201_APP_CALL_FEE) {
        errors.push(
          `Remove-liquidity app call fee must be at least ${PACT_V201_APP_CALL_FEE} microAlgos.`
        );
      }
    }

    if (group.some((txn) => !txn.groupPresent)) {
      errors.push("All transactions must belong to a single atomic group.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};

function withFlatFee(
  suggestedParams: algosdk.SuggestedParams,
  fee: bigint
): algosdk.SuggestedParams {
  return { ...suggestedParams, fee, flatFee: true };
}

function decodeUint64(value: string): bigint {
  const bytes = Buffer.from(value, "base64");
  return bytes.length === 0 ? 0n : BigInt(algosdk.decodeUint64(bytes, "bigint"));
}
