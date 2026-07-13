import algosdk, { Algodv2 } from "algosdk";
import { PactClient } from "@pactfi/pactsdk";
import type { Pool, PoolState, PoolType } from "@pactfi/pactsdk";

import { ShapeStateError } from "../../errors.js";
import type { ExecutionNetwork } from "../../types.js";
import { parseAssetId } from "./parse-input.js";

/**
 * Execution-focused view of a Pact liquidity pool. Resolved from chain via the
 * Pact SDK rather than the discovery API.
 */
export interface PactPoolState {
  network: ExecutionNetwork;
  poolAppId: number;
  escrowAddress: string;
  primaryAssetId: number;
  secondaryAssetId: number;
  liquidityAssetId: number;
  poolType: PoolType;
  contractVersion: number;
  feeBps: number;
  reserves: PoolState;
  /** Raw SDK pool instance for quote/txn builders. */
  pool: Pool;
}

export interface PactPoolStateDependencies {
  createPactClient: (algod: Algodv2, network: ExecutionNetwork) => PactClient;
  fetchPoolById: (client: PactClient, poolAppId: number) => Promise<Pool>;
}

let dependencyOverrides: Partial<PactPoolStateDependencies> | undefined;

export function setPactPoolStateDependenciesForTests(
  overrides?: Partial<PactPoolStateDependencies>
): void {
  dependencyOverrides = overrides;
}

/**
 * Map caller asset ids to Pact primary (lower index) and secondary (higher
 * index) amounts.
 */
export function mapAssetsToPactAmounts(params: {
  assetAId: number;
  assetAAmount: bigint;
  assetBId: number;
  assetBAmount: bigint;
  primaryAssetId: number;
  secondaryAssetId: number;
}): { primaryAssetAmount: bigint; secondaryAssetAmount: bigint } {
  const { assetAId, assetAAmount, assetBId, assetBAmount, primaryAssetId, secondaryAssetId } =
    params;

  if (assetAId === primaryAssetId && assetBId === secondaryAssetId) {
    return { primaryAssetAmount: assetAAmount, secondaryAssetAmount: assetBAmount };
  }
  if (assetAId === secondaryAssetId && assetBId === primaryAssetId) {
    return { primaryAssetAmount: assetBAmount, secondaryAssetAmount: assetAAmount };
  }

  throw new ShapeStateError(
    "Requested assets do not match the resolved Pact pool primary/secondary pair.",
    {
      details: {
        assetAId,
        assetBId,
        primaryAssetId,
        secondaryAssetId
      }
    }
  );
}

export async function resolvePactPoolState(params: {
  network: ExecutionNetwork;
  algod: Algodv2;
  poolAppId: number;
  assetAId?: number;
  assetBId?: number;
}): Promise<PactPoolState> {
  const dependencies = resolveDependencies();
  const { network, algod, poolAppId } = params;

  const pactClient = dependencies.createPactClient(algod, network);

  let pool: Pool;
  try {
    pool = await dependencies.fetchPoolById(pactClient, poolAppId);
  } catch (error) {
    throw new ShapeStateError("Failed to fetch Pact pool by application id.", {
      details: { poolAppId, network },
      cause: error
    });
  }

  const primaryAssetId = pool.primaryAsset.index;
  const secondaryAssetId = pool.secondaryAsset.index;
  const liquidityAssetId = pool.liquidityAsset.index;

  if (params.assetAId !== undefined && params.assetBId !== undefined) {
    const expected = new Set([primaryAssetId, secondaryAssetId]);
    const requested = new Set([params.assetAId, params.assetBId]);
    if (expected.size !== requested.size || ![...expected].every((id) => requested.has(id))) {
      throw new ShapeStateError(
        "Requested asset pair does not match the resolved Pact pool assets.",
        {
          details: {
            poolAppId,
            assetAId: params.assetAId,
            assetBId: params.assetBId,
            primaryAssetId,
            secondaryAssetId
          }
        }
      );
    }
    if (params.assetAId === params.assetBId) {
      throw new ShapeStateError("Pact liquidity operations require two distinct assets.", {
        details: { assetAId: params.assetAId, assetBId: params.assetBId }
      });
    }
  }

  return {
    network,
    poolAppId: pool.appId,
    escrowAddress: pool.getEscrowAddress(),
    primaryAssetId,
    secondaryAssetId,
    liquidityAssetId,
    poolType: pool.poolType,
    contractVersion: pool.version,
    feeBps: pool.feeBps,
    reserves: pool.state,
    pool
  };
}

export function parseOptionalAssetPair(raw: Record<string, unknown>): {
  assetAId?: number;
  assetBId?: number;
} {
  const result: { assetAId?: number; assetBId?: number } = {};
  if (raw.assetAId !== undefined) {
    result.assetAId = parseAssetId(raw.assetAId, "assetAId");
  }
  if (raw.assetBId !== undefined) {
    result.assetBId = parseAssetId(raw.assetBId, "assetBId");
  }
  return result;
}

function resolveDependencies(): PactPoolStateDependencies {
  return {
    createPactClient: defaultCreatePactClient,
    fetchPoolById: defaultFetchPoolById,
    ...dependencyOverrides
  };
}

function defaultCreatePactClient(algod: Algodv2, network: ExecutionNetwork): PactClient {
  // Pact SDK bundles algosdk v2; cast through unknown for v3 client compatibility.
  return new PactClient(algod as unknown as ConstructorParameters<typeof PactClient>[0], {
    network
  });
}

async function defaultFetchPoolById(client: PactClient, poolAppId: number): Promise<Pool> {
  return client.fetchPoolById(poolAppId);
}

export function createExecutionAlgodClient(): Algodv2 {
  const server = process.env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud";
  const token = process.env.X402_ALGOD_TOKEN ?? "";
  return new algosdk.Algodv2(token, trimTrailingSlash(server), "");
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
