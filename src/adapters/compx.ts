import algosdk, { Algodv2 } from "algosdk";
import {
  CompXSDK,
  formatAmount,
  type AssetInfo,
  type MarketData,
  type Network,
  type StakingPoolState
} from "@compx/sdk";

import { OpportunityRecordV1 } from "../types/opportunity.js";
import { resolveAssetDecimals } from "../services/asset-decimals.js";
import { buildSourceMetadata } from "../services/source-metadata.js";

export class CompXAdapterError extends Error {
  public readonly cause?: unknown;

  public constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "CompXAdapterError";
    this.cause = cause;
  }
}

type GetAllMarketsFn = () => Promise<MarketData[]>;
type GetAllPoolsFn = () => Promise<StakingPoolState[]>;
type GetAssetsInfoFn = (assetIds: number[]) => Promise<AssetInfo[]>;
type GetPoolAprFn = (
  appId: number,
  options: {
    stakedAssetDecimals?: number;
    rewardAssetDecimals?: number;
    stakedAssetPriceUsd?: number;
    rewardAssetPriceUsd?: number;
    nowTimestamp?: number;
  }
) => Promise<number | null>;
type GetOraclePricesFn = (
  oracleAppId: number,
  assetIds: number[]
) => Promise<Map<number, { price: number }>>;

interface CompXSdkDependencies {
  createAlgodClient: () => Algodv2;
  createSdk: (algodClient: Algodv2) => CompXSDK;
  network: Network;
  getAllMarketsFn: GetAllMarketsFn;
  getAllPoolsFn: GetAllPoolsFn;
  getAssetsInfoFn: GetAssetsInfoFn;
  getPoolAprFn: GetPoolAprFn;
  getOraclePricesFn: GetOraclePricesFn;
  fallbackOracleAppId: number;
  onlyActive: boolean;
}

let compxSdkDependencyOverrides: Partial<CompXSdkDependencies> | undefined;

export function setCompXSdkDependenciesForTests(
  overrides?: Partial<CompXSdkDependencies>
): void {
  compxSdkDependencyOverrides = overrides;
}

export async function fetchCompXOpportunities(): Promise<OpportunityRecordV1[]> {
  const dependencies = resolveDependencies();
  const fetchedAt = new Date().toISOString();

  try {
    const algodClient = dependencies.createAlgodClient();
    const sdk = dependencies.createSdk(algodClient);

    const [markets, pools] = await Promise.all([
      dependencies.getAllMarketsFn.call(sdk.lending),
      dependencies.getAllPoolsFn.call(sdk.staking)
    ]);

    const assetIds = collectUniqueAssetIds(markets, pools);
    const [assets, decimalsByAssetId] = await Promise.all([
      dependencies.getAssetsInfoFn.call(sdk.lending, assetIds),
      resolveAssetDecimals(assetIds, algodClient)
    ]);
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));

    const oracleAppIds = buildOracleAppIdMap(markets, dependencies.fallbackOracleAppId);
    const priceByAssetId = await resolveAssetPrices(
      dependencies.getOraclePricesFn.bind(sdk.lending),
      oracleAppIds,
      assetIds
    );

    const lendingOpportunities = markets
      .filter((market) => passesActiveFilter(market.contractState, dependencies.onlyActive))
      .map((market) =>
        normalizeCompxLendingOpportunity({
          market,
          assetById,
          fetchedAtIso: fetchedAt
        })
      )
      .filter((record): record is OpportunityRecordV1 => record !== null);

    const stakingOpportunities = (
      await Promise.all(
        pools
          .filter((pool) => passesStakingActiveFilter(pool, dependencies.onlyActive))
          .map(async (pool) => {
            const stakedDecimals = decimalsByAssetId.get(pool.stakedAssetId);
            const rewardDecimals = decimalsByAssetId.get(pool.rewardAssetId);
            // Both staked and reward decimals must come from chain: staked
            // decimals drive TVL, reward decimals drive the APR estimate.
            // Guessing either produces materially wrong yields, so drop the row.
            if (stakedDecimals === undefined || rewardDecimals === undefined) {
              return null;
            }

            const stakedAsset = assetById.get(pool.stakedAssetId);
            const rewardAsset = assetById.get(pool.rewardAssetId);
            const stakedAssetPriceUsd = priceByAssetId.get(pool.stakedAssetId);
            const rewardAssetPriceUsd = priceByAssetId.get(pool.rewardAssetId);

            const aprOptions: Parameters<GetPoolAprFn>[1] = {
              nowTimestamp: Math.floor(Date.now() / 1000),
              stakedAssetDecimals: stakedDecimals,
              rewardAssetDecimals: rewardDecimals
            };
            if (stakedAssetPriceUsd !== undefined) {
              aprOptions.stakedAssetPriceUsd = stakedAssetPriceUsd;
            }
            if (rewardAssetPriceUsd !== undefined) {
              aprOptions.rewardAssetPriceUsd = rewardAssetPriceUsd;
            }

            const apr = await dependencies.getPoolAprFn.call(sdk.staking, pool.appId, aprOptions);

            return normalizeCompxStakingOpportunity({
              pool,
              apr,
              stakedAsset,
              rewardAsset,
              stakedAssetPriceUsd,
              stakedDecimals,
              fetchedAtIso: fetchedAt
            });
          })
      )
    ).filter((record): record is OpportunityRecordV1 => record !== null);

    const opportunities = [...lendingOpportunities, ...stakingOpportunities];

    if (opportunities.length === 0) {
      throw new CompXAdapterError("CompX SDK returned no valid lending or staking opportunities.");
    }

    return opportunities;
  } catch (error) {
    if (error instanceof CompXAdapterError) {
      throw error;
    }

    throw new CompXAdapterError("CompX SDK request failed.", error);
  }
}

interface NormalizeCompxLendingOpportunityInput {
  market: MarketData;
  assetById: Map<number, AssetInfo>;
  fetchedAtIso: string;
}

export function normalizeCompxLendingOpportunity(
  input: NormalizeCompxLendingOpportunityInput
): OpportunityRecordV1 | null {
  const { market, assetById, fetchedAtIso } = input;
  const apy = market.supplyApy;
  const tvlUsd = market.totalDepositsUSD;

  if (!Number.isFinite(apy) || !Number.isFinite(tvlUsd) || tvlUsd <= 0) {
    return null;
  }

  const baseSymbol = resolveAssetSymbol(market.baseTokenId, assetById);

  return {
    protocol: "compx",
    opportunityType: "lending",
    opportunityId: `compx-lending-${market.appId}`,
    assetPair: baseSymbol,
    assetIds: [market.baseTokenId, market.lstTokenId],
    apy,
    tvlUsd,
    ...(Number.isFinite(market.borrowApy) ? { apr: market.borrowApy } : {}),
    ...buildSourceMetadata({
      fetchedAtIso,
      upstreamUnixSeconds: market.lastUpdateTimestamp,
      contextNotes: [
        `CompX lending market ${market.appId}; util=${market.utilizationRate.toFixed(1)}%; APR-derived yields.`
      ]
    })
  };
}

interface NormalizeCompxStakingOpportunityInput {
  pool: StakingPoolState;
  apr: number | null;
  stakedAsset: AssetInfo | undefined;
  rewardAsset: AssetInfo | undefined;
  stakedAssetPriceUsd: number | undefined;
  stakedDecimals: number;
  fetchedAtIso: string;
}

export function normalizeCompxStakingOpportunity(
  input: NormalizeCompxStakingOpportunityInput
): OpportunityRecordV1 | null {
  const {
    pool,
    apr,
    stakedAsset,
    rewardAsset,
    stakedAssetPriceUsd,
    stakedDecimals,
    fetchedAtIso
  } = input;

  if (apr === null || !Number.isFinite(apr) || apr <= 0) {
    return null;
  }

  const tvlUsd = computeStakingTvlUsd(pool.totalStaked, stakedDecimals, stakedAssetPriceUsd);
  if (!Number.isFinite(tvlUsd) || tvlUsd <= 0) {
    return null;
  }

  const assetById = new Map<number, AssetInfo>();
  if (stakedAsset) {
    assetById.set(pool.stakedAssetId, stakedAsset);
  }
  if (rewardAsset) {
    assetById.set(pool.rewardAssetId, rewardAsset);
  }

  const stakedSymbol = resolveAssetSymbol(pool.stakedAssetId, assetById);
  const rewardSymbol = resolveAssetSymbol(pool.rewardAssetId, assetById);
  const assetPair =
    pool.stakedAssetId === pool.rewardAssetId
      ? stakedSymbol
      : `${stakedSymbol}/${rewardSymbol}`;

  return {
    protocol: "compx",
    opportunityType: "staking",
    opportunityId: `compx-staking-${pool.appId}`,
    assetPair,
    assetIds: [pool.stakedAssetId, pool.rewardAssetId],
    apy: apr,
    apr,
    tvlUsd,
    ...buildSourceMetadata({
      fetchedAtIso,
      upstreamUnixSeconds: pool.lastUpdateTime,
      contextNotes: [
        `CompX staking pool ${pool.appId}; APR estimate; rewardsRemaining=${pool.rewardsRemaining.toString()}.`
      ]
    })
  };
}

function resolveDependencies(): CompXSdkDependencies {
  const network = resolveNetwork();
  const fallbackOracleAppId = resolveFallbackOracleAppId(network);

  return {
    createAlgodClient: createCompXAlgodClient,
    createSdk: (algodClient) => {
      const masterRepoAppId = resolveMasterRepoAppId(network);
      return new CompXSDK(
        masterRepoAppId === undefined
          ? { algodClient, network }
          : { algodClient, network, masterRepoAppId }
      );
    },
    network,
    getAllMarketsFn: async function (this: CompXSDK["lending"]) {
      return this.getAllMarkets();
    },
    getAllPoolsFn: async function (this: CompXSDK["staking"]) {
      return this.getAllPools();
    },
    getAssetsInfoFn: async function (this: CompXSDK["lending"], assetIds: number[]) {
      return this.getAssetsInfo(assetIds);
    },
    getPoolAprFn: async function (
      this: CompXSDK["staking"],
      appId: number,
      options: Parameters<GetPoolAprFn>[1]
    ) {
      return this.getPoolApr(appId, options);
    },
    getOraclePricesFn: async function (this: CompXSDK["lending"], oracleAppId, assetIds) {
      const prices = await this.getOraclePrices(oracleAppId, assetIds);
      const mapped = new Map<number, { price: number }>();
      for (const [assetId, oraclePrice] of prices.entries()) {
        mapped.set(assetId, { price: oraclePrice.price });
      }
      return mapped;
    },
    fallbackOracleAppId,
    onlyActive: parseBoolean(process.env.COMPX_ONLY_ACTIVE, true),
    ...compxSdkDependencyOverrides
  };
}

function createCompXAlgodClient(): Algodv2 {
  const server =
    process.env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud";
  const token = process.env.X402_ALGOD_TOKEN ?? "";
  return new algosdk.Algodv2(token, trimTrailingSlash(server), "");
}

function resolveNetwork(): Network {
  const configured = process.env.COMPX_NETWORK?.trim().toLowerCase();
  if (configured === "testnet") {
    return "testnet";
  }
  return "mainnet";
}

function resolveMasterRepoAppId(network: Network): number | undefined {
  const configured = process.env.COMPX_MASTER_REPO_APP_ID;
  if (configured !== undefined && configured.length > 0) {
    const parsed = Number(configured);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return network === "testnet" ? 757005603 : undefined;
}

function resolveFallbackOracleAppId(network: Network): number {
  const configured = process.env.COMPX_ORACLE_APP_ID;
  if (configured !== undefined && configured.length > 0) {
    const parsed = Number(configured);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return network === "testnet" ? 755669660 : 3307588794;
}

function collectUniqueAssetIds(
  markets: MarketData[],
  pools: StakingPoolState[]
): number[] {
  const ids = new Set<number>();
  for (const market of markets) {
    ids.add(market.baseTokenId);
    ids.add(market.lstTokenId);
  }
  for (const pool of pools) {
    ids.add(pool.stakedAssetId);
    ids.add(pool.rewardAssetId);
  }
  return [...ids];
}

function buildOracleAppIdMap(
  markets: MarketData[],
  fallbackOracleAppId: number
): Map<number, number> {
  const map = new Map<number, number>();
  for (const market of markets) {
    if (market.oracleAppId > 0) {
      map.set(market.baseTokenId, market.oracleAppId);
    }
  }

  if (fallbackOracleAppId > 0) {
    map.set(-1, fallbackOracleAppId);
  }

  return map;
}

async function resolveAssetPrices(
  getOraclePricesFn: GetOraclePricesFn,
  oracleAppIds: Map<number, number>,
  assetIds: number[]
): Promise<Map<number, number>> {
  const priceByAssetId = new Map<number, number>();
  const grouped = new Map<number, number[]>();

  for (const assetId of assetIds) {
    const oracleAppId = oracleAppIds.get(assetId) ?? oracleAppIds.get(-1);
    if (!oracleAppId) {
      continue;
    }
    const existing = grouped.get(oracleAppId);
    if (existing) {
      existing.push(assetId);
      continue;
    }
    grouped.set(oracleAppId, [assetId]);
  }

  await Promise.all(
    [...grouped.entries()].map(async ([oracleAppId, ids]) => {
      try {
        const prices = await getOraclePricesFn(oracleAppId, ids);
        for (const [assetId, price] of prices.entries()) {
          if (Number.isFinite(price.price) && price.price > 0) {
            priceByAssetId.set(assetId, price.price);
          }
        }
      } catch {
        // Missing oracle prices are handled by downstream filters.
      }
    })
  );

  return priceByAssetId;
}

function passesActiveFilter(contractState: number, onlyActive: boolean): boolean {
  if (!onlyActive) {
    return true;
  }
  return contractState === 1;
}

function passesStakingActiveFilter(pool: StakingPoolState, onlyActive: boolean): boolean {
  if (!onlyActive) {
    return true;
  }

  const now = Math.floor(Date.now() / 1000);
  return (
    pool.contractState === 1 &&
    pool.initialized &&
    pool.rewardsFunded &&
    pool.endTime > now
  );
}

function computeStakingTvlUsd(
  totalStaked: bigint,
  stakedDecimals: number,
  stakedAssetPriceUsd: number | undefined
): number {
  if (stakedAssetPriceUsd === undefined || !Number.isFinite(stakedAssetPriceUsd)) {
    return Number.NaN;
  }

  const totalStakedTokens = formatAmount(totalStaked, stakedDecimals);
  return totalStakedTokens * stakedAssetPriceUsd;
}

function resolveAssetSymbol(assetId: number, assetById: Map<number, AssetInfo>): string {
  if (assetId === 0) {
    return "ALGO";
  }

  const asset = assetById.get(assetId);
  if (asset?.unitName) {
    return asset.unitName;
  }
  if (asset?.name) {
    return asset.name;
  }

  return `ASSET-${assetId}`;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function trimTrailingSlash(value: string): string {
  if (value.endsWith("/")) {
    return value.slice(0, -1);
  }
  return value;
}
