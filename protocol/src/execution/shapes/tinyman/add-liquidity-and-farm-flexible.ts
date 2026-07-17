import { Algodv2 } from "algosdk";
import {
  AddLiquidity,
  combineAndRegroupSignerTxns,
  getStakingAppID,
  prepareCommitTransactions
} from "@tinymanorg/tinyman-js-sdk";
import type {
  SignerTransaction,
  V2FlexibleAddLiquidityQuote,
  V2PoolInfo
} from "@tinymanorg/tinyman-js-sdk";

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
  TinymanV2PoolState,
  orderTinymanAssets,
  resolveTinymanV2PoolState
} from "./pool-state.js";
import { tinymanAddLiquidityFlexibleShape } from "./add-liquidity-flexible.js";
import { validateFarmCommitTransactions } from "./farm-commit.js";
import {
  parseFarmAddress,
  parseAssetId,
  parseBaseUnitAmount,
  parseOptionalAssetId,
  parseOptionalBaseUnitAmount,
  parseOptionalPoolId,
  parseOptionalProgramAccount,
  parseOptionalProgramId,
  resolveTinymanFarmProgram,
  type TinymanFarmProgram
} from "./farm-state.js";

const MAX_SLIPPAGE_BPS = 10_000;
const HIGH_SLIPPAGE_BPS = 500;
/** Flexible add-liquidity produces 3 transactions; commit adds 1 (+1 with a required asset). */
const ADD_LIQUIDITY_TXN_COUNT = 3;

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "tinyman",
  protocolVersion: "v2",
  action: "addLiquidityAndFarm",
  variant: "flexible"
};

export interface TinymanAddLiquidityAndFarmFlexibleInput {
  userAddress: string;
  assetAId: number;
  assetAAmount: bigint;
  assetBId: number;
  assetBAmount: bigint;
  maxSlippageBps: number;
  programId?: number;
  programAccount?: string;
  /** LP amount to commit. Defaults to the guaranteed minimum pool tokens from the add quote. */
  commitAmount?: bigint;
  requiredAssetId?: number;
  poolId?: string;
}

export interface TinymanAddLiquidityAndFarmState extends TinymanV2PoolState {
  stakingAppId: number;
  farmProgram: TinymanFarmProgram;
}

export interface TinymanAddLiquidityAndFarmFlexibleDependencies {
  resolvePoolState: (params: {
    network: ShapeBuildContext["network"];
    algod: Algodv2;
    asset1Id: number;
    asset2Id: number;
  }) => Promise<TinymanV2PoolState>;
  getStakingAppId: (network: ShapeBuildContext["network"]) => number;
  resolveFarmProgram: typeof resolveTinymanFarmProgram;
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
  prepareCommitTransactions: (params: {
    client: Algodv2;
    stakingAppID: number;
    program: { accountAddress: string; id: number };
    liquidityAssetID: number;
    amount: bigint;
    initiatorAddr: string;
    requiredAssetID?: number;
  }) => Promise<SignerTransaction[]>;
  combineAndRegroupSignerTxns: (
    ...groups: SignerTransaction[][]
  ) => SignerTransaction[];
}

let dependencyOverrides:
  | Partial<TinymanAddLiquidityAndFarmFlexibleDependencies>
  | undefined;

export function setTinymanAddLiquidityAndFarmFlexibleDependenciesForTests(
  overrides?: Partial<TinymanAddLiquidityAndFarmFlexibleDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): TinymanAddLiquidityAndFarmFlexibleDependencies {
  return {
    resolvePoolState: resolveTinymanV2PoolState,
    getStakingAppId: (network) => getStakingAppID(network),
    resolveFarmProgram: resolveTinymanFarmProgram,
    getFlexibleQuote: (params) => AddLiquidity.v2.flexible.getQuote(params),
    generateFlexibleTxns: (params) => AddLiquidity.v2.flexible.generateTxns(params),
    prepareCommitTransactions: (params) => prepareCommitTransactions(params),
    combineAndRegroupSignerTxns: (...groups) => combineAndRegroupSignerTxns(...groups),
    ...dependencyOverrides
  };
}

export const tinymanAddLiquidityAndFarmFlexibleShape: TransactionShapeSpec<
  TinymanAddLiquidityAndFarmFlexibleInput,
  TinymanAddLiquidityAndFarmState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Tinyman v2 flexible add liquidity and farm commit",
  description:
    "Adds two-sided flexible liquidity to a Tinyman AMM v2 pool and, in the same atomic " +
    "group, commits the newly minted LP position to a Tinyman farm. LP tokens never leave " +
    "the wallet; the farm commit is a staking app call. Returns the combined, regrouped " +
    "unsigned transaction group.",
  supportedOpportunityTypes: ["farm"],
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
      description:
        "@tinymanorg/tinyman-js-sdk AddLiquidity.v2.flexible + prepareCommitTransactions + combineAndRegroupSignerTxns"
    },
    {
      kind: "docs",
      description: "Tinyman v2 integration: add subsequent liquidity (flexible)",
      url: "https://docs.tinyman.org/v2-integration/protocol-methods/add-subsequent-liquidity"
    }
  ],

  parseInput(raw: unknown): TinymanAddLiquidityAndFarmFlexibleInput {
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
    const commitAmount = parseOptionalBaseUnitAmount(value.commitAmount, "commitAmount");
    const requiredAssetId = parseOptionalAssetId(value.requiredAssetId, "requiredAssetId");
    const poolId = parseOptionalPoolId(value.poolId);
    const programId = parseOptionalProgramId(value.programId);
    const programAccount = parseOptionalProgramAccount(value.programAccount);
    if ((programId === undefined) !== (programAccount === undefined)) {
      throw new InvalidShapeInputError(
        "programId and programAccount must be provided together when overriding farm program resolution."
      );
    }

    return {
      userAddress: parseFarmAddress(value.userAddress),
      assetAId,
      assetAAmount: parseBaseUnitAmount(value.assetAAmount, "assetAAmount"),
      assetBId,
      assetBAmount: parseBaseUnitAmount(value.assetBAmount, "assetBAmount"),
      maxSlippageBps: parseSlippageBps(value.maxSlippageBps),
      ...(programId === undefined ? {} : { programId }),
      ...(programAccount === undefined ? {} : { programAccount }),
      ...(commitAmount === undefined ? {} : { commitAmount }),
      ...(requiredAssetId === undefined ? {} : { requiredAssetId }),
      ...(poolId === undefined ? {} : { poolId })
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: TinymanAddLiquidityAndFarmFlexibleInput
  ): Promise<TinymanAddLiquidityAndFarmState> {
    const dependencies = resolveDependencies();
    const { asset1Id, asset2Id } = orderTinymanAssets(input.assetAId, input.assetBId);
    const poolState = await dependencies.resolvePoolState({
      network: context.network,
      algod: context.algod,
      asset1Id,
      asset2Id
    });
    const resolvedFarmProgram =
      input.programId !== undefined && input.programAccount !== undefined
        ? {
            programId: input.programId,
            programAccount: input.programAccount,
            ...(input.requiredAssetId === undefined ? {} : { requiredAssetId: input.requiredAssetId })
          }
        : await dependencies.resolveFarmProgram({
            network: context.network,
            liquidityAssetId: poolState.poolTokenId,
            poolAddress: poolState.poolAddress,
            assetAId: input.assetAId,
            assetBId: input.assetBId
          });
    const farmProgram = {
      ...resolvedFarmProgram,
      ...(input.requiredAssetId === undefined ? {} : { requiredAssetId: input.requiredAssetId })
    };
    return {
      ...poolState,
      stakingAppId: dependencies.getStakingAppId(context.network),
      farmProgram
    };
  },

  async build(
    context: ShapeBuildContext,
    input: TinymanAddLiquidityAndFarmFlexibleInput,
    state: TinymanAddLiquidityAndFarmState
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

    const minPoolTokenOut = quote.minPoolTokenAssetAmountWithSlippage;
    const commitAmount = input.commitAmount ?? minPoolTokenOut;

    let addSignerTxns: SignerTransaction[];
    try {
      addSignerTxns = await dependencies.generateFlexibleTxns({
        client: context.algod,
        network: context.network,
        poolAddress: state.poolAddress,
        asset1In: { id: state.asset1Id, amount: asset1Amount },
        asset2In: { id: state.asset2Id, amount: asset2Amount },
        poolTokenOut: { id: state.poolTokenId, amount: quote.poolTokenOut.amount },
        initiatorAddr: input.userAddress,
        minPoolTokenAssetAmount: minPoolTokenOut
      });
    } catch (error) {
      throw new ShapeBuildError(
        "Failed to generate Tinyman flexible add-liquidity transactions.",
        { cause: error }
      );
    }

    let commitSignerTxns: SignerTransaction[];
    try {
      commitSignerTxns = await dependencies.prepareCommitTransactions({
        client: context.algod,
        stakingAppID: state.stakingAppId,
        program: {
          accountAddress: state.farmProgram.programAccount,
          id: state.farmProgram.programId
        },
        liquidityAssetID: state.poolTokenId,
        amount: commitAmount,
        initiatorAddr: input.userAddress,
        ...(state.farmProgram.requiredAssetId === undefined
          ? {}
          : { requiredAssetID: state.farmProgram.requiredAssetId })
      });
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Tinyman farm commit transactions.", {
        cause: error
      });
    }

    let combined: SignerTransaction[];
    try {
      combined = dependencies.combineAndRegroupSignerTxns(addSignerTxns, commitSignerTxns);
    } catch (error) {
      throw new ShapeBuildError(
        "Failed to combine Tinyman add-liquidity and farm commit transactions.",
        { cause: error }
      );
    }

    const warnings: string[] = [];
    if (input.maxSlippageBps >= HIGH_SLIPPAGE_BPS) {
      warnings.push(
        `Tolerated slippage is high (${input.maxSlippageBps} bps); confirm this is intentional.`
      );
    }
    if (input.commitAmount !== undefined && input.commitAmount > quote.poolTokenOut.amount) {
      warnings.push(
        `Committed amount (${input.commitAmount.toString()}) exceeds the expected minted LP ` +
          `(${quote.poolTokenOut.amount.toString()}); commit only stays valid while the wallet ` +
          "holds at least the committed amount."
      );
    }

    return {
      transactions: normalizeTransactions(combined.map((signerTxn) => signerTxn.txn)),
      warnings,
      metadata: {
        poolAddress: state.poolAddress,
        poolTokenId: state.poolTokenId,
        asset1Id: state.asset1Id,
        asset2Id: state.asset2Id,
        asset1AmountIn: asset1Amount.toString(),
        asset2AmountIn: asset2Amount.toString(),
        expectedPoolTokenOut: quote.poolTokenOut.amount.toString(),
        minPoolTokenOut: minPoolTokenOut.toString(),
        poolShare: quote.share,
        slippageBps: input.maxSlippageBps,
        stakingAppId: state.stakingAppId,
        programId: state.farmProgram.programId,
        programAccount: state.farmProgram.programAccount,
        committedAmount: commitAmount.toString(),
        commitAmountDefaulted: input.commitAmount === undefined,
        includesLogBalance: state.farmProgram.requiredAssetId !== undefined,
        ...(state.farmProgram.requiredAssetId === undefined
          ? {}
          : { requiredAssetId: state.farmProgram.requiredAssetId }),
        ...(input.poolId === undefined ? {} : { poolId: input.poolId })
      }
    };
  },

  validate(
    group,
    input: TinymanAddLiquidityAndFarmFlexibleInput,
    state: TinymanAddLiquidityAndFarmState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const commitCount = state.farmProgram.requiredAssetId === undefined ? 1 : 2;
    const expectedCount = ADD_LIQUIDITY_TXN_COUNT + commitCount;

    if (group.length !== expectedCount) {
      errors.push(`Expected exactly ${expectedCount} transactions, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    const addResult = tinymanAddLiquidityFlexibleShape.validate(
      group.slice(0, ADD_LIQUIDITY_TXN_COUNT),
      input,
      state
    );
    errors.push(...addResult.errors);
    warnings.push(...addResult.warnings);

    validateFarmCommitTransactions({
      group: group.slice(ADD_LIQUIDITY_TXN_COUNT),
      userAddress: input.userAddress,
      stakingAppId: state.stakingAppId,
      liquidityAssetId: state.poolTokenId,
      programAccount: state.farmProgram.programAccount,
      ...(state.farmProgram.requiredAssetId === undefined
        ? {}
        : { requiredAssetId: state.farmProgram.requiredAssetId }),
      errors
    });

    if (group.some((txn) => !txn.groupPresent)) {
      errors.push("All transactions must belong to a single atomic group.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};

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
