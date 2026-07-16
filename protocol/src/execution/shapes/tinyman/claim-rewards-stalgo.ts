import { Algodv2, Transaction } from "algosdk";
import { TinymanSTAlgoClient } from "@tinymanorg/tinyman-js-sdk";

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
  CLAIM_REWARDS_APP_ARG,
  TinymanLiquidStakeState,
  assertAllGrouped,
  findAppCallByArg,
  parseLiquidStakeAddress,
  resolveTinymanLiquidStakeState
} from "./liquid-stake-state.js";

const MIN_ALGO_FEE = 1000n;

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "tinyman",
  protocolVersion: "restake-v1",
  action: "claimRewards",
  variant: "stAlgo"
};

export interface TinymanClaimRewardsStAlgoInput {
  userAddress: string;
}

export interface TinymanClaimRewardsStAlgoDependencies {
  resolveState: typeof resolveTinymanLiquidStakeState;
  claimRewards: (params: {
    algod: Algodv2;
    network: ShapeBuildContext["network"];
    userAddress: string;
  }) => Promise<Transaction[]>;
}

let dependencyOverrides: Partial<TinymanClaimRewardsStAlgoDependencies> | undefined;

export function setTinymanClaimRewardsStAlgoDependenciesForTests(
  overrides?: Partial<TinymanClaimRewardsStAlgoDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): TinymanClaimRewardsStAlgoDependencies {
  return {
    resolveState: resolveTinymanLiquidStakeState,
    claimRewards: async ({ algod, network, userAddress }) => {
      const client = new TinymanSTAlgoClient(algod, network);
      return client.claimRewards(userAddress);
    },
    ...dependencyOverrides
  };
}

export const tinymanClaimRewardsStAlgoShape: TransactionShapeSpec<
  TinymanClaimRewardsStAlgoInput,
  TinymanLiquidStakeState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Tinyman restake claim TINY rewards",
  description:
    "Claims accrued TINY rewards from Tinyman's tALGO restaking app. Builds the SDK " +
    "claimRewards group (optional rate-change / TINY opt-in, claim_rewards app call) as " +
    "unsigned transactions.",
  supportedOpportunityTypes: ["staking"],
  requiredInputs: ["userAddress"],
  sources: [
    {
      kind: "sdk",
      description: "@tinymanorg/tinyman-js-sdk TinymanSTAlgoClient.claimRewards"
    }
  ],

  parseInput(raw: unknown): TinymanClaimRewardsStAlgoInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    return {
      userAddress: parseLiquidStakeAddress(value.userAddress)
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: TinymanClaimRewardsStAlgoInput
  ): Promise<TinymanLiquidStakeState> {
    return resolveDependencies().resolveState({
      network: context.network,
      algod: context.algod,
      userAddress: input.userAddress
    });
  },

  async build(
    context: ShapeBuildContext,
    input: TinymanClaimRewardsStAlgoInput,
    state: TinymanLiquidStakeState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();

    let transactions: Transaction[];
    try {
      transactions = await dependencies.claimRewards({
        algod: context.algod,
        network: context.network,
        userAddress: input.userAddress
      });
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Tinyman stALGO claim-rewards transactions.", {
        cause: error
      });
    }

    return {
      transactions: normalizeTransactions(transactions),
      warnings: [],
      metadata: {
        restakeAppId: state.restakeAppId,
        restakeAppAddress: state.restakeAppAddress,
        vaultAppId: state.vaultAppId,
        tinyAssetId: state.tinyAssetId,
        includesApplyRateChange: state.needsApplyRateChange,
        includesTinyOptIn: state.needsTinyOptIn
      }
    };
  },

  validate(
    group,
    input: TinymanClaimRewardsStAlgoInput,
    state: TinymanLiquidStakeState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const minCount = 1 + Number(state.needsApplyRateChange) + Number(state.needsTinyOptIn);
    if (group.length < minCount) {
      errors.push(`Expected at least ${minCount} transactions, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    const appTxn = findAppCallByArg(group, CLAIM_REWARDS_APP_ARG);
    if (appTxn === undefined || !appTxn.applicationCall) {
      errors.push(`Group must include a "${CLAIM_REWARDS_APP_ARG}" application call.`);
    } else {
      if (appTxn.sender !== input.userAddress) {
        errors.push("claim_rewards sender must be the user address.");
      }
      if (appTxn.applicationCall.appIndex !== String(state.restakeAppId)) {
        errors.push(`claim_rewards must call the Tinyman restake app (${state.restakeAppId}).`);
      }
      if (!appTxn.applicationCall.foreignAssets.includes(String(state.tinyAssetId))) {
        errors.push("claim_rewards foreign assets must include the TINY asset id.");
      }
      if (!appTxn.applicationCall.foreignApps.includes(String(state.vaultAppId))) {
        errors.push("claim_rewards foreign apps must include the Tinyman vault app.");
      }
      if (BigInt(appTxn.fee) < MIN_ALGO_FEE) {
        errors.push(
          `claim_rewards fee must be at least ${MIN_ALGO_FEE.toString()} microAlgos.`
        );
      }
    }

    assertAllGrouped(group, errors);

    return { valid: errors.length === 0, errors, warnings };
  }
};
