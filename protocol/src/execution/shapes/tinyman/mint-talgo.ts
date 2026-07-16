import { Algodv2, Transaction } from "algosdk";
import { TinymanTAlgoClient } from "@tinymanorg/tinyman-js-sdk";

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
  MINT_APP_ARG,
  TinymanLiquidStakeState,
  assertAllGrouped,
  expectedTAlgoFromMint,
  findAppCallByArg,
  parseLiquidStakeAddress,
  parseLiquidStakeAmount,
  resolveTinymanLiquidStakeState
} from "./liquid-stake-state.js";

const MIN_ALGO_FEE = 1000n;

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "tinyman",
  protocolVersion: "liquid-stake-v1",
  action: "mint",
  variant: "tAlgo"
};

export interface TinymanMintTAlgoInput {
  userAddress: string;
  amount: bigint;
}

export interface TinymanMintTAlgoDependencies {
  resolveState: typeof resolveTinymanLiquidStakeState;
  mint: (params: {
    algod: Algodv2;
    network: ShapeBuildContext["network"];
    amount: bigint;
    userAddress: string;
  }) => Promise<Transaction[]>;
}

let dependencyOverrides: Partial<TinymanMintTAlgoDependencies> | undefined;

export function setTinymanMintTAlgoDependenciesForTests(
  overrides?: Partial<TinymanMintTAlgoDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): TinymanMintTAlgoDependencies {
  return {
    resolveState: resolveTinymanLiquidStakeState,
    mint: async ({ algod, network, amount, userAddress }) => {
      const client = new TinymanTAlgoClient(algod, network);
      return client.mint(amount, userAddress);
    },
    ...dependencyOverrides
  };
}

export const tinymanMintTAlgoShape: TransactionShapeSpec<
  TinymanMintTAlgoInput,
  TinymanLiquidStakeState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Tinyman liquid stake mint tALGO",
  description:
    "Stakes ALGO into Tinyman's liquid-staking app and mints tALGO. Builds the SDK mint " +
    "group (optional tALGO opt-in, ALGO payment, mint app call) as unsigned transactions.",
  supportedOpportunityTypes: ["staking"],
  requiredInputs: ["userAddress", "amount"],
  sources: [
    {
      kind: "sdk",
      description: "@tinymanorg/tinyman-js-sdk TinymanTAlgoClient.mint"
    }
  ],

  parseInput(raw: unknown): TinymanMintTAlgoInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    return {
      userAddress: parseLiquidStakeAddress(value.userAddress),
      amount: parseLiquidStakeAmount(value.amount)
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: TinymanMintTAlgoInput
  ): Promise<TinymanLiquidStakeState> {
    return resolveDependencies().resolveState({
      network: context.network,
      algod: context.algod,
      userAddress: input.userAddress
    });
  },

  async build(
    context: ShapeBuildContext,
    input: TinymanMintTAlgoInput,
    state: TinymanLiquidStakeState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings: string[] = [];

    if (input.amount > state.userAlgoBalance) {
      warnings.push(
        `Requested mint amount (${input.amount.toString()}) exceeds current wallet ALGO balance ` +
          `(${state.userAlgoBalance.toString()}).`
      );
    }

    let transactions: Transaction[];
    try {
      transactions = await dependencies.mint({
        algod: context.algod,
        network: context.network,
        amount: input.amount,
        userAddress: input.userAddress
      });
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Tinyman tALGO mint transactions.", {
        cause: error
      });
    }

    const expectedTAlgoOut = expectedTAlgoFromMint(input.amount, state.algoToTAlgoRatio);

    return {
      transactions: normalizeTransactions(transactions),
      warnings,
      metadata: {
        stakeAppId: state.stakeAppId,
        stakeAppAddress: state.stakeAppAddress,
        tAlgoAssetId: state.tAlgoAssetId,
        amountIn: input.amount.toString(),
        expectedTAlgoOut: expectedTAlgoOut.toString(),
        algoToTAlgoRatio: state.algoToTAlgoRatio,
        includesOptIn: state.needsTAlgoOptIn
      }
    };
  },

  validate(
    group,
    input: TinymanMintTAlgoInput,
    state: TinymanLiquidStakeState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const minCount = state.needsTAlgoOptIn ? 3 : 2;
    if (group.length < minCount) {
      errors.push(`Expected at least ${minCount} transactions, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    const mintTxn = findAppCallByArg(group, MINT_APP_ARG);
    if (mintTxn === undefined || !mintTxn.applicationCall) {
      errors.push(`Group must include a "${MINT_APP_ARG}" application call.`);
    } else {
      if (mintTxn.sender !== input.userAddress) {
        errors.push("Mint sender must be the user address.");
      }
      if (mintTxn.applicationCall.appIndex !== String(state.stakeAppId)) {
        errors.push(`Mint must call the Tinyman stake app (${state.stakeAppId}).`);
      }
      if (!mintTxn.applicationCall.foreignAssets.includes(String(state.tAlgoAssetId))) {
        errors.push("Mint foreign assets must include the tALGO asset id.");
      }
      if (BigInt(mintTxn.fee) < MIN_ALGO_FEE) {
        errors.push(`Mint fee must be at least ${MIN_ALGO_FEE.toString()} microAlgos.`);
      }
    }

    const payment = group.find(
      (txn) =>
        txn.type === "pay" &&
        txn.payment?.receiver === state.stakeAppAddress &&
        txn.payment.amount === input.amount.toString()
    );
    if (payment === undefined) {
      errors.push("Group must include an ALGO payment to the stake app for the mint amount.");
    } else if (payment.sender !== input.userAddress) {
      errors.push("Mint payment sender must be the user address.");
    }

    assertAllGrouped(group, errors);

    if (input.amount > state.userAlgoBalance) {
      warnings.push("Mint amount exceeds the current wallet ALGO balance.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};
