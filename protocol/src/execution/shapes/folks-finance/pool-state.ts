import algosdk, { Algodv2, Indexer, SuggestedParams } from "algosdk";
import {
  MainnetDepositsAppId,
  MainnetOpUp,
  MainnetPoolManagerAppId,
  MainnetPools,
  Pool,
  PoolInfo,
  PoolManagerInfo,
  UserDepositInfo,
  retrievePoolInfo,
  retrievePoolManagerInfo,
  retrieveUserDepositsInfo
} from "@folks-finance/algorand-sdk";

import { ShapeStateError } from "../../errors.js";
import type { ExecutionNetwork } from "../../types.js";
import { createExecutionAlgodClient } from "../tinyman/pool-state.js";

export interface FolksPoolState {
  network: ExecutionNetwork;
  symbol: string;
  pool: Pool;
  poolInfo: PoolInfo;
  poolManagerInfo: PoolManagerInfo;
  /** Current deposit interest index (14 dp) from pool manager state. */
  depositInterestIndex: bigint;
  poolAppAddress: string;
}

export interface FolksEscrowContext {
  escrowAddress: string;
  optedIntoFAsset: boolean;
  fAssetBalance: bigint;
}

export interface FolksPoolStateDependencies {
  createAlgodClient: () => Algodv2;
  createIndexerClient: () => Indexer;
  mainnetPools: typeof MainnetPools;
  mainnetPoolManagerAppId: number;
  mainnetDepositsAppId: number;
  mainnetOpUp: typeof MainnetOpUp;
  retrievePoolManagerInfoFn: typeof retrievePoolManagerInfo;
  retrievePoolInfoFn: typeof retrievePoolInfo;
  retrieveUserDepositsInfoFn: typeof retrieveUserDepositsInfo;
}

let dependencyOverrides: Partial<FolksPoolStateDependencies> | undefined;

export function setFolksPoolStateDependenciesForTests(
  overrides?: Partial<FolksPoolStateDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): FolksPoolStateDependencies {
  return {
    createAlgodClient: createExecutionAlgodClient,
    createIndexerClient: createExecutionIndexerClient,
    mainnetPools: MainnetPools,
    mainnetPoolManagerAppId: MainnetPoolManagerAppId,
    mainnetDepositsAppId: MainnetDepositsAppId,
    mainnetOpUp: MainnetOpUp,
    retrievePoolManagerInfoFn: retrievePoolManagerInfo,
    retrievePoolInfoFn: retrievePoolInfo,
    retrieveUserDepositsInfoFn: retrieveUserDepositsInfo,
    ...dependencyOverrides
  };
}

export function createExecutionIndexerClient(): Indexer {
  const server = process.env.X402_INDEXER_URL ?? "https://mainnet-idx.algonode.cloud";
  const token = process.env.X402_INDEXER_TOKEN ?? "";
  return new algosdk.Indexer(token, trimTrailingSlash(server), "");
}

export async function getSuggestedParams(algod: Algodv2): Promise<SuggestedParams> {
  try {
    return await algod.getTransactionParams().do();
  } catch (error) {
    throw new ShapeStateError("Failed to fetch suggested transaction params from algod.", {
      cause: error
    });
  }
}

export async function resolveFolksPoolState(params: {
  network: ExecutionNetwork;
  algod: Algodv2;
  poolAppId?: number;
  assetId?: number;
}): Promise<FolksPoolState> {
  if (params.network !== "mainnet") {
    throw new ShapeStateError("Folks Finance lending shapes are currently verified for mainnet only.", {
      details: { network: params.network }
    });
  }

  const dependencies = resolveDependencies();
  const poolEntry = resolvePoolEntry(dependencies.mainnetPools, params.poolAppId, params.assetId);

  let poolManagerInfo: PoolManagerInfo;
  let poolInfo: PoolInfo;
  try {
    [poolManagerInfo, poolInfo] = await Promise.all([
      dependencies.retrievePoolManagerInfoFn(params.algod, dependencies.mainnetPoolManagerAppId),
      dependencies.retrievePoolInfoFn(params.algod, poolEntry.pool)
    ]);
  } catch (error) {
    throw new ShapeStateError("Failed to fetch Folks Finance pool state.", {
      details: {
        poolAppId: poolEntry.pool.appId,
        symbol: poolEntry.symbol
      },
      cause: error
    });
  }

  const poolManagerState = poolManagerInfo.pools[poolEntry.pool.appId];
  if (poolManagerState === undefined) {
    throw new ShapeStateError("Folks Finance pool manager has no state for the requested pool.", {
      details: { poolAppId: poolEntry.pool.appId, symbol: poolEntry.symbol }
    });
  }

  return {
    network: params.network,
    symbol: poolEntry.symbol,
    pool: poolEntry.pool,
    poolInfo,
    poolManagerInfo,
    depositInterestIndex: poolManagerState.depositInterestIndex,
    poolAppAddress: algosdk.getApplicationAddress(poolEntry.pool.appId).toString()
  };
}

export async function resolveFolksEscrowContext(params: {
  algod: Algodv2;
  userAddress: string;
  pool: Pool;
  escrowAddress?: string;
  requireFAssetBalance?: boolean;
}): Promise<FolksEscrowContext> {
  const dependencies = resolveDependencies();
  const escrowAddress =
    params.escrowAddress ??
    (await resolveEscrowAddressFromIndexer(
      dependencies,
      params.userAddress,
      params.pool,
      params.requireFAssetBalance ?? false
    ));

  const fAssetBalance = await getAccountAssetBalance(
    params.algod,
    escrowAddress,
    Number(params.pool.fAssetId)
  );
  const optedIntoFAsset =
    fAssetBalance > 0n ||
    (await isAccountOptedIntoAsset(params.algod, escrowAddress, Number(params.pool.fAssetId)));

  return {
    escrowAddress,
    optedIntoFAsset,
    fAssetBalance
  };
}

async function resolveEscrowAddressFromIndexer(
  dependencies: FolksPoolStateDependencies,
  userAddress: string,
  pool: Pool,
  requireFAssetBalance: boolean
): Promise<string> {
  let deposits: UserDepositInfo[];
  try {
    const indexer = dependencies.createIndexerClient();
    deposits = await dependencies.retrieveUserDepositsInfoFn(
      indexer,
      dependencies.mainnetDepositsAppId,
      userAddress
    );
  } catch (error) {
    throw new ShapeStateError("Failed to fetch Folks Finance deposit escrows from indexer.", {
      details: { userAddress },
      cause: error
    });
  }

  if (deposits.length === 0) {
    throw new ShapeStateError(
      "No Folks Finance deposit escrow found for user; run setup:depositEscrow first or provide escrowAddress.",
      { details: { userAddress } }
    );
  }

  const fAssetId = Number(pool.fAssetId);
  const withPoolBalance = deposits.filter((deposit) =>
    deposit.holdings.some(
      (holding) => holding.fAssetId === fAssetId && holding.fAssetBalance > 0n
    )
  );

  if (requireFAssetBalance) {
    if (withPoolBalance.length === 0) {
      throw new ShapeStateError(
        "No deposit escrow holds fAssets for the requested pool; specify escrowAddress or deposit first.",
        { details: { userAddress, fAssetId, poolAppId: pool.appId } }
      );
    }
    if (withPoolBalance.length > 1) {
      throw new ShapeStateError(
        "Multiple deposit escrows hold this pool fAsset; specify escrowAddress explicitly.",
        {
          details: {
            userAddress,
            escrowAddresses: withPoolBalance.map((deposit) => deposit.escrowAddress)
          }
        }
      );
    }
    return withPoolBalance[0]!.escrowAddress;
  }

  const optedIntoPool = deposits.filter((deposit) =>
    deposit.holdings.some((holding) => holding.fAssetId === fAssetId)
  );
  if (optedIntoPool.length === 1) {
    return optedIntoPool[0]!.escrowAddress;
  }
  if (deposits.length === 1) {
    return deposits[0]!.escrowAddress;
  }

  throw new ShapeStateError(
    "Multiple Folks Finance deposit escrows found; specify escrowAddress explicitly.",
    {
      details: {
        userAddress,
        escrowAddresses: deposits.map((deposit) => deposit.escrowAddress)
      }
    }
  );
}

function resolvePoolEntry(
  pools: typeof MainnetPools,
  poolAppId: number | undefined,
  assetId: number | undefined
): { symbol: string; pool: Pool } {
  const entries = Object.entries(pools);

  if (poolAppId !== undefined) {
    const match = entries.find(([, pool]) => pool.appId === poolAppId);
    if (match === undefined) {
      throw new ShapeStateError("Unknown Folks Finance pool app id.", {
        details: { poolAppId }
      });
    }
    return { symbol: match[0], pool: match[1] };
  }

  if (assetId === undefined) {
    throw new ShapeStateError("Provide poolAppId or assetId to resolve a Folks Finance pool.");
  }

  const matches = entries.filter(([, pool]) => Number(pool.assetId) === assetId);
  if (matches.length === 0) {
    throw new ShapeStateError("No Folks Finance pool found for asset id.", {
      details: { assetId }
    });
  }
  if (matches.length > 1) {
    throw new ShapeStateError(
      "Multiple Folks Finance pools share this asset id; specify poolAppId from discovery.",
      {
        details: {
          assetId,
          poolAppIds: matches.map(([, pool]) => pool.appId)
        }
      }
    );
  }

  const [symbol, pool] = matches[0]!;
  return { symbol, pool };
}

export async function getAccountAssetBalance(
  algod: Algodv2,
  address: string,
  assetId: number
): Promise<bigint> {
  try {
    const account = await algod.accountInformation(address).do();
    if (assetId === 0) {
      return BigInt(account.amount);
    }
    const holding = account.assets?.find((asset) => Number(asset.assetId) === assetId);
    return holding === undefined ? 0n : BigInt(holding.amount);
  } catch (error) {
    throw new ShapeStateError("Failed to read account asset balance from algod.", {
      details: { address, assetId },
      cause: error
    });
  }
}

export async function isAccountOptedIntoAsset(
  algod: Algodv2,
  address: string,
  assetId: number
): Promise<boolean> {
  if (assetId === 0) {
    return true;
  }
  const balance = await getAccountAssetBalance(algod, address, assetId);
  return balance > 0n || (await hasZeroBalanceOptIn(algod, address, assetId));
}

async function hasZeroBalanceOptIn(
  algod: Algodv2,
  address: string,
  assetId: number
): Promise<boolean> {
  const account = await algod.accountInformation(address).do();
  return account.assets?.some((asset) => Number(asset.assetId) === assetId) ?? false;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export {
  MainnetDepositsAppId,
  MainnetOpUp,
  MainnetPoolManagerAppId
};

export function getDepositsAppAddress(depositsAppId: number = MainnetDepositsAppId): string {
  return algosdk.getApplicationAddress(depositsAppId).toString();
}
