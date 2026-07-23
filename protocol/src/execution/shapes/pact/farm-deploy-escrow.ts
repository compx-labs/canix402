import algosdk, { Algodv2 } from "algosdk";
import type { Farm } from "@pactfi/pactsdk";

import { InvalidShapeInputError, ShapeBuildError, ShapeStateError } from "../../errors.js";
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
  PactFarmState,
  parseAddress,
  parseOptionalPoolId,
  resolveFarmAppIdFromInput,
  resolvePactFarmState
} from "./farm-state.js";
import { createPactBuilderAlgodClient, normalizeSuggestedParamsForPact } from "./pool-state.js";

const MIN_ALGO_FEE = 1000n;
/** Gas-station fund payment that bootstraps escrow creation. */
const DEPLOY_FUND_AMOUNT = 200_000n;

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "pact",
  protocolVersion: "v1",
  action: "farm",
  variant: "deployEscrow"
};

export interface PactFarmDeployEscrowInput {
  userAddress: string;
  farmAppId: number;
  poolId?: string;
}

export interface PactFarmDeployEscrowDependencies {
  resolveFarmState: typeof resolvePactFarmState;
  prepareDeployEscrowTxs: (
    farm: Farm,
    sender: string
  ) => Promise<algosdk.Transaction[]>;
  getSuggestedParams: (algod: Algodv2) => Promise<algosdk.SuggestedParams>;
}

let dependencyOverrides: Partial<PactFarmDeployEscrowDependencies> | undefined;

export function setPactFarmDeployEscrowDependenciesForTests(
  overrides?: Partial<PactFarmDeployEscrowDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): PactFarmDeployEscrowDependencies {
  return {
    resolveFarmState: resolvePactFarmState,
    prepareDeployEscrowTxs: async (farm, sender) =>
      (await farm.prepareDeployEscrowTxs(sender)) as unknown as algosdk.Transaction[],
    getSuggestedParams: async () => createPactBuilderAlgodClient().getTransactionParams().do(),
    ...dependencyOverrides
  };
}

export const pactFarmDeployEscrowShape: TransactionShapeSpec<
  PactFarmDeployEscrowInput,
  PactFarmState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Pact farm deploy escrow (first-time setup)",
  description:
    "Deploys a per-user Pact Micro Farming escrow application for a farm and opts the " +
    "wallet into the farm app. Escrow creation must confirm before staking; the escrow " +
    "app id is unknown until this group confirms, so stake cannot be atomic with deploy.",
  supportedOpportunityTypes: ["farm"],
  opportunityRole: "enter",
  requiredInputs: ["userAddress", "farmAppId"],
  sources: [
    {
      kind: "sdk",
      description: "@pactfi/pactsdk Farm.prepareDeployEscrowTxs / buildDeployEscrowTxs"
    },
    {
      kind: "docs",
      description: "Pact Micro Farming escrow pattern",
      url: "https://pactfi.github.io/pact-js-sdk/latest/classes/Farm.html"
    }
  ],

  parseInput(raw: unknown): PactFarmDeployEscrowInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    const poolId = parseOptionalPoolId(value.poolId);
    return {
      userAddress: parseAddress(value.userAddress),
      farmAppId: resolveFarmAppIdFromInput(value),
      ...(poolId === undefined ? {} : { poolId })
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: PactFarmDeployEscrowInput
  ): Promise<PactFarmState> {
    const dependencies = resolveDependencies();
    return dependencies.resolveFarmState({
      network: context.network,
      algod: context.algod,
      userAddress: input.userAddress,
      farmAppId: input.farmAppId
    });
  },

  async build(
    context: ShapeBuildContext,
    input: PactFarmDeployEscrowInput,
    state: PactFarmState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();

    if (state.hasEscrow) {
      throw new ShapeStateError(
        "User already has a Pact farm escrow for this farm; skip deployEscrow and call farm:stake.",
        {
          details: {
            farmAppId: state.farmAppId,
            escrowAppId: state.escrowAppId,
            escrowAddress: state.escrowAddress
          }
        }
      );
    }

    const suggestedParams = normalizeSuggestedParamsForPact(
      await dependencies.getSuggestedParams(createPactBuilderAlgodClient())
    );
    state.farm.setSuggestedParams(suggestedParams as never);

    let rawTxns: algosdk.Transaction[];
    try {
      rawTxns = await dependencies.prepareDeployEscrowTxs(
        state.farm,
        input.userAddress
      );
      algosdk.assignGroupID(rawTxns);
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Pact farm deploy-escrow transactions.", {
        cause: error
      });
    }

    return {
      transactions: normalizeTransactions(rawTxns),
      warnings: [
        "After this group confirms, re-quote mainnet:pact:v1:farm:stake (or addLiquidityAndFarm) — the escrow app id is only known post-confirm."
      ],
      metadata: {
        farmAppId: state.farmAppId,
        stakedAssetId: state.stakedAssetId,
        rewardAssetIds: state.rewardAssetIds,
        nextShapeKey: "mainnet:pact:v1:farm:stake",
        ...(input.poolId === undefined ? {} : { poolId: input.poolId })
      }
    };
  },

  validate(
    group,
    input: PactFarmDeployEscrowInput,
    state: PactFarmState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (group.length !== 3) {
      errors.push(`Expected exactly 3 transactions, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    const [fundTxn, createTxn, optInTxn] = group;

    if (fundTxn === undefined || fundTxn.type !== "pay" || !fundTxn.payment) {
      errors.push("Transaction 1 must be the gas-station fund payment.");
    } else {
      if (fundTxn.sender !== input.userAddress) {
        errors.push("Transaction 1 sender must be the user address.");
      }
      if (fundTxn.payment.amount !== DEPLOY_FUND_AMOUNT.toString()) {
        warnings.push(
          `Transaction 1 fund amount is ${fundTxn.payment.amount}; Pact currently funds ${DEPLOY_FUND_AMOUNT.toString()} microAlgos.`
        );
      }
    }

    if (createTxn === undefined || createTxn.type !== "appl" || !createTxn.applicationCall) {
      errors.push("Transaction 2 must be the escrow application-create call.");
    } else {
      if (createTxn.sender !== input.userAddress) {
        errors.push("Transaction 2 sender must be the user address.");
      }
      if (createTxn.applicationCall.onComplete !== algosdk.OnApplicationComplete.NoOpOC) {
        errors.push("Transaction 2 on-completion must be NoOp (application create).");
      }
      if (createTxn.applicationCall.appIndex !== "0") {
        warnings.push(
          `Transaction 2 app index is ${createTxn.applicationCall.appIndex}; create txs usually use 0.`
        );
      }
      if (!createTxn.applicationCall.foreignApps.includes(String(state.farmAppId))) {
        errors.push("Transaction 2 foreign apps must include the farm app id.");
      }
      if (!createTxn.applicationCall.foreignAssets.includes(String(state.stakedAssetId))) {
        errors.push("Transaction 2 foreign assets must include the staked LP asset id.");
      }
      if (BigInt(createTxn.fee) < MIN_ALGO_FEE) {
        errors.push(`Transaction 2 fee must be at least ${MIN_ALGO_FEE.toString()} microAlgos.`);
      }
    }

    if (optInTxn === undefined || optInTxn.type !== "appl" || !optInTxn.applicationCall) {
      errors.push("Transaction 3 must be the farm application opt-in.");
    } else {
      if (optInTxn.sender !== input.userAddress) {
        errors.push("Transaction 3 sender must be the user address.");
      }
      if (optInTxn.applicationCall.appIndex !== String(state.farmAppId)) {
        errors.push(
          `Transaction 3 must opt into farm app ${state.farmAppId}, got ${optInTxn.applicationCall.appIndex}.`
        );
      }
      if (optInTxn.applicationCall.onComplete !== algosdk.OnApplicationComplete.OptInOC) {
        errors.push("Transaction 3 on-completion must be OptIn.");
      }
    }

    if (group.some((txn) => !txn.groupPresent)) {
      errors.push("All transactions must belong to a single atomic group.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};
