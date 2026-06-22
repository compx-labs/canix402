import algosdk, { Algodv2 } from "algosdk";
import {
  MainnetOracle,
  MainnetPoolManagerAppId,
  MainnetPools,
  Pool,
  PoolInfo,
  PoolManagerInfo,
  getOraclePrices,
  retrievePoolInfo,
  retrievePoolManagerInfo
} from "@folks-finance/algorand-sdk";

import { OpportunityRecordV1 } from "../types/opportunity.js";

export class FolksFinanceAdapterError extends Error {
  public readonly cause?: unknown;

  public constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "FolksFinanceAdapterError";
    this.cause = cause;
  }
}

type RetrievePoolManagerInfoFn = typeof retrievePoolManagerInfo;
type RetrievePoolInfoFn = typeof retrievePoolInfo;
type GetOraclePricesFn = typeof getOraclePrices;

interface FolksFinanceSdkDependencies {
  createAlgodClient: () => Algodv2;
  retrievePoolManagerInfoFn: RetrievePoolManagerInfoFn;
  retrievePoolInfoFn: RetrievePoolInfoFn;
  getOraclePricesFn: GetOraclePricesFn;
  mainnetPools: typeof MainnetPools;
  mainnetPoolManagerAppId: number;
  mainnetOracle: typeof MainnetOracle;
}

let folksFinanceSdkDependencyOverrides: Partial<FolksFinanceSdkDependencies> | undefined;

export function setFolksFinanceSdkDependenciesForTests(
  overrides?: Partial<FolksFinanceSdkDependencies>
): void {
  folksFinanceSdkDependencyOverrides = overrides;
}

export async function fetchFolksFinanceOpportunities(): Promise<OpportunityRecordV1[]> {
  const dependencies = resolveDependencies();
  const fetchedAt = new Date().toISOString();

  try {
    const algodClient = dependencies.createAlgodClient();
    const [poolManagerInfo, oraclePrices] = await Promise.all([
      dependencies.retrievePoolManagerInfoFn(
        algodClient,
        dependencies.mainnetPoolManagerAppId
      ),
      dependencies.getOraclePricesFn(algodClient, dependencies.mainnetOracle)
    ]);

    const poolEntries = Object.entries(dependencies.mainnetPools);
    const poolInfos = await Promise.allSettled(
      poolEntries.map(async ([symbol, pool]) => {
        const poolInfo = await dependencies.retrievePoolInfoFn(algodClient, pool);
        return { symbol, pool, poolInfo };
      })
    );

    const opportunities = poolInfos
      .filter(
        (
          result
        ): result is PromiseFulfilledResult<{ symbol: string; pool: Pool; poolInfo: PoolInfo }> =>
          result.status === "fulfilled"
      )
      .map(({ value }) =>
        normalizeFolksLendingOpportunity({
          symbol: value.symbol,
          pool: value.pool,
          poolInfo: value.poolInfo,
          poolManagerInfo,
          oraclePrice: oraclePrices.prices[value.pool.assetId]?.price,
          fetchedAtIso: fetchedAt
        })
      )
      .filter((record): record is OpportunityRecordV1 => record !== null);

    if (opportunities.length === 0) {
      throw new FolksFinanceAdapterError(
        "Folks Finance SDK returned no valid lending opportunities."
      );
    }

    return opportunities;
  } catch (error) {
    if (error instanceof FolksFinanceAdapterError) {
      throw error;
    }

    throw new FolksFinanceAdapterError("Folks Finance SDK request failed.", error);
  }
}

interface NormalizeFolksLendingOpportunityInput {
  symbol: string;
  pool: Pool;
  poolInfo: PoolInfo;
  poolManagerInfo: PoolManagerInfo;
  oraclePrice: bigint | undefined;
  fetchedAtIso: string;
}

export function normalizeFolksLendingOpportunity(
  input: NormalizeFolksLendingOpportunityInput
): OpportunityRecordV1 | null {
  const { symbol, pool, poolInfo, poolManagerInfo, oraclePrice, fetchedAtIso } = input;
  const poolManagerState = poolManagerInfo.pools[pool.appId];
  if (!poolManagerState || oraclePrice === undefined) {
    return null;
  }

  const apy = fromScaledValue(poolManagerState.depositInterestYield, 16);
  const apr = fromScaledValue(poolManagerState.depositInterestRate, 16);
  const tvlUsd = calcTvlUsd(poolInfo.interest.totalDeposits, pool.assetDecimals, oraclePrice);

  if (!Number.isFinite(apy) || !Number.isFinite(tvlUsd)) {
    return null;
  }

  return {
    protocol: "folks-finance",
    opportunityType: "lending",
    opportunityId: `folks-lending-${pool.appId}`,
    assetPair: symbol,
    assetIds: [Number(pool.assetId)],
    apy,
    tvlUsd,
    ...(apr !== null ? { apr } : {}),
    sourceTimestamp: fetchedAtIso,
    fetchedAt: fetchedAtIso,
    notes: `Folks mainnet lending pool ${pool.appId}`
  };
}

function resolveDependencies(): FolksFinanceSdkDependencies {
  return {
    createAlgodClient: createFolksAlgodClient,
    retrievePoolManagerInfoFn: retrievePoolManagerInfo,
    retrievePoolInfoFn: retrievePoolInfo,
    getOraclePricesFn: getOraclePrices,
    mainnetPools: MainnetPools,
    mainnetPoolManagerAppId: MainnetPoolManagerAppId,
    mainnetOracle: MainnetOracle,
    ...folksFinanceSdkDependencyOverrides
  };
}

function createFolksAlgodClient(): Algodv2 {
  const server =
    process.env.X402_ALGOD_URL ??
    "https://mainnet-api.algonode.cloud";
  const token = process.env.X402_ALGOD_TOKEN ?? "";
  return new algosdk.Algodv2(token, trimTrailingSlash(server), "");
}

function fromScaledValue(value: bigint, scale: number): number {
  const sign = value < 0n ? -1 : 1;
  const absolute = value < 0n ? -value : value;
  const asString = absolute.toString();

  if (scale === 0) {
    return sign * Number(asString);
  }

  const wholePart =
    asString.length > scale ? asString.slice(0, asString.length - scale) : "0";
  const fractionalPart =
    asString.length > scale ? asString.slice(asString.length - scale) : asString.padStart(scale, "0");
  const normalized = Number(`${wholePart}.${fractionalPart}`);
  return sign * normalized;
}

function calcTvlUsd(totalDeposits: bigint, assetDecimals: number, oraclePrice: bigint): number {
  const depositUnits = fromScaledValue(totalDeposits, assetDecimals);
  const assetPriceUsd = fromScaledValue(oraclePrice, 14);
  return depositUnits * assetPriceUsd;
}

function trimTrailingSlash(value: string): string {
  if (value.endsWith("/")) {
    return value.slice(0, -1);
  }
  return value;
}
