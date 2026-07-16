import { Algodv2 } from "algosdk";
import {
  AddLiquidity,
  combineAndRegroupSignerTxns,
  getStakingAppID,
  prepareCommitTransactions
} from "@tinymanorg/tinyman-js-sdk";
import type {
  SignerTransaction,
  V2PoolInfo,
  V2SingleAssetInAddLiquidityQuote
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
import { tinymanAddLiquiditySingleAssetShape } from "./add-liquidity-single-asset.js";
import { validateFarmCommitTransactions } from "./farm-commit.js";
import { TinymanAddLiquidityAndFarmState } from "./add-liquidity-and-farm-flexible.js";
import {
  parseFarmAddress,
  parseAssetId,
  parseBaseUnitAmount,
  parseOptionalAssetId,
  parseOptionalBaseUnitAmount,
  parseOptionalPoolId,
  parseOptionalProgramAccount,
  parseOptionalProgramId,
  resolveTinymanFarmProgram
} from "./farm-state.js";

const MAX_SLIPPAGE_BPS = 10_000;
const HIGH_SLIPPAGE_BPS = 500;
/** Single-asset add-liquidity produces 2 transactions; commit adds 1 (+1 with a required asset). */
const ADD_LIQUIDITY_TXN_COUNT = 2;

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "tinyman",
  protocolVersion: "v2",
  action: "addLiquidityAndFarm",
  variant: "singleAsset"
};

export interface TinymanAddLiquidityAndFarmSingleAssetInput {
  userAddress: string;
  assetAId: number;
  assetBId: number;
  depositAssetId: number;
  depositAmount: bigint;
  maxSlippageBps: number;
  programId?: number;
  programAccount?: string;
  /** LP amount to commit. Defaults to the guaranteed minimum pool tokens from the add quote. */
  commitAmount?: bigint;
  requiredAssetId?: number;
  poolId?: string;
}

export interface TinymanAddLiquidityAndFarmSingleAssetDependencies {
  resolvePoolState: (params: {
    network: ShapeBuildContext["network"];
    algod: Algodv2;
    asset1Id: number;
    asset2Id: number;
  }) => Promise<TinymanV2PoolState>;
  getStakingAppId: (network: ShapeBuildContext["network"]) => number;
  resolveFarmProgram: typeof resolveTinymanFarmProgram;
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
  | Partial<TinymanAddLiquidityAndFarmSingleAssetDependencies>
  | undefined;

export function setTinymanAddLiquidityAndFarmSingleAssetDependenciesForTests(
  overrides?: Partial<TinymanAddLiquidityAndFarmSingleAssetDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): TinymanAddLiquidityAndFarmSingleAssetDependencies {
  return {
    resolvePoolState: resolveTinymanV2PoolState,
    getStakingAppId: (network) => getStakingAppID(network),
    resolveFarmProgram: resolveTinymanFarmProgram,
    getSingleAssetQuote: (params) => AddLiquidity.v2.withSingleAsset.getQuote(params),
    generateSingleAssetTxns: (params) => AddLiquidity.v2.withSingleAsset.generateTxns(params),
    prepareCommitTransactions: (params) => prepareCommitTransactions(params),
    combineAndRegroupSignerTxns: (...groups) => combineAndRegroupSignerTxns(...groups),
    ...dependencyOverrides
  };
}

export const tinymanAddLiquidityAndFarmSingleAssetShape: TransactionShapeSpec<
  TinymanAddLiquidityAndFarmSingleAssetInput,
  TinymanAddLiquidityAndFarmState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Tinyman v2 single-asset add liquidity and farm commit",
  description:
    "Adds one-sided liquidity to a Tinyman AMM v2 pool and, in the same atomic group, commits " +
    "the newly minted LP position to a Tinyman farm. LP tokens never leave the wallet; the farm " +
    "commit is a staking app call. Returns the combined, regrouped unsigned transaction group.",
  supportedOpportunityTypes: ["farm"],
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
        "@tinymanorg/tinyman-js-sdk AddLiquidity.v2.withSingleAsset + prepareCommitTransactions + combineAndRegroupSignerTxns"
    },
    {
      kind: "docs",
      description: "Tinyman v2 integration: add subsequent liquidity (single asset)",
      url: "https://docs.tinyman.org/v2-integration/protocol-methods/add-subsequent-liquidity"
    }
  ],

  parseInput(raw: unknown): TinymanAddLiquidityAndFarmSingleAssetInput {
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
    const depositAssetId = parseAssetId(value.depositAssetId, "depositAssetId");
    if (depositAssetId !== assetAId && depositAssetId !== assetBId) {
      throw new InvalidShapeInputError(
        "depositAssetId must match assetAId or assetBId for the pool pair.",
        { depositAssetId, assetAId, assetBId }
      );
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
      assetBId,
      depositAssetId,
      depositAmount: parseBaseUnitAmount(value.depositAmount, "depositAmount"),
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
    input: TinymanAddLiquidityAndFarmSingleAssetInput
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
    input: TinymanAddLiquidityAndFarmSingleAssetInput,
    state: TinymanAddLiquidityAndFarmState
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

    const minPoolTokenOut = quote.minPoolTokenAssetAmountWithSlippage;
    const commitAmount = input.commitAmount ?? minPoolTokenOut;

    let addSignerTxns: SignerTransaction[];
    try {
      addSignerTxns = await dependencies.generateSingleAssetTxns({
        client: context.algod,
        network: context.network,
        poolAddress: state.poolAddress,
        assetIn: { id: input.depositAssetId, amount: input.depositAmount },
        poolTokenId: state.poolTokenId,
        initiatorAddr: input.userAddress,
        minPoolTokenAssetAmount: minPoolTokenOut
      });
    } catch (error) {
      throw new ShapeBuildError(
        "Failed to generate Tinyman single-asset add-liquidity transactions.",
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
        depositAssetId: input.depositAssetId,
        depositAmount: input.depositAmount.toString(),
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
    input: TinymanAddLiquidityAndFarmSingleAssetInput,
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

    const addResult = tinymanAddLiquiditySingleAssetShape.validate(
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
