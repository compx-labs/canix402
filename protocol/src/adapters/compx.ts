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
type GetTokenPricesFn = (assetIds: number[]) => Promise<Record<string, number>>;

interface CompXSdkDependencies {
  createAlgodClient: () => Algodv2;
  createSdk: (algodClient: Algodv2) => CompXSDK;
  network: Network;
  getAllMarketsFn: GetAllMarketsFn;
  getAllPoolsFn: GetAllPoolsFn;
  getAssetsInfoFn: GetAssetsInfoFn;
  getPoolAprFn: GetPoolAprFn;
  getTokenPricesFn: GetTokenPricesFn;
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

    const markets = await dependencies.getAllMarketsFn.call(sdk.lending);
    const pools = await dependencies.getAllPoolsFn.call(sdk.staking);

    const assetIds = collectUniqueAssetIds(markets, pools);
    const assets = await dependencies.getAssetsInfoFn.call(
      sdk.lending,
      assetIds
    );
    const decimalsByAssetId = await resolveAssetDecimals(
      assetIds,
      algodClient
    );
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));

    const priceableStakingAssetIds = collectOraclePriceableAssetIds(markets, pools);
    const priceByAssetId = await resolveAssetPrices(
      dependencies.getTokenPricesFn.bind(sdk.pricing),
      priceableStakingAssetIds
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

    const stakingOpportunities: OpportunityRecordV1[] = [];
    for (const pool of pools.filter((candidate) =>
      passesStakingActiveFilter(candidate, dependencies.onlyActive)
    )) {
      const stakedDecimals = decimalsByAssetId.get(pool.stakedAssetId);
      const rewardDecimals = decimalsByAssetId.get(pool.rewardAssetId);
      // Both staked and reward decimals must come from chain: staked
      // decimals drive TVL, reward decimals drive the APR estimate.
      // Guessing either produces materially wrong yields, so drop the row.
      if (stakedDecimals === undefined || rewardDecimals === undefined) {
        continue;
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

      const apr = await dependencies.getPoolAprFn.call(
        sdk.staking,
        pool.appId,
        aprOptions
      );
      const opportunity = normalizeCompxStakingOpportunity({
        pool,
        apr,
        stakedAsset,
        rewardAsset,
        stakedAssetPriceUsd,
        stakedDecimals,
        fetchedAtIso: fetchedAt
      });
      if (opportunity !== null) {
        stakingOpportunities.push(opportunity);
      }
    }

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
    yieldBasis: "apr",
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
    yieldBasis: "apr",
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

  return {
    createAlgodClient: createCompXAlgodClient,
    createSdk: (algodClient) => {
      const masterRepoAppId = resolveMasterRepoAppId(network);
      const pricingApiUrl = resolvePricingApiUrl();
      return new CompXSDK(
        {
          algodClient,
          network,
          ...(masterRepoAppId === undefined ? {} : { masterRepoAppId }),
          ...(pricingApiUrl === undefined ? {} : { pricing: { apiUrl: pricingApiUrl } })
        }
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
    getTokenPricesFn: async function (this: CompXSDK["pricing"], assetIds) {
      return this.getTokenPrices(assetIds);
    },
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

function resolvePricingApiUrl(): string | undefined {
  const configured = process.env.COMPX_PRICING_API_URL?.trim();
  return configured && configured.length > 0 ? configured : undefined;
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

/**
 * Prices are only needed for staking APR/TVL calculations. Lending
 * opportunities already receive USD totals from the SDK. In particular, an
 * LST/cAsset has no CompX pricing entry and must never be price-queried.
 */
function collectOraclePriceableAssetIds(
  markets: MarketData[],
  pools: StakingPoolState[]
): number[] {
  const cAssetIds = new Set(markets.map((market) => market.lstTokenId));
  const ids = new Set<number>();

  for (const pool of pools) {
    if (!cAssetIds.has(pool.stakedAssetId)) {
      ids.add(pool.stakedAssetId);
    }
    if (!cAssetIds.has(pool.rewardAssetId)) {
      ids.add(pool.rewardAssetId);
    }
  }

  return [...ids];
}

async function resolveAssetPrices(
  getTokenPricesFn: GetTokenPricesFn,
  assetIds: number[]
): Promise<Map<number, number>> {
  const priceByAssetId = new Map<number, number>();
  if (assetIds.length === 0) {
    return priceByAssetId;
  }

  try {
    const prices = await getTokenPricesFn(assetIds);
    for (const [assetId, price] of Object.entries(prices)) {
      const numericAssetId = Number(assetId);
      if (
        Number.isInteger(numericAssetId) &&
        Number.isFinite(price) &&
        price > 0
      ) {
        priceByAssetId.set(numericAssetId, price);
      }
    }
  } catch {
    // Missing pricing data is handled by downstream filters.
  }

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
