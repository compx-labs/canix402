import algosdk, { Algodv2 } from "algosdk";
import {
  ConsensusState,
  MainnetConsensusConfig,
  MainnetOracle,
  MainnetPoolManagerAppId,
  MainnetPools,
  Pool,
  PoolInfo,
  PoolManagerInfo,
  getConsensusState,
  getOraclePrices,
  retrievePoolInfo,
  retrievePoolManagerInfo
} from "@folks-finance/algorand-sdk";

import { OpportunityMarketRecord } from "../types/opportunity.js";
import { resolveAssetDecimals } from "../services/asset-decimals.js";
import {
  CONSENSUS_PAYOUT_FEE_PERCENT,
  estimateConsensusStakingApr,
  type ConsensusStakingAprEstimate
} from "../services/consensus-staking-apr.js";
import { utilizationFromBalances } from "../services/opportunity-risk.js";
import { buildSourceMetadata } from "../services/source-metadata.js";
import { skipLiveCatalogInTests } from "./offline-test-runtime.js";

export const FOLKS_XALGO_STAKING_OPPORTUNITY_ID = "folks-staking-xalgo";
/** Folks stores protocol fee as a 16-decimal fixed-point fraction. */
const FOLKS_FEE_SCALE = 1e16;

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
type GetConsensusStateFn = typeof getConsensusState;

interface FolksFinanceSdkDependencies {
  createAlgodClient: () => Algodv2;
  retrievePoolManagerInfoFn: RetrievePoolManagerInfoFn;
  retrievePoolInfoFn: RetrievePoolInfoFn;
  getOraclePricesFn: GetOraclePricesFn;
  getConsensusStateFn: GetConsensusStateFn;
  estimateConsensusApr: (algod: Algodv2) => Promise<ConsensusStakingAprEstimate>;
  mainnetPools: typeof MainnetPools;
  mainnetPoolManagerAppId: number;
  mainnetOracle: typeof MainnetOracle;
  mainnetConsensusConfig: typeof MainnetConsensusConfig;
}

let folksFinanceSdkDependencyOverrides: Partial<FolksFinanceSdkDependencies> | undefined;

export function setFolksFinanceSdkDependenciesForTests(
  overrides?: Partial<FolksFinanceSdkDependencies>
): void {
  folksFinanceSdkDependencyOverrides = overrides;
}

export async function fetchFolksFinanceOpportunities(): Promise<OpportunityMarketRecord[]> {
  if (skipLiveCatalogInTests(folksFinanceSdkDependencyOverrides)) {
    throw new FolksFinanceAdapterError(
      "Folks live SDK is disabled in CI/tests."
    );
  }

  const dependencies = resolveDependencies();
  const fetchedAt = new Date().toISOString();

  try {
    const algodClient = dependencies.createAlgodClient();
    const [poolManagerInfo, oraclePrices, consensusStateResult, consensusAprResult] =
      await Promise.all([
        dependencies.retrievePoolManagerInfoFn(
          algodClient,
          dependencies.mainnetPoolManagerAppId
        ),
        dependencies.getOraclePricesFn(algodClient, dependencies.mainnetOracle),
        dependencies
          .getConsensusStateFn(algodClient, dependencies.mainnetConsensusConfig)
          .then(
            (state) => ({ ok: true as const, state }),
            () => ({ ok: false as const })
          ),
        dependencies.estimateConsensusApr(algodClient).then(
          (estimate) => ({ ok: true as const, estimate }),
          () => ({ ok: false as const })
        )
      ]);

    const poolEntries = Object.entries(dependencies.mainnetPools);
    const poolAssetIds = poolEntries.map(([, pool]) => Number(pool.assetId));
    const [decimalsByAssetId, poolInfos] = await Promise.all([
      resolveAssetDecimals(poolAssetIds, algodClient),
      Promise.allSettled(
        poolEntries.map(async ([symbol, pool]) => {
          const poolInfo = await dependencies.retrievePoolInfoFn(algodClient, pool);
          return { symbol, pool, poolInfo };
        })
      )
    ]);

    const lendingOpportunities = poolInfos
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
          assetDecimals: decimalsByAssetId.get(Number(value.pool.assetId)),
          fetchedAtIso: fetchedAt
        })
      )
      .filter((record): record is OpportunityMarketRecord => record !== null);

    if (lendingOpportunities.length === 0) {
      throw new FolksFinanceAdapterError(
        "Folks Finance SDK returned no valid lending opportunities."
      );
    }

    const opportunities = [...lendingOpportunities];
    if (consensusStateResult.ok && consensusAprResult.ok) {
      const staking = normalizeFolksXAlgoStakingOpportunity({
        consensusState: consensusStateResult.state,
        consensusApr: consensusAprResult.estimate.apr,
        oraclePrice: oraclePrices.prices[0]?.price,
        xAlgoId: dependencies.mainnetConsensusConfig.xAlgoId,
        sampleSize: consensusAprResult.estimate.sampleSize,
        fetchedAtIso: fetchedAt
      });
      if (staking !== null) {
        opportunities.push(staking);
      }
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
  assetDecimals: number | undefined;
  fetchedAtIso: string;
}

export function normalizeFolksLendingOpportunity(
  input: NormalizeFolksLendingOpportunityInput
): OpportunityMarketRecord | null {
  const {
    symbol,
    pool,
    poolInfo,
    poolManagerInfo,
    oraclePrice,
    assetDecimals,
    fetchedAtIso
  } = input;
  const poolManagerState = poolManagerInfo.pools[pool.appId];
  if (!poolManagerState || oraclePrice === undefined || assetDecimals === undefined) {
    return null;
  }

  // The Folks SDK exposes yields as decimal fractions (0.051646 = 5.1646%).
  // OpportunityMarketRecord uses percentage points, consistent with the Tinyman,
  // Pact, and Dork.fi source values.
  const apy = toPercentagePoints(fromScaledValue(poolManagerState.depositInterestYield, 16));
  const apr = toPercentagePoints(fromScaledValue(poolManagerState.depositInterestRate, 16));
  const borrowApr = toPercentagePoints(
    fromScaledValue(poolManagerState.variableBorrowInterestYield, 16)
  );
  // Folks oracle prices are already scaled as USD * 10^(14 - assetDecimals), so
  // USD = baseUnits * price / 1e14. Do not also divide deposits by asset decimals.
  const tvlUsd = calcTvlUsd(poolInfo.interest.totalDeposits, oraclePrice);
  const utilization = utilizationFromBalances(
    poolInfo.variableBorrow.totalVariableBorrowAmount +
      poolInfo.stableBorrow.totalStableBorrowAmount,
    poolInfo.interest.totalDeposits
  );

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
    yieldBasis: "apy",
    tvlUsd,
    ...(apr !== null ? { apr } : {}),
    ...(borrowApr !== null ? { borrowApr } : {}),
    risk: {
      ...(utilization !== undefined ? { utilization } : {}),
      ...(borrowApr !== null ? { borrowApr } : {})
    },
    ...buildSourceMetadata({
      fetchedAtIso,
      upstreamUnixSeconds: poolInfo.interest.latestUpdate,
      contextNotes: [
        `Folks mainnet lending pool ${pool.appId}; borrowApr is variable borrow yield.`
      ]
    })
  };
}

export function normalizeFolksXAlgoStakingOpportunity(input: {
  consensusState: Pick<ConsensusState, "algoBalance" | "fee">;
  consensusApr: number;
  oraclePrice: bigint | undefined;
  xAlgoId: number;
  sampleSize: number;
  fetchedAtIso: string;
}): OpportunityMarketRecord | null {
  const {
    consensusState,
    consensusApr,
    oraclePrice,
    xAlgoId,
    sampleSize,
    fetchedAtIso
  } = input;

  if (
    !Number.isFinite(consensusApr) ||
    consensusApr < 0 ||
    oraclePrice === undefined ||
    consensusState.algoBalance <= 0n
  ) {
    return null;
  }

  const protocolFeeFraction = Number(consensusState.fee) / FOLKS_FEE_SCALE;
  if (!Number.isFinite(protocolFeeFraction) || protocolFeeFraction < 0 || protocolFeeFraction >= 1) {
    return null;
  }

  const tvlUsd = calcTvlUsd(consensusState.algoBalance, oraclePrice);
  const apy = consensusApr * (1 - protocolFeeFraction);
  if (!Number.isFinite(apy) || !Number.isFinite(tvlUsd) || tvlUsd <= 0) {
    return null;
  }

  return {
    protocol: "folks-finance",
    opportunityType: "staking",
    opportunityId: FOLKS_XALGO_STAKING_OPPORTUNITY_ID,
    assetPair: "ALGO/xALGO",
    assetIds: [0, xAlgoId],
    apy,
    yieldBasis: "apy",
    tvlUsd,
    apr: consensusApr,
    ...buildSourceMetadata({
      fetchedAtIso,
      contextNotes: [
        "Folks Finance xALGO liquid staking (immediate). APY from Algorand consensus rewards " +
          `(Foundation bonus + ${CONSENSUS_PAYOUT_FEE_PERCENT}% of fees) / online stake, ` +
          `net of Folks protocol fee ${(protocolFeeFraction * 100).toFixed(2)}%. ` +
          `Fee share averaged over ${sampleSize} recent blocks.`
      ]
    })
  };
}

function resolveDependencies(): FolksFinanceSdkDependencies {
  return {
    createAlgodClient: createFolksAlgodClient,
    retrievePoolManagerInfoFn: retrievePoolManagerInfo,
    retrievePoolInfoFn: retrievePoolInfo,
    getOraclePricesFn: getOraclePrices,
    getConsensusStateFn: getConsensusState,
    estimateConsensusApr: (algod) => estimateConsensusStakingApr(algod),
    mainnetPools: MainnetPools,
    mainnetPoolManagerAppId: MainnetPoolManagerAppId,
    mainnetOracle: MainnetOracle,
    mainnetConsensusConfig: MainnetConsensusConfig,
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

function toPercentagePoints(value: number): number {
  return value * 100;
}

function calcTvlUsd(totalDeposits: bigint, oraclePrice: bigint): number {
  // Matches Folks SDK calcAssetDollarValue(amount 0dp, price 14dp): deposits are
  // asset base units and the oracle price already embeds 10^(14 - decimals).
  return fromScaledValue(totalDeposits * oraclePrice, 14);
}

function trimTrailingSlash(value: string): string {
  if (value.endsWith("/")) {
    return value.slice(0, -1);
  }
  return value;
}
