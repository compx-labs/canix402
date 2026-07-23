import algosdk, { Algodv2 } from "algosdk";
import {
  Escrow,
  Farm,
  PactClient,
  fetchEscrowById,
  fetchFarmById
} from "@pactfi/pactsdk";

import { InvalidShapeInputError, ShapeStateError } from "../../errors.js";
import type { ExecutionNetwork } from "../../types.js";
import { parseAddress, parseAssetId, parseBaseUnitAmount } from "./parse-input.js";
import {
  addressToStringForPact,
  createPactBuilderAlgodClient,
  createPactCompatibleAlgodClient,
  normalizeSuggestedParamsForPact
} from "./pool-state.js";

/**
 * Resolved on-chain context for Pact Micro Farming. Staked LP tokens leave the
 * wallet and are held in a per-user escrow application bound to one farm.
 */
export interface PactFarmState {
  network: ExecutionNetwork;
  farmAppId: number;
  stakedAssetId: number;
  rewardAssetIds: number[];
  /** Current farm-local staked amount (base units). Zero when no escrow/opt-in. */
  userStaked: bigint;
  /** Wallet balance of the farm's staked (LP) asset. */
  userLpBalance: bigint;
  escrowAppId: number | null;
  escrowAddress: string | null;
  hasEscrow: boolean;
  /** Raw SDK farm instance for builders. */
  farm: Farm;
  /** Raw SDK escrow instance when the user already has one for this farm. */
  escrow: Escrow | null;
}

export interface PactFarmStateDependencies {
  fetchFarmById: (algod: Algodv2, farmAppId: number) => Promise<Farm>;
  fetchEscrowById: (
    algod: Algodv2,
    escrowAppId: number,
    farm: Farm
  ) => Promise<Escrow>;
  fetchEscrowByAddress: (farm: Farm, userAddress: string) => Promise<Escrow | null>;
  getAccountAssetBalance: (
    algod: Algodv2,
    address: string,
    assetId: number
  ) => Promise<bigint>;
  getSuggestedParams: (algod: Algodv2) => Promise<algosdk.SuggestedParams>;
  ensureGasStation: (network: ExecutionNetwork, algod: Algodv2) => void;
}

let dependencyOverrides: Partial<PactFarmStateDependencies> | undefined;

export function setPactFarmStateDependenciesForTests(
  overrides?: Partial<PactFarmStateDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): PactFarmStateDependencies {
  return {
    fetchFarmById: defaultFetchFarmById,
    fetchEscrowById: defaultFetchEscrowById,
    fetchEscrowByAddress: defaultFetchEscrowByAddress,
    getAccountAssetBalance,
    getSuggestedParams: async (algod) => algod.getTransactionParams().do(),
    ensureGasStation: ensurePactGasStation,
    ...dependencyOverrides
  };
}

/**
 * Resolve farm + optional user escrow and wallet LP balance for stake/unstake/claim.
 */
export async function resolvePactFarmState(params: {
  network: ExecutionNetwork;
  algod: Algodv2;
  userAddress: string;
  farmAppId: number;
  escrowAppId?: number;
}): Promise<PactFarmState> {
  const dependencies = resolveDependencies();
  const { network, farmAppId } = params;
  const userAddress = addressToStringForPact(params.userAddress, "user");
  // Use Pact's nested algosdk client so application.creator (escrow userAddress)
  // is a plain string, not an algosdk v3 Address object.
  const pactAlgod = createPactCompatibleAlgodClient(createPactBuilderAlgodClient());

  dependencies.ensureGasStation(network, pactAlgod);

  let farm: Farm;
  try {
    farm = await dependencies.fetchFarmById(pactAlgod, farmAppId);
  } catch (error) {
    throw new ShapeStateError("Failed to fetch Pact farm by application id.", {
      details: { farmAppId, network },
      cause: error
    });
  }

  try {
    await farm.fetchAllAssets();
  } catch (error) {
    throw new ShapeStateError("Failed to fetch Pact farm staked/reward assets.", {
      details: { farmAppId },
      cause: error
    });
  }

  const suggestedParams = normalizeSuggestedParamsForPact(
    await dependencies.getSuggestedParams(pactAlgod)
  );
  farm.setSuggestedParams(suggestedParams as never);

  const stakedAssetId = farm.stakedAsset.index;
  const rewardAssetIds = farm.state.rewardAssets.map((asset) => asset.index);

  let escrow: Escrow | null = null;
  if (params.escrowAppId !== undefined) {
    try {
      escrow = await dependencies.fetchEscrowById(
        pactAlgod,
        params.escrowAppId,
        farm
      );
    } catch (error) {
      throw new ShapeStateError("Failed to fetch Pact farm escrow by application id.", {
        details: { farmAppId, escrowAppId: params.escrowAppId },
        cause: error
      });
    }
    const escrowCreator = addressToStringForPact(escrow.userAddress, "farmEscrow.userAddress");
    if (escrowCreator !== userAddress) {
      throw new ShapeStateError(
        "Provided escrowAppId was not created by the supplied userAddress.",
        {
          details: {
            escrowAppId: params.escrowAppId,
            escrowCreator,
            userAddress
          }
        }
      );
    }
  } else {
    try {
      escrow = await dependencies.fetchEscrowByAddress(farm, userAddress);
    } catch (error) {
      throw new ShapeStateError("Failed to resolve Pact farm escrow for the user.", {
        details: { farmAppId, userAddress },
        cause: error
      });
    }
  }

  if (escrow !== null) {
    // Pact builders read these fields into v2 decodeAddress; coerce any leftover
    // Address objects from mixed algosdk copies before buildStakeTxs / update.
    (escrow as { userAddress: string }).userAddress = addressToStringForPact(
      escrow.userAddress,
      "farmEscrow.userAddress"
    );
    (escrow as { address: string }).address = addressToStringForPact(
      escrow.address,
      "farmEscrow.address"
    );
    escrow.setSuggestedParams(suggestedParams as never);
  }

  const accountInfo = (await pactAlgod.accountInformation(userAddress).do()) as unknown as Record<
    string,
    unknown
  >;
  const appsLocalState = accountInfo["apps-local-state"];
  const userState = farm.getUserStateFromAccountInfo({
    ...accountInfo,
    "apps-local-state": Array.isArray(appsLocalState) ? appsLocalState : []
  });
  const userStaked =
    userState === null || userState === undefined
      ? 0n
      : BigInt(Math.trunc(userState.staked));

  const userLpBalance = await dependencies.getAccountAssetBalance(
    params.algod,
    userAddress,
    stakedAssetId
  );

  return {
    network,
    farmAppId: farm.appId,
    stakedAssetId,
    rewardAssetIds,
    userStaked,
    userLpBalance,
    escrowAppId: escrow?.appId ?? null,
    escrowAddress:
      escrow === null
        ? null
        : addressToStringForPact(escrow.address, "farmEscrow.address"),
    hasEscrow: escrow !== null,
    farm,
    escrow
  };
}

export async function getAccountAssetBalance(
  algod: Algodv2,
  address: string,
  assetId: number
): Promise<bigint> {
  const account = await algod.accountInformation(address).do();
  if (assetId === 0) {
    return BigInt(account.amount);
  }
  const holding = account.assets?.find((asset) => Number(asset.assetId) === assetId);
  return holding === undefined ? 0n : BigInt(holding.amount);
}

function ensurePactGasStation(network: ExecutionNetwork, algod: Algodv2): void {
  // PactClient constructor sets the process-wide gas station used by farm deploy/stake.
  new PactClient(algod as never, { network });
}

async function defaultFetchFarmById(algod: Algodv2, farmAppId: number): Promise<Farm> {
  return fetchFarmById(algod as never, farmAppId);
}

async function defaultFetchEscrowById(
  algod: Algodv2,
  escrowAppId: number,
  farm: Farm
): Promise<Escrow> {
  return fetchEscrowById(algod as never, escrowAppId, { farm });
}

async function defaultFetchEscrowByAddress(
  farm: Farm,
  userAddress: string
): Promise<Escrow | null> {
  return farm.fetchEscrowByAddress(userAddress);
}

// -- Shared farm input parsing --------------------------------------------

export function parseFarmAppId(value: unknown): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isInteger(numeric) || numeric <= 0) {
    throw new InvalidShapeInputError("farmAppId must be a positive integer application id.", {
      farmAppId: value
    });
  }
  return numeric;
}

/**
 * Resolve farm app id from `farmAppId`, or a numeric `poolId` fallback used by
 * older farm-only clients. Prefer `farmAppId` when both are present — composite
 * addLiquidityAndFarm shapes also carry a distinct AMM `poolAppId` / `poolId`.
 */
export function resolveFarmAppIdFromInput(value: Record<string, unknown>): number {
  if (value.farmAppId !== undefined) {
    return parseFarmAppId(value.farmAppId);
  }
  if (typeof value.poolId === "string" && /^\d+$/.test(value.poolId)) {
    return parseFarmAppId(value.poolId);
  }
  if (value.poolAppId !== undefined && value.farmAppId === undefined) {
    // Do not silently treat poolAppId as farmAppId for composite shapes that
    // also need the AMM pool; require an explicit farm selector.
  }
  throw new InvalidShapeInputError(
    "Provide farmAppId (or a numeric poolId from the farm opportunity id)."
  );
}

export function parseOptionalEscrowAppId(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isInteger(numeric) || numeric <= 0) {
    throw new InvalidShapeInputError("escrowAppId must be a positive integer application id.", {
      escrowAppId: value
    });
  }
  return numeric;
}

export function parseOptionalPoolId(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidShapeInputError("poolId must be a non-empty string when provided.");
  }
  return value;
}

export function requireEscrow(state: PactFarmState): Escrow {
  if (state.escrow === null || !state.hasEscrow) {
    throw new ShapeStateError(
      "Pact farm escrow not found for this user. Call mainnet:pact:v1:farm:deployEscrow first, confirm it, then retry.",
      {
        details: {
          farmAppId: state.farmAppId,
          hasEscrow: state.hasEscrow
        }
      }
    );
  }
  return state.escrow;
}

export {
  parseAddress,
  parseAssetId,
  parseBaseUnitAmount
};
