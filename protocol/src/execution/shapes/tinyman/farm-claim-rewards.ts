import algosdk, { Transaction } from "algosdk";
import { getStakingAppID } from "@tinymanorg/tinyman-js-sdk";

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
  parseFarmAddress,
  parseOptionalPoolId,
  parseProgramId
} from "./farm-state.js";

const MIN_ALGO_FEE = 1000n;

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "tinyman",
  protocolVersion: "staking-v1",
  action: "farm",
  variant: "claimRewards"
};

export interface TinymanFarmClaimRewardsInput {
  userAddress: string;
  programId: number;
  poolAddress: string;
}

export interface TinymanFarmClaimRewardsState {
  network: "mainnet";
  stakingAppId: number;
  programId: number;
  poolAddress: string;
  userAddress: string;
}

interface PrepareClaimResponse {
  transactions?: string[];
}

export interface TinymanFarmClaimRewardsDependencies {
  getStakingAppId: (network: "mainnet") => number;
  prepareClaimTransactions: (params: {
    fetchImpl: typeof fetch;
    programId: number;
    poolAddress: string;
    poolerAddress: string;
  }) => Promise<Transaction[]>;
}

let dependencyOverrides: Partial<TinymanFarmClaimRewardsDependencies> | undefined;

export function setTinymanFarmClaimRewardsDependenciesForTests(
  overrides?: Partial<TinymanFarmClaimRewardsDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): TinymanFarmClaimRewardsDependencies {
  return {
    getStakingAppId: (network) => getStakingAppID(network),
    prepareClaimTransactions: defaultPrepareClaimTransactions,
    ...dependencyOverrides
  };
}

export const tinymanFarmClaimRewardsShape: TransactionShapeSpec<
  TinymanFarmClaimRewardsInput,
  TinymanFarmClaimRewardsState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Tinyman farm claim pending rewards",
  description:
    "Claims unpaid Tinyman farm rewards for a staking program. Transaction bytes are prepared by " +
    "the Tinyman Analytics API (`POST /staking/rewards/prepare-claim-transactions/`); Canix " +
    "normalizes and validates the unsigned group for local signing. Does not call the Analytics " +
    "submit endpoint.",
  supportedOpportunityTypes: ["farm"],
  opportunityRole: "manage",
  requiredInputs: ["userAddress", "programId", "poolAddress"],
  sources: [
    {
      kind: "api",
      description:
        "Tinyman Analytics POST /api/v1/staking/rewards/prepare-claim-transactions/"
    }
  ],

  parseInput(raw: unknown): TinymanFarmClaimRewardsInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    const poolAddress = parseOptionalPoolId(value.poolAddress ?? value.poolId);
    if (poolAddress === undefined) {
      throw new InvalidShapeInputError("poolAddress is required.");
    }
    return {
      userAddress: parseFarmAddress(value.userAddress),
      programId: parseProgramId(value.programId),
      poolAddress
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: TinymanFarmClaimRewardsInput
  ): Promise<TinymanFarmClaimRewardsState> {
    if (context.network !== "mainnet") {
      throw new ShapeStateError("Tinyman farm claim is only supported on mainnet.", {
        details: { network: context.network }
      });
    }
    return {
      network: "mainnet",
      stakingAppId: resolveDependencies().getStakingAppId("mainnet"),
      programId: input.programId,
      poolAddress: input.poolAddress,
      userAddress: input.userAddress
    };
  },

  async build(
    context: ShapeBuildContext,
    input: TinymanFarmClaimRewardsInput,
    state: TinymanFarmClaimRewardsState
  ): Promise<ShapeBuildResult> {
    void context;
    const dependencies = resolveDependencies();
    let transactions: Transaction[];
    try {
      transactions = await dependencies.prepareClaimTransactions({
        fetchImpl: globalThis.fetch,
        programId: state.programId,
        poolAddress: state.poolAddress,
        poolerAddress: input.userAddress
      });
    } catch (error) {
      throw new ShapeBuildError(
        "Failed to prepare Tinyman farm claim transactions from Analytics API.",
        { cause: error }
      );
    }

    if (transactions.length === 0) {
      throw new ShapeBuildError(
        "Tinyman Analytics returned an empty claim transaction group."
      );
    }

    return {
      transactions: normalizeTransactions(transactions),
      warnings: [
        "Claim group prepared by Tinyman Analytics; verify app calls and amounts before signing."
      ],
      metadata: {
        stakingAppId: state.stakingAppId,
        programId: state.programId,
        poolAddress: state.poolAddress,
        transactionCount: transactions.length
      }
    };
  },

  validate(
    group,
    input: TinymanFarmClaimRewardsInput,
    state: TinymanFarmClaimRewardsState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (group.length === 0) {
      errors.push("Claim group must include at least one transaction.");
      return { valid: false, errors, warnings };
    }

    const hasStakingCall = group.some((txn) => {
      if (txn.type !== "appl" || !txn.applicationCall) {
        return false;
      }
      return txn.applicationCall.appIndex === String(state.stakingAppId);
    });
    if (!hasStakingCall) {
      errors.push(
        `Claim group must include a call to the Tinyman staking app (${state.stakingAppId}).`
      );
    }

    for (const txn of group) {
      if (txn.sender !== input.userAddress && txn.type === "appl") {
        // Analytics may include fee-payer or other members; warn rather than hard-fail.
        warnings.push(
          `Application call sender ${txn.sender} differs from userAddress; confirm before signing.`
        );
      }
      if (BigInt(txn.fee) < MIN_ALGO_FEE) {
        errors.push(`Transaction fee must be at least ${MIN_ALGO_FEE.toString()} microAlgos.`);
      }
    }

    if (group.length > 1 && group.some((txn) => !txn.groupPresent)) {
      errors.push("Multi-transaction claim groups must be atomically grouped.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};

async function defaultPrepareClaimTransactions(params: {
  fetchImpl: typeof fetch;
  programId: number;
  poolAddress: string;
  poolerAddress: string;
}): Promise<Transaction[]> {
  const baseUrl =
    process.env.TINYMAN_API_BASE_URL ?? "https://mainnet.analytics.tinyman.org/api/v1";
  const apiKey = process.env.TINYMAN_API_KEY;
  const requestUrl = `${trimTrailingSlash(baseUrl)}/staking/rewards/prepare-claim-transactions/`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json"
  };
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  const response = await params.fetchImpl(requestUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      program_id: params.programId,
      pool_address: params.poolAddress,
      pooler_address: params.poolerAddress
    })
  });

  if (!response.ok) {
    throw new ShapeBuildError(
      `Tinyman Analytics prepare-claim returned HTTP ${response.status}.`
    );
  }

  const payload = (await response.json()) as PrepareClaimResponse;
  const encoded = payload.transactions ?? [];
  if (encoded.length === 0) {
    throw new ShapeBuildError("Tinyman Analytics prepare-claim returned no transactions.");
  }

  return encoded.map((entry) => {
    try {
      return algosdk.decodeUnsignedTransaction(Buffer.from(entry, "base64"));
    } catch (error) {
      throw new ShapeBuildError(
        "Tinyman Analytics returned a transaction that could not be decoded.",
        { cause: error }
      );
    }
  });
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
