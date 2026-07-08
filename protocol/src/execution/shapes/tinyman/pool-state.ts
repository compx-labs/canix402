import algosdk, { Algodv2 } from "algosdk";
import { CONTRACT_VERSION, getValidatorAppID, poolUtils } from "@tinymanorg/tinyman-js-sdk";
import type { V2PoolInfo } from "@tinymanorg/tinyman-js-sdk";

import { resolveAssetDecimals } from "../../../services/asset-decimals.js";
import { ShapeStateError } from "../../errors.js";
import type { ExecutionNetwork } from "../../types.js";

/**
 * Execution-focused view of a Tinyman v2 pool. This is intentionally separate
 * from the opportunity adapter: execution-critical values (pool address, pool
 * token id, asset ordering, app id) are resolved and verified here rather than
 * trusted from the discovery API.
 */
export interface TinymanV2PoolState {
  network: ExecutionNetwork;
  validatorAppId: number;
  poolAddress: string;
  poolTokenId: number;
  /** Higher asset id per Tinyman ordering convention. */
  asset1Id: number;
  /** Lower asset id per Tinyman ordering convention (ALGO=0 is always asset2). */
  asset2Id: number;
  asset1Decimals: number;
  asset2Decimals: number;
  /** Raw SDK pool info, needed by the SDK quote/txn builders. */
  poolInfo: V2PoolInfo;
}

export interface TinymanPoolStateDependencies {
  createAlgodClient: () => Algodv2;
  getPoolInfo: (params: {
    client: Algodv2;
    network: ExecutionNetwork;
    asset1ID: number;
    asset2ID: number;
  }) => Promise<V2PoolInfo>;
  resolveAssetDecimals: (
    assetIds: readonly number[],
    algodClient?: Algodv2
  ) => Promise<Map<number, number>>;
  getValidatorAppId: (network: ExecutionNetwork) => number;
}

let dependencyOverrides: Partial<TinymanPoolStateDependencies> | undefined;

export function setTinymanPoolStateDependenciesForTests(
  overrides?: Partial<TinymanPoolStateDependencies>
): void {
  dependencyOverrides = overrides;
}

/**
 * Normalize the caller's asset pair to Tinyman's ordering convention: asset1 is
 * the higher asset id, asset2 is the lower id (so ALGO, id 0, is always
 * asset2). Returns which of the caller's assets maps to asset1/asset2.
 */
export function orderTinymanAssets(assetXId: number, assetYId: number): {
  asset1Id: number;
  asset2Id: number;
  /** True when the caller's first asset (X) is asset1. */
  xIsAsset1: boolean;
} {
  if (assetXId === assetYId) {
    throw new ShapeStateError("Tinyman add liquidity requires two distinct assets.", {
      details: { assetXId, assetYId }
    });
  }
  const xIsAsset1 = assetXId > assetYId;
  return {
    asset1Id: xIsAsset1 ? assetXId : assetYId,
    asset2Id: xIsAsset1 ? assetYId : assetXId,
    xIsAsset1
  };
}

export async function resolveTinymanV2PoolState(params: {
  network: ExecutionNetwork;
  algod: Algodv2;
  asset1Id: number;
  asset2Id: number;
}): Promise<TinymanV2PoolState> {
  const dependencies = resolveDependencies();
  const { network, algod, asset1Id, asset2Id } = params;

  let poolInfo: V2PoolInfo;
  try {
    poolInfo = await dependencies.getPoolInfo({
      client: algod,
      network,
      asset1ID: asset1Id,
      asset2ID: asset2Id
    });
  } catch (error) {
    throw new ShapeStateError("Failed to fetch Tinyman v2 pool info.", {
      details: { asset1Id, asset2Id, network },
      cause: error
    });
  }

  if (poolUtils.isPoolNotCreated(poolInfo)) {
    throw new ShapeStateError("Tinyman v2 pool does not exist for the requested pair.", {
      details: { asset1Id, asset2Id, network }
    });
  }

  if (!poolUtils.isPoolReady(poolInfo)) {
    throw new ShapeStateError(
      "Tinyman v2 pool is not ready for liquidity operations (bootstrap/incomplete).",
      { details: { asset1Id, asset2Id, network, status: poolInfo.status } }
    );
  }

  if (poolInfo.poolTokenID === undefined) {
    throw new ShapeStateError("Tinyman v2 pool is missing a pool token id.", {
      details: { asset1Id, asset2Id, network }
    });
  }

  const poolAddress = poolInfo.account.address().toString();
  const decimals = await dependencies.resolveAssetDecimals([asset1Id, asset2Id], algod);
  const asset1Decimals = decimals.get(asset1Id);
  const asset2Decimals = decimals.get(asset2Id);

  if (asset1Decimals === undefined || asset2Decimals === undefined) {
    throw new ShapeStateError("Could not resolve asset decimals for the pool assets.", {
      details: { asset1Id, asset2Id, network }
    });
  }

  return {
    network,
    validatorAppId: dependencies.getValidatorAppId(network),
    poolAddress,
    poolTokenId: poolInfo.poolTokenID,
    asset1Id,
    asset2Id,
    asset1Decimals,
    asset2Decimals,
    poolInfo
  };
}

function resolveDependencies(): TinymanPoolStateDependencies {
  return {
    createAlgodClient: createExecutionAlgodClient,
    getPoolInfo: defaultGetPoolInfo,
    resolveAssetDecimals,
    getValidatorAppId: defaultGetValidatorAppId,
    ...dependencyOverrides
  };
}

async function defaultGetPoolInfo(params: {
  client: Algodv2;
  network: ExecutionNetwork;
  asset1ID: number;
  asset2ID: number;
}): Promise<V2PoolInfo> {
  return poolUtils.v2.getPoolInfo(params);
}

function defaultGetValidatorAppId(network: ExecutionNetwork): number {
  return getValidatorAppID(network, CONTRACT_VERSION.V2);
}

export function createExecutionAlgodClient(): Algodv2 {
  const server = process.env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud";
  const token = process.env.X402_ALGOD_TOKEN ?? "";
  return new algosdk.Algodv2(token, trimTrailingSlash(server), "");
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
