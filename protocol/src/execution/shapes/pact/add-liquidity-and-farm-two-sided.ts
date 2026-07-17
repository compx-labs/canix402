import algosdk, { Algodv2 } from "algosdk";
import type { Escrow, LiquidityAddition, Pool } from "@pactfi/pactsdk";

import { InvalidShapeInputError, ShapeBuildError, ShapeStateError } from "../../errors.js";
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
  PactFarmState,
  parseAddress,
  parseBaseUnitAmount,
  parseOptionalEscrowAppId,
  parseOptionalPoolId,
  requireEscrow,
  resolveFarmAppIdFromInput,
  resolvePactFarmState
} from "./farm-state.js";
import {
  ALGO_ASSET_ID,
  parseAssetId,
  parsePoolAppId,
  parseSlippageBps,
  slippageBpsToPct,
  toSdkAmount
} from "./parse-input.js";
import {
  PactPoolState,
  mapAssetsToPactAmounts,
  normalizeSuggestedParamsForPact,
  resolvePactPoolState
} from "./pool-state.js";

const HIGH_SLIPPAGE_BPS = 500;
const MIN_ALGO_FEE = 1000n;
const ADD_LIQUIDITY_TXN_COUNT = 3;

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "pact",
  protocolVersion: "v1",
  action: "addLiquidityAndFarm",
  variant: "twoSided"
};

export interface PactAddLiquidityAndFarmTwoSidedInput {
  userAddress: string;
  farmAppId: number;
  poolAppId: number;
  assetAId: number;
  assetAAmount: bigint;
  assetBId: number;
  assetBAmount: bigint;
  maxSlippageBps: number;
  /** LP amount to stake after mint. Defaults to the guaranteed minimum minted LP. */
  amount?: bigint;
  escrowAppId?: number;
  poolId?: string;
}

export interface PactAddLiquidityAndFarmState {
  pool: PactPoolState;
  farm: PactFarmState;
}

export interface PactAddLiquidityAndFarmTwoSidedDependencies {
  resolvePoolState: (params: {
    network: ShapeBuildContext["network"];
    algod: Algodv2;
    poolAppId: number;
    assetAId: number;
    assetBId: number;
  }) => Promise<PactPoolState>;
  resolveFarmState: typeof resolvePactFarmState;
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
  buildStakeTxs: (escrow: Escrow, amount: number) => algosdk.Transaction[];
  getSuggestedParams: (algod: Algodv2) => Promise<algosdk.SuggestedParams>;
}

let dependencyOverrides: Partial<PactAddLiquidityAndFarmTwoSidedDependencies> | undefined;

export function setPactAddLiquidityAndFarmTwoSidedDependenciesForTests(
  overrides?: Partial<PactAddLiquidityAndFarmTwoSidedDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): PactAddLiquidityAndFarmTwoSidedDependencies {
  return {
    resolvePoolState: resolvePactPoolState,
    resolveFarmState: resolvePactFarmState,
    prepareAddLiquidity: (pool, options) => pool.prepareAddLiquidity(options),
    buildAddLiquidityTxs: (pool, options) =>
      pool.buildAddLiquidityTxs({
        liquidityAddition: options.liquidityAddition,
        address: options.address,
        suggestedParams: options.suggestedParams as never
      }) as unknown as algosdk.Transaction[],
    buildStakeTxs: (escrow, amount) =>
      escrow.buildStakeTxs(amount) as unknown as algosdk.Transaction[],
    getSuggestedParams: async (algod) => algod.getTransactionParams().do(),
    ...dependencyOverrides
  };
}

export const pactAddLiquidityAndFarmTwoSidedShape: TransactionShapeSpec<
  PactAddLiquidityAndFarmTwoSidedInput,
  PactAddLiquidityAndFarmState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Pact v1 two-sided add liquidity and farm stake",
  description:
    "Adds two-sided liquidity to a Pact AMM pool and, in the same atomic group, stakes " +
    "the newly minted LP tokens into an existing Pact farm escrow (LP leaves the wallet). " +
    "Requires a previously deployed farm escrow.",
  supportedOpportunityTypes: ["farm"],
  opportunityRole: "enter",
  requiredInputs: [
    "userAddress",
    "farmAppId",
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
      description:
        "@pactfi/pactsdk Pool.prepareAddLiquidity / buildAddLiquidityTxs + Escrow.buildStakeTxs"
    }
  ],

  parseInput(raw: unknown): PactAddLiquidityAndFarmTwoSidedInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;

    const assetAId = parseAssetId(value.assetAId, "assetAId");
    const assetBId = parseAssetId(value.assetBId, "assetBId");
    if (assetAId === assetBId) {
      throw new InvalidShapeInputError("assetAId and assetBId must be different assets.", {
        assetAId,
        assetBId
      });
    }
    const amount =
      value.amount === undefined ? undefined : parseBaseUnitAmount(value.amount, "amount");
    const escrowAppId = parseOptionalEscrowAppId(value.escrowAppId);
    const poolId = parseOptionalPoolId(value.poolId);

    return {
      userAddress: parseAddress(value.userAddress),
      farmAppId: resolveFarmAppIdFromInput(value),
      poolAppId: parsePoolAppId(value.poolAppId),
      assetAId,
      assetAAmount: parseBaseUnitAmount(value.assetAAmount, "assetAAmount"),
      assetBId,
      assetBAmount: parseBaseUnitAmount(value.assetBAmount, "assetBAmount"),
      maxSlippageBps: parseSlippageBps(value.maxSlippageBps),
      ...(amount === undefined ? {} : { amount }),
      ...(escrowAppId === undefined ? {} : { escrowAppId }),
      ...(poolId === undefined ? {} : { poolId })
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: PactAddLiquidityAndFarmTwoSidedInput
  ): Promise<PactAddLiquidityAndFarmState> {
    const dependencies = resolveDependencies();
    const [pool, farm] = await Promise.all([
      dependencies.resolvePoolState({
        network: context.network,
        algod: context.algod,
        poolAppId: input.poolAppId,
        assetAId: input.assetAId,
        assetBId: input.assetBId
      }),
      dependencies.resolveFarmState({
        network: context.network,
        algod: context.algod,
        userAddress: input.userAddress,
        farmAppId: input.farmAppId,
        ...(input.escrowAppId === undefined ? {} : { escrowAppId: input.escrowAppId })
      })
    ]);

    if (pool.liquidityAssetId !== farm.stakedAssetId) {
      throw new ShapeStateError(
        "Resolved pool LP asset does not match the farm staked asset.",
        {
          details: {
            poolLiquidityAssetId: pool.liquidityAssetId,
            farmStakedAssetId: farm.stakedAssetId,
            poolAppId: pool.poolAppId,
            farmAppId: farm.farmAppId
          }
        }
      );
    }

    return { pool, farm };
  },

  async build(
    context: ShapeBuildContext,
    input: PactAddLiquidityAndFarmTwoSidedInput,
    state: PactAddLiquidityAndFarmState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const escrow = requireEscrow(state.farm);
    const warnings: string[] = [];

    const { primaryAssetAmount, secondaryAssetAmount } = mapAssetsToPactAmounts({
      assetAId: input.assetAId,
      assetAAmount: input.assetAAmount,
      assetBId: input.assetBId,
      assetBAmount: input.assetBAmount,
      primaryAssetId: state.pool.primaryAssetId,
      secondaryAssetId: state.pool.secondaryAssetId
    });

    const slippagePct = slippageBpsToPct(input.maxSlippageBps);

    let liquidityAddition: LiquidityAddition;
    try {
      liquidityAddition = dependencies.prepareAddLiquidity(state.pool.pool, {
        primaryAssetAmount: toSdkAmount(primaryAssetAmount, "primaryAssetAmount"),
        secondaryAssetAmount: toSdkAmount(secondaryAssetAmount, "secondaryAssetAmount"),
        slippagePct
      });
    } catch (error) {
      throw new ShapeBuildError("Failed to compute Pact add-liquidity quote for farm enter.", {
        cause: error
      });
    }

    const defaultStakeAmount = BigInt(
      Math.trunc(liquidityAddition.effect.minimumMintedLiquidityTokens)
    );
    const stakeAmount = input.amount ?? defaultStakeAmount;
    if (stakeAmount <= 0n) {
      throw new ShapeBuildError("Resolved stake amount must be greater than zero.");
    }

    const suggestedParams = normalizeSuggestedParamsForPact(
      await dependencies.getSuggestedParams(context.algod)
    );
    state.farm.farm.setSuggestedParams(suggestedParams as never);
    escrow.setSuggestedParams(suggestedParams as never);

    let combined: algosdk.Transaction[];
    try {
      const addTxns = dependencies.buildAddLiquidityTxs(state.pool.pool, {
        liquidityAddition,
        address: input.userAddress,
        suggestedParams
      });
      const stakeTxns = dependencies.buildStakeTxs(
        escrow,
        toSdkAmount(stakeAmount, "amount")
      );
      combined = [...addTxns, ...stakeTxns];
      for (const txn of combined) {
        // Clear any pre-existing group id before regrouping add + stake.
        delete (txn as { group?: Uint8Array }).group;
      }
      algosdk.assignGroupID(combined);
    } catch (error) {
      throw new ShapeBuildError(
        "Failed to generate Pact add-liquidity-and-farm transactions.",
        { cause: error }
      );
    }

    if (input.maxSlippageBps >= HIGH_SLIPPAGE_BPS) {
      warnings.push(
        `Tolerated slippage is high (${input.maxSlippageBps} bps); confirm this is intentional.`
      );
    }
    warnings.push(
      "Newly minted LP tokens leave the wallet into the Pact farm escrow in the same atomic group."
    );

    return {
      transactions: normalizeTransactions(combined),
      warnings,
      metadata: {
        poolAppId: state.pool.poolAppId,
        farmAppId: state.farm.farmAppId,
        escrowAppId: state.farm.escrowAppId,
        escrowAddress: state.farm.escrowAddress,
        liquidityAssetId: state.pool.liquidityAssetId,
        stakeAmount: stakeAmount.toString(),
        expectedMintedLiquidityTokens: String(liquidityAddition.effect.mintedLiquidityTokens),
        minimumMintedLiquidityTokens: String(
          liquidityAddition.effect.minimumMintedLiquidityTokens
        ),
        slippageBps: input.maxSlippageBps,
        ...(input.poolId === undefined ? {} : { poolId: input.poolId })
      }
    };
  },

  validate(
    group,
    input: PactAddLiquidityAndFarmTwoSidedInput,
    state: PactAddLiquidityAndFarmState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (group.length < ADD_LIQUIDITY_TXN_COUNT + 2) {
      errors.push(
        `Expected at least ${ADD_LIQUIDITY_TXN_COUNT + 2} transactions, received ${group.length}.`
      );
      return { valid: false, errors, warnings };
    }

    const addGroup = group.slice(0, ADD_LIQUIDITY_TXN_COUNT);
    const stakeGroup = group.slice(ADD_LIQUIDITY_TXN_COUNT);

    validateAddLiquidityPrefix({
      group: addGroup,
      input,
      pool: state.pool,
      errors
    });

    if (state.farm.escrowAddress === null || state.farm.escrowAppId === null) {
      errors.push("Resolved farm state is missing escrow address/app id.");
    } else {
      const transferTxn = stakeGroup[0];
      if (
        transferTxn === undefined ||
        transferTxn.type !== "axfer" ||
        !transferTxn.assetTransfer
      ) {
        errors.push("Farm stake prefix must start with an LP transfer into the escrow.");
      } else {
        if (transferTxn.assetTransfer.receiver !== state.farm.escrowAddress) {
          errors.push("Stake transfer receiver must be the farm escrow address.");
        }
        if (transferTxn.assetTransfer.assetIndex !== String(state.farm.stakedAssetId)) {
          errors.push("Stake transfer asset must be the farm staked LP asset.");
        }
      }

      const updateTxn = stakeGroup[stakeGroup.length - 1];
      if (
        updateTxn === undefined ||
        updateTxn.type !== "appl" ||
        !updateTxn.applicationCall
      ) {
        errors.push("Farm stake suffix must end with a farm update application call.");
      } else if (updateTxn.applicationCall.appIndex !== String(state.farm.farmAppId)) {
        errors.push("Farm update must call the farm application.");
      }
    }

    if (group.some((txn) => !txn.groupPresent)) {
      errors.push("All transactions must belong to a single atomic group.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};

function validateAddLiquidityPrefix(params: {
  group: readonly SerializedTransaction[];
  input: PactAddLiquidityAndFarmTwoSidedInput;
  pool: PactPoolState;
  errors: string[];
}): void {
  const { group, input, pool, errors } = params;
  const { primaryAssetAmount, secondaryAssetAmount } = mapAssetsToPactAmounts({
    assetAId: input.assetAId,
    assetAAmount: input.assetAAmount,
    assetBId: input.assetBId,
    assetBAmount: input.assetBAmount,
    primaryAssetId: pool.primaryAssetId,
    secondaryAssetId: pool.secondaryAssetId
  });

  const [primaryTxn, secondaryTxn, appTxn] = group;

  validateDepositTxn({
    txn: primaryTxn,
    label: "Add-liquidity transaction 1",
    userAddress: input.userAddress,
    escrowAddress: pool.escrowAddress,
    assetId: pool.primaryAssetId,
    amount: primaryAssetAmount,
    errors
  });
  validateDepositTxn({
    txn: secondaryTxn,
    label: "Add-liquidity transaction 2",
    userAddress: input.userAddress,
    escrowAddress: pool.escrowAddress,
    assetId: pool.secondaryAssetId,
    amount: secondaryAssetAmount,
    errors
  });

  if (appTxn === undefined || appTxn.type !== "appl" || !appTxn.applicationCall) {
    errors.push("Add-liquidity transaction 3 must be an application call.");
  } else {
    if (appTxn.applicationCall.appIndex !== String(pool.poolAppId)) {
      errors.push("Add-liquidity transaction 3 must call the Pact pool app.");
    }
    if (appTxn.applicationCall.appArgsText[0] !== "ADDLIQ") {
      errors.push('Add-liquidity transaction 3 first app arg must be "ADDLIQ".');
    }
    if (BigInt(appTxn.fee) < MIN_ALGO_FEE) {
      errors.push(
        `Add-liquidity transaction 3 fee must be at least ${MIN_ALGO_FEE.toString()} microAlgos.`
      );
    }
  }
}

function validateDepositTxn(params: {
  txn: SerializedTransaction | undefined;
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
      errors.push(`${label} must be an ALGO payment when the asset is ALGO.`);
      return;
    }
    if (txn.sender !== userAddress) {
      errors.push(`${label} sender must be the user address.`);
    }
    if (txn.payment.receiver !== escrowAddress) {
      errors.push(`${label} receiver must be the pool escrow address.`);
    }
    if (txn.payment.amount !== amount.toString()) {
      errors.push(`${label} amount must equal the requested asset amount.`);
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
    errors.push(`${label} asset must be asset id ${assetId}.`);
  }
  if (txn.assetTransfer.amount !== amount.toString()) {
    errors.push(`${label} amount must equal the requested asset amount.`);
  }
}
