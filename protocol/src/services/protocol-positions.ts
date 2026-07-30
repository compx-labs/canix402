import algosdk, { Algodv2 } from "algosdk";
import {
  ConsensusState,
  MainnetConsensusConfig,
  MainnetDepositsAppId,
  MainnetLoans,
  MainnetOracle,
  MainnetPoolManagerAppId,
  MainnetPools,
  getConsensusState,
  retrieveUserDepositsFullInfo,
  retrieveUserLoansInfo
} from "@folks-finance/algorand-sdk";
import { makeFarmFromRawState } from "@pactfi/pactsdk";
import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import { DualStake } from "@myth-finance/dualstake-ts-sdk";

import {
  FOLKS_XALGO_STAKING_OPPORTUNITY_ID,
  HAYSTACK_STAKING_OPPORTUNITY_ID,
  HAY_ASSET_ID,
  USDC_ASSET_ID,
  TINYMAN_STALGO_STAKING_OPPORTUNITY_ID,
  TINYMAN_TALGO_STAKING_OPPORTUNITY_ID,
  fetchCompXOpportunities,
  fetchCompXTokenPrices,
  mythStakingOpportunityId,
  retiStakingOpportunityId,
  MYTH_DS_REGISTRY_APP_ID,
  MYTH_TINYMAN_APP_ID,
  MYTH_ARC59_ROUTER_APP_ID,
  MYTH_SIMULATE_SENDER,
  RETI_VALIDATOR_REGISTRY_APP_ID
} from "../adapters/index.js";
import {
  retiGetStakedPoolsForAccount,
  retiGetStakerInfo,
  retiGetValidatorConfig
} from "../reti/abi.js";
import {
  STALGO_ASSET_ID,
  TALGO_ASSET_ID
} from "../execution/shapes/tinyman/liquid-stake-state.js";
import {
  HAYSTACK_STAKING_APP_ID
} from "../execution/shapes/haystack/constants.js";
import {
  createStakerBoxName
} from "../execution/shapes/haystack/staking-spec.js";
import {
  getStakerBoxRecord
} from "../execution/shapes/haystack/shared.js";
import {
  resolveCompXLendingMarketState
} from "../execution/shapes/compx/market-state.js";
import {
  resolveCompXStakingPoolState
} from "../execution/shapes/compx/pool-state.js";
import {
  underlyingFromScaledDeposits
} from "../execution/shapes/dorkfi/abi.js";
import {
  buildDorkFiLendingOpportunityId,
  DORKFI_ALGORAND_ASA_MARKETS
} from "../execution/shapes/dorkfi/market-catalog.js";
import {
  resolveDorkFiLendingMarketState
} from "../execution/shapes/dorkfi/market-state.js";
import type { OpportunityMarketRecord } from "../types/opportunity.js";
import type { PositionMarketRecord } from "./position-execution-shapes.js";
import { resolveAssetDecimals } from "./asset-decimals.js";
import {
  createRequestGate,
  mapWithThrottle,
  type RequestGate,
  withAlgodRequestGate
} from "./request-throttle.js";
import {
  getHeldWalletAssetIds,
  getWalletAssetBalance,
  getWalletLocalAppIds,
  type WalletSnapshot
} from "./wallet-snapshot.js";

export interface ProtocolPositionsCollection {
  positions: PositionMarketRecord[];
  warnings: string[];
  coverage?: {
    suppliedUsdComplete: boolean;
    borrowedUsdComplete: boolean;
    rewardsUsdComplete: boolean;
  };
}

export interface PositionCollectionContext {
  algodRequestGate: RequestGate;
}

export type PositionCollector = (
  address: string,
  snapshot: WalletSnapshot,
  context: PositionCollectionContext
) => Promise<ProtocolPositionsCollection>;

export async function collectTinymanPositions(
  address: string,
  snapshot: WalletSnapshot
): Promise<ProtocolPositionsCollection> {
  const positions: PositionMarketRecord[] = [];
  const warnings: string[] = [];
  const heldAssetIds = getHeldWalletAssetIds(snapshot);

  const [poolsResult, farmResult] = await Promise.allSettled([
    heldAssetIds.length > 0
      ? fetchTinymanPoolsForLiquidityAssets(heldAssetIds)
      : Promise.resolve([] as TinymanPositionPool[]),
    fetchTinymanCommittedFarmPrograms(address)
  ]);

  let farmPools: TinymanFarmPoolProgram[] = [];
  let farmRewardsComplete = true;
  if (farmResult.status === "fulfilled") {
    farmPools = farmResult.value;
  } else {
    farmRewardsComplete = false;
    warnings.push(
      `Tinyman farm rewards unavailable: ${errorMessage(farmResult.reason)}`
    );
  }

  const farmedLiquidityAssetIds = new Set<number>();
  const farmMetaByLiquidityAssetId = new Map<
    number,
    { programId: number; poolAddress: string }
  >();
  for (const farmPool of farmPools) {
    if (!tinymanPoolHasActiveFarmCommitment(farmPool)) {
      continue;
    }
    const liquidityAssetId = parseSafePositiveInteger(
      farmPool.liquidity_asset?.id
    );
    if (liquidityAssetId !== null) {
      farmedLiquidityAssetIds.add(liquidityAssetId);
      const poolAddress = farmPool.address;
      for (const program of farmPool.programs ?? []) {
        if (
          program.pooler?.current_cycle_commitment == null &&
          program.pooler?.next_cycle_commitment == null
        ) {
          continue;
        }
        const programId = parseSafePositiveInteger(program.staking_program?.id);
        if (programId !== null && poolAddress) {
          farmMetaByLiquidityAssetId.set(liquidityAssetId, {
            programId,
            poolAddress
          });
          break;
        }
      }
    }
  }

  if (poolsResult.status === "rejected") {
    warnings.push(
      `Tinyman LP positions unavailable: ${errorMessage(poolsResult.reason)}`
    );
  } else {
    for (const pool of poolsResult.value) {
      const liquidityAssetId = parseSafePositiveInteger(pool.liquidity_asset?.id);
      if (liquidityAssetId === null) {
        warnings.push(`${pool.address ?? "unknown pool"}: invalid LP asset id`);
        continue;
      }
      const lpBalance = getWalletAssetBalance(snapshot, liquidityAssetId);
      if (lpBalance === 0n) {
        continue;
      }
      const issued = parseUnsignedBigInt(pool.current_issued_liquidity_assets);
      const tvlUsd = parseNullableNonNegativeNumber(pool.liquidity_in_usd);
      const decimals = parseNonNegativeInteger(pool.liquidity_asset?.decimals) ?? 6;
      const pair = tinymanPoolPair(pool);
      const isFarmed = farmedLiquidityAssetIds.has(liquidityAssetId);
      const farmMeta = farmMetaByLiquidityAssetId.get(liquidityAssetId);
      positions.push({
        protocol: "tinyman",
        positionType: "lp",
        positionId: `tinyman:lp:${liquidityAssetId}`,
        opportunityId: pool.address ? `${pool.address}:lp` : null,
        assetId: liquidityAssetId,
        assetSymbol: `${pair} LP`,
        amountRaw: lpBalance.toString(),
        amount: formatUnits(lpBalance, decimals),
        usdValue:
          tvlUsd === null
            ? null
            : proportionalUsd(tvlUsd, lpBalance, issued),
        notes: isFarmed
          ? [
              "LP-token claim; underlying reserve composition changes with pool state.",
              farmMeta !== undefined
                ? `Farm programId=${farmMeta.programId}; poolAddress=${farmMeta.poolAddress}; uncommit with commitAmount=0.`
                : "Committed to a Tinyman farm; uncommit with commitAmount=0."
            ].join(" ")
          : "LP-token claim; underlying reserve composition changes with pool state.",
        ...(isFarmed
          ? {
              caveats: [
                "Committed to Tinyman farm staking; farm stakes the full wallet LP balance."
              ]
            }
          : {})
      });
    }
  }

  const pendingRewardAssets = new Map<number, TinymanSimpleAsset>();
  for (const farmPool of farmPools) {
    for (const program of farmPool.programs ?? []) {
      const pendingRaw = parseUnsignedBigInt(program.pooler?.rewards?.pending);
      if (pendingRaw === null || pendingRaw === 0n) {
        continue;
      }
      const rewardAsset = program.staking_program?.reward_asset;
      const rewardAssetId = parseSafeNonNegativeInteger(rewardAsset?.id);
      if (rewardAssetId === null || rewardAsset === undefined) {
        warnings.push(
          `${farmPool.address ?? "unknown pool"}:farm: missing reward asset`
        );
        farmRewardsComplete = false;
        continue;
      }
      pendingRewardAssets.set(rewardAssetId, rewardAsset);
    }
  }

  let rewardPrices = new Map<number, number | null>();
  if (pendingRewardAssets.size > 0) {
    try {
      rewardPrices = await fetchTinymanAssetUsdPrices([
        ...pendingRewardAssets.keys()
      ]);
    } catch (error) {
      farmRewardsComplete = false;
      warnings.push(
        `Tinyman farm reward USD pricing unavailable: ${errorMessage(error)}`
      );
    }
  }

  for (const farmPool of farmPools) {
    const poolAddress = farmPool.address;
    for (const program of farmPool.programs ?? []) {
      const pendingRaw = parseUnsignedBigInt(program.pooler?.rewards?.pending);
      if (pendingRaw === null || pendingRaw === 0n) {
        continue;
      }
      const programId = parseSafePositiveInteger(program.staking_program?.id);
      const rewardAsset = program.staking_program?.reward_asset;
      const rewardAssetId = parseSafeNonNegativeInteger(rewardAsset?.id);
      if (programId === null || rewardAssetId === null || rewardAsset === undefined) {
        continue;
      }
      const decimals = parseNonNegativeInteger(rewardAsset.decimals) ?? 6;
      const priceUsd = rewardPrices.get(rewardAssetId) ?? null;
      positions.push({
        protocol: "tinyman",
        positionType: "reward",
        positionId: `tinyman:reward:${poolAddress ?? "unknown"}:${programId}:${rewardAssetId}`,
        opportunityId: poolAddress ? `${poolAddress}:farm` : null,
        assetId: rewardAssetId,
        assetSymbol: rewardAsset.unit_name ?? rewardAsset.name ?? null,
        amountRaw: pendingRaw.toString(),
        amount: formatUnits(pendingRaw, decimals),
        usdValue: tokenUsdValue(pendingRaw, decimals, priceUsd),
        caveats: ["Unclaimed Tinyman farm reward (pending / unpaid)."],
        // Claim shape accepts poolId as poolAddress; host synthesis should not scrape positionId.
        inputHints: {
          programId,
          ...(poolAddress ? { poolId: poolAddress } : {}),
          assetId: rewardAssetId
        }
      });
    }
  }

  const hasUnpricedRewards = positions.some(
    (position) =>
      position.positionType === "reward" && position.usdValue === null
  );
  if (hasUnpricedRewards) {
    if (farmRewardsComplete) {
      warnings.push("Tinyman farm reward USD pricing is unavailable.");
    }
    farmRewardsComplete = false;
  }

  const liquidStake = await collectTinymanTAlgoWalletPosition(snapshot);
  positions.push(...liquidStake.positions);
  warnings.push(...liquidStake.warnings);

  const restake = await collectTinymanStAlgoWalletPosition(snapshot);
  positions.push(...restake.positions);
  warnings.push(...restake.warnings);

  return {
    positions,
    warnings,
    coverage: {
      suppliedUsdComplete:
        poolsResult.status === "fulfilled" &&
        positions
          .filter((position) =>
            ["supplied", "lp", "staked"].includes(position.positionType)
          )
          .every((position) => position.usdValue !== null),
      borrowedUsdComplete: true,
      rewardsUsdComplete: farmRewardsComplete && !hasUnpricedRewards
    }
  };
}

interface TinymanSimpleAsset {
  id?: number | string | null;
  unit_name?: string | null;
  name?: string | null;
  decimals?: number | string | null;
}

interface TinymanPositionPool {
  address?: string;
  asset_1?: TinymanSimpleAsset;
  asset_2?: TinymanSimpleAsset;
  liquidity_asset?: TinymanSimpleAsset;
  current_issued_liquidity_assets?: number | string | null;
  liquidity_in_usd?: number | string | null;
  is_verified?: boolean | null;
}

interface TinymanFarmPoolProgram {
  address?: string;
  liquidity_asset?: TinymanSimpleAsset;
  programs?: Array<{
    staking_program?: {
      id?: number | string | null;
      reward_asset?: TinymanSimpleAsset;
    };
    pooler?: {
      rewards?: {
        pending?: number | string | null;
      };
      current_cycle_commitment?: unknown;
      next_cycle_commitment?: unknown;
    };
  }>;
}

function tinymanPoolHasActiveFarmCommitment(
  farmPool: TinymanFarmPoolProgram
): boolean {
  return (farmPool.programs ?? []).some(
    (program) =>
      program.pooler?.current_cycle_commitment != null ||
      program.pooler?.next_cycle_commitment != null
  );
}

function tinymanApiBaseUrl(): string {
  return trimTrailingSlash(
    process.env.TINYMAN_API_BASE_URL ??
      "https://mainnet.analytics.tinyman.org/api/v1"
  );
}

function tinymanRequestInit(): RequestInit {
  const apiKey = process.env.TINYMAN_API_KEY;
  if (!apiKey) {
    return {};
  }
  return { headers: { authorization: `Bearer ${apiKey}` } };
}

async function fetchTinymanPoolsForLiquidityAssets(
  assetIds: readonly number[]
): Promise<TinymanPositionPool[]> {
  const chunks = chunkValues(assetIds, 100);
  const poolsByChunk: TinymanPositionPool[][] = new Array(chunks.length);
  await mapWithThrottle(
    chunks.map((chunk, index) => ({ chunk, index })),
    {
      concurrency: readPositiveInteger(
        process.env.POSITIONS_HTTP_CONCURRENCY,
        2
      ),
      delayMs: 0
    },
    async ({ chunk, index }) => {
      const query = new URLSearchParams({
        with_statistics: "true",
        limit: "all",
        version__in: process.env.TINYMAN_POOL_VERSIONS ?? "1.1,2.0",
        liquidity_asset_ids: chunk.join(",")
      });
      const response = await fetch(
        `${tinymanApiBaseUrl()}/pools/?${query.toString()}`,
        tinymanRequestInit()
      );
      if (!response.ok) {
        throw new Error(`Tinyman positions API returned HTTP ${response.status}.`);
      }
      const payload = (await response.json()) as {
        results?: TinymanPositionPool[];
      };
      poolsByChunk[index] = (payload.results ?? []).filter(
        (pool) => pool.is_verified === true
      );
    }
  );
  return poolsByChunk.flat();
}

async function fetchTinymanCommittedFarmPrograms(
  poolerAddress: string
): Promise<TinymanFarmPoolProgram[]> {
  const query = new URLSearchParams({
    limit: "all",
    pooler_address: poolerAddress,
    committed_only: "true"
  });
  const response = await fetch(
    `${tinymanApiBaseUrl()}/staking/pool-programs/?${query.toString()}`,
    tinymanRequestInit()
  );
  if (!response.ok) {
    throw new Error(
      `Tinyman farm pool-programs API returned HTTP ${response.status}.`
    );
  }
  const payload = (await response.json()) as {
    results?: TinymanFarmPoolProgram[];
  };
  return payload.results ?? [];
}

async function fetchTinymanAssetUsdPrices(
  assetIds: readonly number[]
): Promise<Map<number, number | null>> {
  const prices = new Map<number, number | null>();
  await mapWithThrottle(
    [...new Set(assetIds)],
    {
      concurrency: readPositiveInteger(
        process.env.POSITIONS_HTTP_CONCURRENCY,
        2
      ),
      delayMs: 0
    },
    async (assetId) => {
      const response = await fetch(
        `${tinymanApiBaseUrl()}/assets/${assetId}/`,
        tinymanRequestInit()
      );
      if (!response.ok) {
        throw new Error(
          `Tinyman asset price API returned HTTP ${response.status} for asset ${assetId}.`
        );
      }
      const payload = (await response.json()) as {
        price_in_usd?: number | string | null;
      };
      prices.set(
        assetId,
        parseNullableNonNegativeNumber(payload.price_in_usd)
      );
    }
  );
  return prices;
}

function tinymanPoolPair(pool: TinymanPositionPool): string {
  const left =
    pool.asset_1?.unit_name ??
    pool.asset_1?.name ??
    assetFallback(pool.asset_1?.id);
  const right =
    pool.asset_2?.unit_name ??
    pool.asset_2?.name ??
    assetFallback(pool.asset_2?.id);
  return `${left}/${right}`;
}

function assetFallback(value: unknown): string {
  const parsed = parseSafeNonNegativeInteger(value);
  return parsed === null ? "unknown" : parsed === 0 ? "ALGO" : `ASSET-${parsed}`;
}

interface PactFarmLike {
  getUserStateFromAccountInfo: (
    accountInfo: unknown
  ) => { staked: number } | null | undefined;
  estimateAccruedRewards: (
    now: Date,
    // Pact SDK requires FarmUserState; mocks only need `{ staked }`.
    userState: { staked: number } & Record<string, unknown>
  ) => Record<number, number>;
  state: {
    stakedAsset: { index: number };
    rewardAssets: Array<{
      index: number;
      unitName?: string | null;
      name?: string | null;
    }>;
    updatedAt: Date;
  };
}

interface PactPositionCollectorDependencies {
  fetchFarm: (algod: Algodv2, farmAppId: number) => Promise<PactFarmLike>;
  fetchRewardUsdPrices: (
    assetIds: number[]
  ) => Promise<Record<string, number>>;
}

let pactPositionCollectorOverrides:
  | Partial<PactPositionCollectorDependencies>
  | undefined;

export function setPactPositionCollectorDependenciesForTests(
  overrides?: Partial<PactPositionCollectorDependencies>
): void {
  pactPositionCollectorOverrides = overrides;
  pactPositionCatalogCache = undefined;
  pactPositionCatalogInFlight = undefined;
}

function resolvePactFetchFarm(): PactPositionCollectorDependencies["fetchFarm"] {
  return (
    pactPositionCollectorOverrides?.fetchFarm ??
    ((algod, farmAppId) =>
      fetchPactFarmFromState(algod, farmAppId) as unknown as Promise<PactFarmLike>)
  );
}

export async function collectPactPositions(
  _address: string,
  snapshot: WalletSnapshot,
  context: PositionCollectionContext = createPositionCollectionContext()
): Promise<ProtocolPositionsCollection> {
  const algod = createAlgodClient(context.algodRequestGate);
  const catalog = await fetchPactPositionCatalog();
  const localAppIds = getWalletLocalAppIds(snapshot);
  const positions: PositionMarketRecord[] = [];
  const warnings: string[] = [];
  const rewardDecimalsByAssetId = new Map<number, number>();
  const fetchFarm = resolvePactFetchFarm();

  for (const pool of catalog.pools) {
    const liquidityAssetId = parseSafePositiveInteger(
      pool.pool_asset?.on_chain_id
    );
    const poolAppId = parseSafePositiveInteger(pool.on_chain_id);
    if (liquidityAssetId === null || poolAppId === null) {
      continue;
    }
    const lpBalance = getWalletAssetBalance(snapshot, liquidityAssetId);
    if (lpBalance === 0n) {
      continue;
    }
    const decimals =
      parseNonNegativeInteger(pool.pool_asset?.decimals) ?? 6;
    positions.push({
      protocol: "pact",
      positionType: "lp",
      positionId: `pact:lp:${liquidityAssetId}`,
      opportunityId: `${poolAppId}:lp`,
      assetId: liquidityAssetId,
      assetSymbol: `${pactPoolPair(pool)} LP`,
      amountRaw: lpBalance.toString(),
      amount: formatUnits(lpBalance, decimals),
      usdValue: tokenUsdValue(
        lpBalance,
        decimals,
        parseNullableNonNegativeNumber(pool.pool_asset?.price)
      ),
      notes: "LP-token claim; underlying reserve composition changes with pool state."
    });
  }

  const poolsByAppId = new Map(
    catalog.pools
      .map((pool) => [parseSafePositiveInteger(pool.on_chain_id), pool] as const)
      .filter(
        (entry): entry is readonly [number, PactPositionPool] =>
          entry[0] !== null
      )
  );
  const farmCandidates = catalog.farms.filter((record) => {
    const farmAppId = parseSafePositiveInteger(record.on_chain_id);
    return farmAppId !== null && localAppIds.has(farmAppId);
  });

  for (const record of farmCandidates) {
    const farmAppId = parseSafePositiveInteger(record.on_chain_id)!;
    try {
      const farm = await fetchFarm(algod, farmAppId);
      const userState = farm.getUserStateFromAccountInfo(snapshot.accountInfo);
      if (!userState || userState.staked <= 0) {
        continue;
      }
      const stakedRaw = safeSdkInteger(userState.staked, "Pact farm stake");
      const pool = poolsByAppId.get(
        parseSafePositiveInteger(record.pool) ?? -1
      );
      const stakedAssetId = farm.state.stakedAsset.index;
      const stakedDecimals =
        parseNonNegativeInteger(pool?.pool_asset?.decimals) ??
        (await resolveAssetDecimals([stakedAssetId], algod)).get(
          stakedAssetId
        ) ??
        6;
      positions.push({
        protocol: "pact",
        positionType: "staked",
        positionId: `pact:staked:${farmAppId}`,
        opportunityId: `${farmAppId}:farm`,
        assetId: stakedAssetId,
        assetSymbol:
          pool?.pool_asset?.unit_name ??
          pool?.pool_asset?.name ??
          `ASSET-${stakedAssetId}`,
        amountRaw: stakedRaw.toString(),
        amount: formatUnits(stakedRaw, stakedDecimals),
        usdValue: tokenUsdValue(
          stakedRaw,
          stakedDecimals,
          parseNullableNonNegativeNumber(pool?.pool_asset?.price)
        ),
        sourceTimestamp: farm.state.updatedAt.toISOString(),
        caveats: ["LP tokens are held in the wallet's Pact farm escrow."]
      });

      const rewards = farm.estimateAccruedRewards(new Date(), userState);
      for (const rewardAsset of farm.state.rewardAssets) {
        const reward = rewards[rewardAsset.index] ?? 0;
        if (reward <= 0) {
          continue;
        }
        const rewardRaw = safeSdkInteger(reward, "Pact farm reward");
        const rewardDecimals =
          (await resolveAssetDecimals([rewardAsset.index], algod)).get(
            rewardAsset.index
          ) ?? 0;
        rewardDecimalsByAssetId.set(rewardAsset.index, rewardDecimals);
        positions.push({
          protocol: "pact",
          positionType: "reward",
          positionId: `pact:reward:${farmAppId}:${rewardAsset.index}`,
          opportunityId: `${farmAppId}:farm`,
          assetId: rewardAsset.index,
          assetSymbol: rewardAsset.unitName ?? rewardAsset.name ?? null,
          amountRaw: rewardRaw.toString(),
          amount: formatUnits(rewardRaw, rewardDecimals),
          usdValue: null,
          sourceTimestamp: farm.state.updatedAt.toISOString(),
          caveats: ["Unclaimed Pact farm reward."]
        });
      }
    } catch (error) {
      warnings.push(`${farmAppId}:farm: ${errorMessage(error)}`);
    }
  }

  const farmReadFailures = warnings.length;
  const pendingRewardAssetIds = [
    ...new Set(
      positions
        .filter(
          (position) =>
            position.positionType === "reward" &&
            position.assetId !== null &&
            BigInt(position.amountRaw) > 0n
        )
        .map((position) => position.assetId as number)
    )
  ];

  if (pendingRewardAssetIds.length > 0) {
    try {
      const rewardPrices = await fetchPactFarmRewardUsdPrices(
        pendingRewardAssetIds
      );
      for (const position of positions) {
        if (
          position.positionType !== "reward" ||
          position.assetId === null ||
          position.usdValue !== null
        ) {
          continue;
        }
        const decimals =
          rewardDecimalsByAssetId.get(position.assetId) ?? 0;
        const priceUsd = rewardPrices.get(position.assetId) ?? null;
        position.usdValue = tokenUsdValue(
          BigInt(position.amountRaw),
          decimals,
          priceUsd
        );
        if (position.usdValue !== null) {
          position.notes =
            "USD valued via CompX/Tinyman asset price (Pact SDK has no reward USD).";
        }
      }
    } catch (error) {
      warnings.push(
        `Pact farm reward USD pricing unavailable: ${errorMessage(error)}`
      );
    }
  }

  const hasUnpricedRewards = positions.some(
    (position) => position.positionType === "reward" && position.usdValue === null
  );
  if (hasUnpricedRewards) {
    warnings.push("Pact farm reward USD pricing is unavailable.");
  }
  return {
    positions,
    warnings,
    coverage: {
      suppliedUsdComplete:
        farmReadFailures === 0 &&
        positions
          .filter((position) => position.positionType !== "reward")
          .every((position) => position.usdValue !== null),
      borrowedUsdComplete: true,
      rewardsUsdComplete: farmReadFailures === 0 && !hasUnpricedRewards
    }
  };
}

function usableUsdPrice(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

async function fetchPactFarmRewardUsdPrices(
  assetIds: readonly number[]
): Promise<Map<number, number | null>> {
  const uniqueIds = [...new Set(assetIds)];
  const prices = new Map<number, number | null>();
  for (const assetId of uniqueIds) {
    prices.set(assetId, null);
  }
  if (uniqueIds.length === 0) {
    return prices;
  }

  const override = pactPositionCollectorOverrides?.fetchRewardUsdPrices;
  if (override !== undefined) {
    const priced = await override(uniqueIds);
    for (const assetId of uniqueIds) {
      prices.set(assetId, usableUsdPrice(priced[String(assetId)]));
    }
    applyPactRewardPriceFallbacks(prices);
    return prices;
  }

  let pricedFromCompX = false;
  try {
    const priced = await fetchCompXTokenPrices(uniqueIds);
    pricedFromCompX = true;
    for (const assetId of uniqueIds) {
      prices.set(assetId, usableUsdPrice(priced[String(assetId)]));
    }
  } catch {
    // Fall through to Tinyman for all ids when CompX pricing fails.
  }

  const missing = uniqueIds.filter((assetId) => prices.get(assetId) === null);
  if (missing.length > 0) {
    try {
      const tinymanPrices = await fetchTinymanAssetUsdPrices(missing);
      for (const assetId of missing) {
        if (prices.get(assetId) !== null) {
          continue;
        }
        prices.set(assetId, usableUsdPrice(tinymanPrices.get(assetId)));
      }
    } catch (error) {
      if (!pricedFromCompX) {
        throw error;
      }
    }
  }

  applyPactRewardPriceFallbacks(prices);
  return prices;
}

function applyPactRewardPriceFallbacks(
  prices: Map<number, number | null>
): void {
  if (prices.has(USDC_ASSET_ID) && prices.get(USDC_ASSET_ID) === null) {
    prices.set(USDC_ASSET_ID, 1);
  }
}

interface PactPositionAsset {
  on_chain_id?: number | string;
  name?: string | null;
  unit_name?: string | null;
  decimals?: number | string | null;
  price?: number | string | null;
}

interface PactPositionPool {
  on_chain_id?: number | string;
  primary_asset?: PactPositionAsset;
  secondary_asset?: PactPositionAsset;
  pool_asset?: PactPositionAsset;
}

interface PactPositionFarm {
  on_chain_id?: number | string;
  pool?: number | string;
}

interface PactPositionCatalog {
  pools: PactPositionPool[];
  farms: PactPositionFarm[];
}

let pactPositionCatalogCache:
  | { expiresAt: number; value: PactPositionCatalog }
  | undefined;
let pactPositionCatalogInFlight: Promise<PactPositionCatalog> | undefined;

async function fetchPactPositionCatalog(): Promise<PactPositionCatalog> {
  const now = Date.now();
  if (pactPositionCatalogCache && pactPositionCatalogCache.expiresAt > now) {
    return pactPositionCatalogCache.value;
  }
  if (pactPositionCatalogInFlight !== undefined) {
    return pactPositionCatalogInFlight;
  }
  pactPositionCatalogInFlight = fetchPactPositionCatalogFromSource(now);
  try {
    return await pactPositionCatalogInFlight;
  } finally {
    pactPositionCatalogInFlight = undefined;
  }
}

async function fetchPactPositionCatalogFromSource(
  now: number
): Promise<PactPositionCatalog> {
  const baseUrl =
    process.env.PACT_API_BASE_URL ?? "https://api.pact.fi/api";
  const headers = process.env.PACT_API_KEY
    ? { authorization: `Bearer ${process.env.PACT_API_KEY}` }
    : undefined;
  const requestInit: RequestInit =
    headers === undefined ? {} : { headers };
  const [poolsResponse, farmsResponse] = await Promise.all([
    fetch(
      `${trimTrailingSlash(baseUrl)}/pools/all?ordering=-tvl_usd&deprecated=false`,
      requestInit
    ),
    fetch(
      `${trimTrailingSlash(baseUrl)}/farms/all?ordering=-tvl_usd`,
      requestInit
    )
  ]);
  if (!poolsResponse.ok) {
    throw new Error(`Pact pools API returned HTTP ${poolsResponse.status}.`);
  }
  const poolsPayload = (await poolsResponse.json()) as unknown;
  if (!farmsResponse.ok) {
    throw new Error(`Pact farms API returned HTTP ${farmsResponse.status}.`);
  }
  const farmsPayload = (await farmsResponse.json()) as unknown;
  const value = {
    pools: Array.isArray(poolsPayload)
      ? (poolsPayload as PactPositionPool[])
      : [],
    farms: Array.isArray(farmsPayload)
      ? (farmsPayload as PactPositionFarm[])
      : []
  };
  pactPositionCatalogCache = {
    expiresAt:
      now +
      readNonNegativeInteger(
        process.env.POSITIONS_CATALOG_TTL_MS,
        5 * 60 * 1000
      ),
    value
  };
  return value;
}

async function fetchPactFarmFromState(
  algod: Algodv2,
  farmAppId: number
) {
  const application = await algod.getApplicationByID(farmAppId).do();
  if (application.params === undefined) {
    throw new Error(`Pact farm ${farmAppId} returned no application params.`);
  }
  const rawState = decodeTealState(application.params.globalState);
  return makeFarmFromRawState(algod as never, farmAppId, rawState);
}

function decodeTealState(entries: unknown): Record<string, string | number> {
  if (!Array.isArray(entries)) {
    throw new Error("Application state is not an array.");
  }
  const result: Record<string, string | number> = {};
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const record = entry as {
      key?: unknown;
      value?: {
        bytes?: unknown;
        type?: unknown;
        uint?: unknown;
      };
    };
    const key =
      record.key instanceof Uint8Array
        ? Buffer.from(record.key).toString("utf8")
        : typeof record.key === "string"
          ? Buffer.from(record.key, "base64").toString("utf8")
          : null;
    if (key === null) {
      continue;
    }
    if (record.value?.type === 1) {
      result[key] =
        record.value.bytes instanceof Uint8Array
          ? Buffer.from(record.value.bytes).toString("base64")
          : typeof record.value?.bytes === "string"
            ? record.value.bytes
            : "";
    } else {
      result[key] =
        typeof record.value?.uint === "bigint"
          ? Number(record.value.uint)
          : typeof record.value?.uint === "number"
            ? record.value.uint
            : 0;
    }
  }
  return result;
}

function pactPoolPair(pool: PactPositionPool): string {
  const left =
    pool.primary_asset?.unit_name ??
    pool.primary_asset?.name ??
    assetFallback(pool.primary_asset?.on_chain_id);
  const right =
    pool.secondary_asset?.unit_name ??
    pool.secondary_asset?.name ??
    assetFallback(pool.secondary_asset?.on_chain_id);
  return `${left}/${right}`;
}

export async function collectFolksFinancePositions(
  address: string,
  snapshot: WalletSnapshot
): Promise<ProtocolPositionsCollection> {
  const indexer = createIndexerClient();
  const deposits = await retrieveUserDepositsFullInfo(
    indexer,
    MainnetPoolManagerAppId,
    MainnetDepositsAppId,
    MainnetPools,
    MainnetOracle,
    address
  );
  const loanSources = Object.entries(MainnetLoans);
  const settledLoans: Array<
    | PromiseSettledResult<{
        loanType: string;
        loans: Awaited<ReturnType<typeof retrieveUserLoansInfo>>;
      }>
    | undefined
  > = new Array(loanSources.length);
  await mapWithThrottle(
    loanSources.map(([loanType, loanAppId], index) => ({
      loanType,
      loanAppId,
      index
    })),
    {
      concurrency: readPositiveInteger(
        process.env.POSITIONS_INDEXER_CONCURRENCY,
        2
      ),
      delayMs: 0
    },
    async ({ loanType, loanAppId, index }) => {
      try {
        settledLoans[index] = {
          status: "fulfilled",
          value: {
            loanType,
            loans: await retrieveUserLoansInfo(
              indexer,
              loanAppId,
              MainnetPoolManagerAppId,
              MainnetOracle,
              address
            )
          }
        };
      } catch (reason) {
        settledLoans[index] = { status: "rejected", reason };
      }
    }
  );
  const completedLoanSources: PromiseSettledResult<{
    loanType: string;
    loans: Awaited<ReturnType<typeof retrieveUserLoansInfo>>;
  }>[] = [];
  for (const result of settledLoans) {
    if (result === undefined) {
      throw new Error("Folks Finance loan collector returned no result.");
    }
    completedLoanSources.push(result);
  }
  const poolsByAppId = new Map(
    Object.entries(MainnetPools).map(([symbol, pool]) => [
      pool.appId,
      { symbol, pool }
    ])
  );
  const positions: PositionMarketRecord[] = [];
  const warnings: string[] = [];

  for (const deposit of deposits) {
    for (const holding of deposit.holdings) {
      if (holding.fAssetBalance <= 0n) {
        continue;
      }
      const entry = poolsByAppId.get(holding.poolAppId);
      if (!entry) {
        warnings.push(`Unknown Folks fAsset ${holding.fAssetId}`);
        continue;
      }
      positions.push({
        protocol: "folks-finance",
        positionType: "supplied",
        positionId: `folks-finance:supplied:${deposit.escrowAddress}:${entry.pool.appId}`,
        opportunityId: `folks-lending-${entry.pool.appId}`,
        assetId: Number(entry.pool.assetId),
        assetSymbol: entry.symbol,
        amountRaw: holding.assetBalance.toString(),
        amount: formatUnits(holding.assetBalance, entry.pool.assetDecimals),
        usdValue: scaledUsd(holding.balanceValue, 14),
        notes: `Deposit escrow ${deposit.escrowAddress}.`
      });
    }
  }

  let failedLoanSources = 0;
  for (const result of completedLoanSources) {
    if (result.status === "rejected") {
      failedLoanSources += 1;
      warnings.push(`Folks loan source unavailable: ${errorMessage(result.reason)}`);
      continue;
    }
    for (const loan of result.value.loans) {
      const healthFactor = ratioOrNull(
        loan.totalEffectiveCollateralBalanceValue,
        loan.totalEffectiveBorrowBalanceValue
      );
      for (const collateral of loan.collaterals) {
        if (collateral.assetBalance <= 0n) {
          continue;
        }
        const entry = poolsByAppId.get(collateral.poolAppId);
        positions.push({
          protocol: "folks-finance",
          positionType: "supplied",
          positionId: `folks-finance:collateral:${loan.escrowAddress}:${collateral.poolAppId}`,
          opportunityId: `folks-lending-${collateral.poolAppId}`,
          assetId: collateral.assetId,
          assetSymbol: entry?.symbol ?? null,
          amountRaw: collateral.assetBalance.toString(),
          amount: formatUnits(
            collateral.assetBalance,
            entry?.pool.assetDecimals ?? 0
          ),
          usdValue: scaledUsd(collateral.balanceValue, 14),
          healthFactor,
          caveats: [
            `Collateral is held by loan escrow ${loan.escrowAddress}.`
          ]
        });
      }
      // Borrow/debt positions are intentionally omitted — canix402 does not
      // surface lending debt in portfolio responses.
    }
  }

  const liquidStake = await collectFolksXAlgoWalletPosition(snapshot);
  positions.push(...liquidStake.positions);
  warnings.push(...liquidStake.warnings);

  return {
    positions,
    warnings,
    coverage: {
      suppliedUsdComplete:
        failedLoanSources === 0 &&
        positions
          .filter((position) =>
            ["supplied", "lp", "staked"].includes(position.positionType)
          )
          .every((position) => position.usdValue !== null),
      borrowedUsdComplete: true,
      rewardsUsdComplete: true
    }
  };
}

export function setCompXPositionCollectorDependenciesForTests(
  _overrides?: unknown
): void {
  // CompX portfolio collection no longer reads per-user lending debt, so there
  // are no collector overrides to inject. Kept as a no-op for existing tests.
}

export async function collectCompXPositions(
  address: string,
  snapshot: WalletSnapshot,
  context: PositionCollectionContext = createPositionCollectionContext()
): Promise<ProtocolPositionsCollection> {
  const algod = createAlgodClient(context.algodRequestGate);
  const opportunities = await fetchCompXOpportunities({
    algodRequestGate: context.algodRequestGate
  });
  const walletHoldings = new Map(
    snapshot.assets.map((holding) => [holding.assetId, holding.amount])
  );
  walletHoldings.set(0, snapshot.amount);
  const positions: PositionMarketRecord[] = [];
  const warnings: string[] = [];
  const pendingRewardAssetIds = new Set<number>();
  const rewardDecimalsByAssetId = new Map<number, number>();

  await mapPositionCandidates(
    uniqueOpportunities(opportunities),
    async (opportunity) => {
      try {
        if (opportunity.opportunityType === "lending") {
          const appId = parseTrailingInteger(opportunity.opportunityId);
          if (appId === null) {
            throw new Error("invalid market application id");
          }

          const lstTokenId = opportunity.assetIds?.[1];
          const hasWalletLst =
            lstTokenId === undefined ||
            getWalletAssetBalance(snapshot, lstTokenId) > 0n;
          if (!hasWalletLst) {
            return;
          }

          const state = await resolveCompXLendingMarketState({
            network: "mainnet",
            algod,
            marketAppId: appId,
            userAddress: address,
            userAssetHoldings: walletHoldings
          });

          if (state.userLstBalance === 0n) {
            return;
          }
          const totalDeposits = BigInt(Math.trunc(state.market.totalDeposits));
          const circulating = BigInt(Math.trunc(state.market.circulatingLST));
          const suppliedRaw =
            circulating > 0n
              ? (state.userLstBalance * totalDeposits) / circulating
              : state.userLstBalance;
          positions.push({
            protocol: "compx",
            positionType: "supplied",
            positionId: `compx:supplied:${appId}`,
            opportunityId: opportunity.opportunityId,
            assetId: state.baseTokenId,
            assetSymbol: opportunity.assetPair,
            amountRaw: suppliedRaw.toString(),
            amount: formatUnits(suppliedRaw, state.market.baseTokenDecimals),
            usdValue: proportionalUsd(
              state.market.totalDepositsUSD,
              state.userLstBalance,
              circulating
            ),
            sourceTimestamp: opportunity.sourceTimestamp,
            notes:
              "Underlying claim derived from the cAsset share of circulating supply."
          });
          return;
        }
        if (opportunity.opportunityType === "staking") {
          const appId = parseTrailingInteger(opportunity.opportunityId);
          if (appId === null) {
            throw new Error("invalid staking pool application id");
          }
          const state = await resolveCompXStakingPoolState({
            network: "mainnet",
            algod,
            poolAppId: appId,
            userAddress: address,
            userAssetHoldings: walletHoldings
          });
          if (state.staker.stake === 0n) {
            return;
          }
          const assetIdsToResolve = [
            state.stakedAssetId,
            ...(state.rewardAssetId === state.stakedAssetId
              ? []
              : [state.rewardAssetId])
          ];
          const decimalsByAssetId = await resolveAssetDecimals(
            assetIdsToResolve,
            algod
          );
          const stakedDecimals = decimalsByAssetId.get(state.stakedAssetId);
          if (stakedDecimals === undefined) {
            throw new Error("could not resolve staked asset decimals");
          }
          positions.push({
            protocol: "compx",
            positionType: "staked",
            positionId: `compx:staked:${appId}`,
            opportunityId: opportunity.opportunityId,
            assetId: state.stakedAssetId,
            assetSymbol: opportunity.assetPair.split("/")[0] ?? null,
            amountRaw: state.staker.stake.toString(),
            amount: formatUnits(state.staker.stake, stakedDecimals),
            usdValue: proportionalUsd(
              opportunity.tvlUsd,
              state.staker.stake,
              state.pool.totalStaked
            ),
            sourceTimestamp: opportunity.sourceTimestamp
          });

          const pendingRaw = compxPendingStakingRewardRaw(
            state.staker.stake,
            state.pool.rewardPerToken,
            state.staker.rewardDebt
          );
          if (pendingRaw > 0n) {
            const rewardDecimals =
              decimalsByAssetId.get(state.rewardAssetId) ??
              (state.rewardAssetId === 0 ? 6 : undefined);
            if (rewardDecimals === undefined) {
              throw new Error("could not resolve reward asset decimals");
            }
            pendingRewardAssetIds.add(state.rewardAssetId);
            rewardDecimalsByAssetId.set(state.rewardAssetId, rewardDecimals);
            positions.push({
              protocol: "compx",
              positionType: "reward",
              positionId: `compx:reward:${appId}:${state.rewardAssetId}`,
              opportunityId: opportunity.opportunityId,
              assetId: state.rewardAssetId,
              assetSymbol:
                opportunity.assetPair.split("/")[1] ??
                opportunity.assetPair.split("/")[0] ??
                null,
              amountRaw: pendingRaw.toString(),
              amount: formatUnits(pendingRaw, rewardDecimals),
              usdValue: null,
              sourceTimestamp: opportunity.sourceTimestamp,
              notes:
                "Pending staking reward from stake * rewardPerToken / 1e15 - rewardDebt."
            });
          }
        }
      } catch (error) {
        warnings.push(`${opportunity.opportunityId}: ${errorMessage(error)}`);
      }
    }
  );

  if (pendingRewardAssetIds.size > 0) {
    try {
      const priced = await fetchCompXTokenPrices([...pendingRewardAssetIds]);
      for (const position of positions) {
        if (
          position.positionType !== "reward" ||
          position.assetId === null ||
          position.usdValue !== null
        ) {
          continue;
        }
        const priceUsd = priced[String(position.assetId)];
        const decimals = rewardDecimalsByAssetId.get(position.assetId);
        if (
          priceUsd === undefined ||
          decimals === undefined ||
          !Number.isFinite(priceUsd) ||
          priceUsd < 0
        ) {
          continue;
        }
        position.usdValue = tokenUsdValue(
          BigInt(position.amountRaw),
          decimals,
          priceUsd
        );
      }
    } catch (error) {
      warnings.push(
        `CompX staking reward USD pricing unavailable: ${errorMessage(error)}`
      );
    }
  }

  const sourceWarnings = [...warnings];
  const hasUnpricedRewards = positions.some(
    (position) =>
      position.positionType === "reward" && position.usdValue === null
  );
  if (hasUnpricedRewards) {
    warnings.push("CompX staking reward USD pricing is unavailable.");
  }
  throwIfEveryCandidateFailed(
    "CompX",
    opportunities.length,
    positions,
    sourceWarnings
  );
  return {
    positions,
    warnings,
    coverage: {
      suppliedUsdComplete:
        sourceWarnings.length === 0 &&
        positions
          .filter((position) =>
            ["supplied", "lp", "staked"].includes(position.positionType)
          )
          .every((position) => position.usdValue !== null),
      borrowedUsdComplete: true,
      rewardsUsdComplete: !hasUnpricedRewards
    }
  };
}

/** CompX staking MasterChef precision (`PRECISION` in staking.algo.ts). */
const COMPX_STAKING_REWARD_PRECISION = 1_000_000_000_000_000n;

function compxPendingStakingRewardRaw(
  stake: bigint,
  rewardPerToken: bigint,
  rewardDebt: bigint
): bigint {
  if (stake <= 0n || rewardPerToken < 0n || rewardDebt < 0n) {
    return 0n;
  }
  const accrued = (stake * rewardPerToken) / COMPX_STAKING_REWARD_PRECISION;
  return accrued > rewardDebt ? accrued - rewardDebt : 0n;
}

export async function collectDorkFiPositions(
  address: string,
  snapshot: WalletSnapshot,
  context: PositionCollectionContext = createPositionCollectionContext()
): Promise<ProtocolPositionsCollection> {
  const deps = resolveDorkFiPositionCollectorDependencies();

  let onChain: ProtocolPositionsCollection;
  try {
    onChain = await collectDorkFiOnChainSupply(address, snapshot, context);
  } catch (onChainError) {
    onChain = {
      positions: [],
      warnings: [
        `Dork.fi on-chain ASA supply unavailable: ${compactErrorMessage(onChainError)}`
      ]
    };
  }

  let indexed: ProtocolPositionsCollection;
  try {
    indexed = await deps.fetchIndexedPositions(address);
  } catch {
    // Indexed USD aggregates are optional. Never surface debt/health warnings —
    // borrow/debt is out of scope for portfolio responses.
    if (
      onChain.positions.length === 0 &&
      onChain.warnings.some((warning) =>
        warning.includes("on-chain ASA supply unavailable")
      )
    ) {
      throw new Error(
        `Dork.fi on-chain ASA supply unavailable: ${onChain.warnings.join("; ")}`
      );
    }
    return {
      positions: onChain.positions,
      warnings: onChain.warnings.filter(
        (warning) => !warning.includes("on-chain ASA supply unavailable")
      ),
      coverage: {
        suppliedUsdComplete:
          onChain.coverage?.suppliedUsdComplete ??
          onChain.positions.every((position) => position.usdValue !== null),
        borrowedUsdComplete: true,
        rewardsUsdComplete: true
      }
    };
  }

  // ASA market rows first (executable); indexed USD supply second (informational).
  return {
    positions: [...onChain.positions, ...indexed.positions],
    warnings: [...onChain.warnings, ...indexed.warnings],
    coverage: {
      suppliedUsdComplete: indexed.coverage?.suppliedUsdComplete ?? true,
      borrowedUsdComplete: true,
      rewardsUsdComplete: true
    }
  };
}

interface DorkFiPositionCollectorDependencies {
  fetchIndexedPositions: (
    address: string
  ) => Promise<ProtocolPositionsCollection>;
  resolveMarketState: typeof resolveDorkFiLendingMarketState;
}

let dorkFiPositionCollectorOverrides:
  | Partial<DorkFiPositionCollectorDependencies>
  | undefined;

export function setDorkFiPositionCollectorDependenciesForTests(
  overrides?: Partial<DorkFiPositionCollectorDependencies>
): void {
  dorkFiPositionCollectorOverrides = overrides;
}

function resolveDorkFiPositionCollectorDependencies(): DorkFiPositionCollectorDependencies {
  return {
    fetchIndexedPositions: fetchDorkFiIndexedPositions,
    resolveMarketState: resolveDorkFiLendingMarketState,
    ...dorkFiPositionCollectorOverrides
  };
}

interface DorkFiHealthRecord {
  network?: unknown;
  appId?: unknown;
  totalCollateralValue?: unknown;
  totalBorrowValue?: unknown;
  healthFactor?: unknown;
  updatedAt?: unknown;
  lastUpdated?: unknown;
  lastUpdateTime?: unknown;
}

export function normalizeDorkFiHealthRecords(
  records: unknown
): ProtocolPositionsCollection {
  if (!Array.isArray(records)) {
    throw new Error("Dork.fi health API returned non-array data.");
  }
  const positions: PositionMarketRecord[] = [];
  const warnings: string[] = [];

  for (const raw of records) {
    if (typeof raw !== "object" || raw === null) {
      warnings.push("Dork.fi health API returned a malformed record.");
      continue;
    }
    const record = raw as DorkFiHealthRecord;
    if (record.network !== "algorand-mainnet") {
      continue;
    }
    const poolAppId = parseSafePositiveInteger(record.appId);
    const suppliedRaw = parseUnsignedBigInt(record.totalCollateralValue);
    const healthFactor = parseNullableNonNegativeNumber(record.healthFactor);
    // totalBorrowValue is ignored — debt/borrow positions are not surfaced.
    if (poolAppId === null || suppliedRaw === null) {
      warnings.push("Dork.fi health API returned an invalid Algorand record.");
      continue;
    }
    const sourceTimestamp = parseSourceTimestamp(
      record.updatedAt ?? record.lastUpdated ?? record.lastUpdateTime
    );
    const caveats = [
      "Pool-level USD value from the Dork.fi index; it is not an asset-level token amount.",
      "Not executable: use asset-level Dork.fi supplied rows for withdraw quotes."
    ];
    if (suppliedRaw > 0n) {
      positions.push({
        protocol: "dorkfi",
        positionType: "supplied",
        positionId: `dorkfi:supplied-usd:${poolAppId}`,
        opportunityId: null,
        assetId: null,
        assetSymbol: "USD",
        amountRaw: suppliedRaw.toString(),
        amount: formatUnits(suppliedRaw, 12),
        usdValue: scaledUsd(suppliedRaw, 12),
        healthFactor,
        ...(sourceTimestamp ? { sourceTimestamp } : {}),
        caveats
      });
    }
  }

  return {
    positions,
    warnings,
    coverage: {
      suppliedUsdComplete: warnings.length === 0,
      borrowedUsdComplete: true,
      rewardsUsdComplete: true
    }
  };
}

async function fetchDorkFiIndexedPositions(
  address: string
): Promise<ProtocolPositionsCollection> {
  const baseUrl =
    process.env.DORKFI_INDEXED_API_BASE_URL ??
    "https://dorkfi-api.nautilus.sh";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(
      `${trimTrailingSlash(baseUrl)}/user-health/user/${address}`,
      { signal: controller.signal }
    );
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      success?: unknown;
      data?: unknown;
    };
    if (payload.success !== true) {
      throw new Error("Dork.fi health API reported failure.");
    }
    return normalizeDorkFiHealthRecords(payload.data);
  } finally {
    clearTimeout(timeout);
  }
}

async function collectDorkFiOnChainSupply(
  address: string,
  snapshot: WalletSnapshot,
  context: PositionCollectionContext
): Promise<ProtocolPositionsCollection> {
  const deps = resolveDorkFiPositionCollectorDependencies();
  const algod = createAlgodClient(context.algodRequestGate);
  const walletHoldings = new Map(
    snapshot.assets.map((holding) => [holding.assetId, holding.amount])
  );
  walletHoldings.set(0, snapshot.amount);
  const positions: PositionMarketRecord[] = [];
  const warnings: string[] = [];
  let pausedMarkets = 0;

  await mapPositionCandidates(
    DORKFI_ALGORAND_ASA_MARKETS,
    async (market) => {
      try {
        const state = await deps.resolveMarketState({
          network: "mainnet",
          algod,
          poolAppId: market.poolAppId,
          marketAppId: market.marketAppId,
          assetId: market.assetId,
          userAddress: address,
          userAssetHoldings: walletHoldings
        });
        if (state.userNTokenBalance === 0n) {
          return;
        }
        // amountRaw is nToken-denominated so clients can feed withdraw quotes directly.
        const nTokenAmount = state.userNTokenBalance;
        const estimatedUnderlying = underlyingFromScaledDeposits(
          nTokenAmount,
          state.depositIndex
        );
        positions.push({
          protocol: "dorkfi",
          positionType: "supplied",
          // positionId stays market-scoped (one supply per market app).
          positionId: `dorkfi:supplied:${market.marketAppId}`,
          // opportunityId must match adapters/dorkfi.ts: poolAppId + assetId.
          opportunityId: buildDorkFiLendingOpportunityId({
            poolAppId: market.poolAppId,
            assetId: market.assetId
          }),
          assetId: market.assetId,
          assetSymbol: market.symbol,
          amountRaw: nTokenAmount.toString(),
          amount: formatUnits(nTokenAmount, market.decimals),
          usdValue: null,
          notes:
            estimatedUnderlying > 0n
              ? `Amount is nToken (ARC-200) balance for withdraw quotes. Estimated underlying ASA: ${estimatedUnderlying.toString()}.`
              : "Amount is nToken (ARC-200) balance for withdraw quotes.",
          inputHints: {
            poolAppId: market.poolAppId,
            marketAppId: market.marketAppId,
            assetId: market.assetId
          }
        });
      } catch (error) {
        if (isDorkFiPausedMarketError(error)) {
          pausedMarkets += 1;
          return;
        }
        warnings.push(formatDorkFiMarketWarning(market.marketAppId, error));
      }
    }
  );

  // Successful ASA holdings are actionable; don't let unrelated market probes
  // mark the protocol partial.
  if (positions.length > 0) {
    return {
      positions,
      warnings: [],
      coverage: {
        // ASA rows are exit-planning amounts (often unpriced); USD supply comes
        // from the indexed health merge path.
        suppliedUsdComplete: positions.every(
          (position) => position.usdValue !== null
        ),
        borrowedUsdComplete: true,
        rewardsUsdComplete: true
      }
    };
  }

  throwIfEveryCandidateFailed(
    "Dork.fi",
    DORKFI_ALGORAND_ASA_MARKETS.length - pausedMarkets,
    positions,
    warnings
  );
  return { positions, warnings };
}

function isDorkFiPausedMarketError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /market is paused/i.test(message);
}

function compactErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const firstLine = (raw.split("\n")[0] ?? raw).replace(/\s+/g, " ").trim();
  const withoutJsonDump =
    firstLine.includes("{") && firstLine.indexOf("{") > 0
      ? firstLine.slice(0, firstLine.indexOf("{")).trim()
      : firstLine.includes("{")
        ? "market probe failed"
        : firstLine;
  if (/did not log a return value/i.test(withoutJsonDump)) {
    return "no ABI return";
  }
  return (withoutJsonDump || "market probe failed").slice(0, 120);
}

function formatDorkFiMarketWarning(marketAppId: number, error: unknown): string {
  return `${marketAppId}: ${compactErrorMessage(error)}`.slice(0, 180);
}

async function mapPositionCandidates<T>(
  candidates: readonly T[],
  worker: (candidate: T) => Promise<void>
): Promise<void> {
  await mapWithThrottle(
    candidates,
    {
      concurrency: readPositiveInteger(
        process.env.POSITIONS_RPC_CONCURRENCY,
        2
      ),
      // The shared Algod client gate applies the inter-request delay. Adding
      // another delay here would serialize candidate scheduling twice.
      delayMs: 0
    },
    worker
  );
}

function createAlgodClient(requestGate?: RequestGate): Algodv2 {
  const algod = new algosdk.Algodv2(
    process.env.X402_ALGOD_TOKEN ?? "",
    trimTrailingSlash(
      process.env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud"
    ),
    ""
  );
  return requestGate === undefined
    ? algod
    : (withAlgodRequestGate(algod, requestGate) as Algodv2);
}

function createPositionCollectionContext(): PositionCollectionContext {
  return {
    algodRequestGate: createRequestGate({
      concurrency: readPositiveInteger(
        process.env.POSITIONS_RPC_CONCURRENCY,
        2
      ),
      delayMs: readNonNegativeInteger(process.env.POSITIONS_RPC_DELAY_MS, 125)
    })
  };
}

function createIndexerClient(): algosdk.Indexer {
  return new algosdk.Indexer(
    process.env.X402_INDEXER_TOKEN ?? "",
    trimTrailingSlash(
      process.env.X402_INDEXER_URL ?? "https://mainnet-idx.algonode.cloud"
    ),
    ""
  );
}

function uniqueOpportunities(
  opportunities: OpportunityMarketRecord[]
): OpportunityMarketRecord[] {
  return [
    ...new Map(
      opportunities.map((opportunity) => [
        opportunity.opportunityId,
        opportunity
      ])
    ).values()
  ];
}

function formatUnits(value: bigint, decimals: number): string {
  if (decimals <= 0) {
    return value.toString();
  }
  const raw = value.toString().padStart(decimals + 1, "0");
  const whole = raw.slice(0, -decimals);
  const fraction = raw.slice(-decimals).replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

function proportionalUsd(
  totalUsd: number,
  amount: bigint,
  totalAmount: bigint | null
): number | null {
  if (
    totalAmount === null ||
    totalAmount <= 0n ||
    !Number.isFinite(totalUsd) ||
    totalUsd < 0
  ) {
    return null;
  }
  const value = totalUsd * (Number(amount) / Number(totalAmount));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function tokenUsdValue(
  amountRaw: bigint,
  decimals: number,
  priceUsd: number | null
): number | null {
  if (priceUsd === null) {
    return null;
  }
  const amount = Number(formatUnits(amountRaw, decimals));
  const value = amount * priceUsd;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function parseTrailingInteger(value: string): number | null {
  const match = value.match(/(\d+)$/);
  if (!match) {
    return null;
  }
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function safeSdkInteger(value: number, field: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} is outside JavaScript safe-integer range.`);
  }
  return BigInt(value);
}

function scaledUsd(value: bigint, decimals: number): number | null {
  const parsed = Number(formatUnits(value, decimals));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function ratioOrNull(numerator: bigint, denominator: bigint): number | null {
  if (denominator <= 0n) {
    return null;
  }
  const ratio = Number(numerator) / Number(denominator);
  return Number.isFinite(ratio) && ratio >= 0 ? ratio : null;
}

function parseUnsignedBigInt(value: unknown): bigint | null {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "bigint"
  ) {
    return null;
  }
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : null;
  } catch {
    return null;
  }
}

function parseSafePositiveInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number" || typeof value === "string"
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseSafeNonNegativeInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number" || typeof value === "string"
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseNonNegativeInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number" || typeof value === "string"
      ? Number(value)
      : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseNullableNonNegativeNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed =
    typeof value === "number" || typeof value === "string"
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseSourceTimestamp(value: unknown): string | undefined {
  if (typeof value === "string") {
    const timestamp = new Date(value);
    return Number.isNaN(timestamp.getTime()) ? undefined : timestamp.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    return new Date(milliseconds).toISOString();
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function throwIfEveryCandidateFailed(
  protocolName: string,
  candidateCount: number,
  positions: PositionMarketRecord[],
  warnings: string[]
): void {
  if (
    candidateCount > 0 &&
    positions.length === 0 &&
    warnings.length === candidateCount
  ) {
    throw new Error(`${protocolName} position source failed for every market.`);
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function chunkValues<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

/**
 * Liquid-staking positions use the wallet LST balance as the source of truth.
 * Exits hang off opportunity-compatible redeem/burn/unstake shapes.
 */
export async function collectMythFinancePositions(
  address: string,
  snapshot: WalletSnapshot
): Promise<ProtocolPositionsCollection> {
  return collectMythDualStakeWalletPositions(snapshot, address);
}

/**
 * Réti positions are per staked pool (ledger entry). Unstake requires poolAppId.
 */
export async function collectRetiPositions(
  address: string,
  _snapshot: WalletSnapshot
): Promise<ProtocolPositionsCollection> {
  const warnings: string[] = [];
  const positions: PositionMarketRecord[] = [];
  const algod = createPositionsAlgodClient();
  const registryAppId = readRetiRegistryAppId();

  let poolKeys;
  try {
    poolKeys = await retiGetStakedPoolsForAccount(algod, address, registryAppId);
  } catch (error) {
    return {
      positions: [],
      warnings: [`Réti staked pools unavailable: ${errorMessage(error)}`],
      coverage: {
        suppliedUsdComplete: false,
        borrowedUsdComplete: true,
        rewardsUsdComplete: false
      }
    };
  }

  if (poolKeys.length === 0) {
    return {
      positions: [],
      warnings,
      coverage: {
        suppliedUsdComplete: true,
        borrowedUsdComplete: true,
        rewardsUsdComplete: true
      }
    };
  }

  let algoUsd: number | null = null;
  try {
    const prices = await fetchTinymanAssetUsdPrices([0]);
    algoUsd = prices.get(0) ?? null;
  } catch (error) {
    warnings.push(`Réti ALGO USD pricing unavailable: ${errorMessage(error)}`);
  }

  const configCache = new Map<string, Awaited<ReturnType<typeof retiGetValidatorConfig>>>();

  for (const poolKey of poolKeys) {
    const validatorId = Number(poolKey.validatorId);
    const poolAppId = Number(poolKey.poolAppId);
    if (!Number.isInteger(validatorId) || validatorId < 1 || poolAppId < 1) {
      continue;
    }

    let stakerInfo;
    try {
      stakerInfo = await retiGetStakerInfo(algod, poolAppId, address);
    } catch (error) {
      warnings.push(
        `Réti pool ${poolAppId} staker info unavailable: ${errorMessage(error)}`
      );
      continue;
    }

    if (stakerInfo.balance <= 0n) {
      continue;
    }

    const cacheKey = String(validatorId);
    let config = configCache.get(cacheKey);
    if (config === undefined) {
      try {
        config = await retiGetValidatorConfig(algod, validatorId, registryAppId);
        configCache.set(cacheKey, config);
      } catch (error) {
        warnings.push(
          `Réti validator ${validatorId} config unavailable: ${errorMessage(error)}`
        );
      }
    }

    const rewardTokenId = config !== undefined ? Number(config.rewardTokenId) : 0;

    positions.push({
      protocol: "reti",
      positionType: "staked",
      positionId: `reti:staked:${validatorId}:${poolAppId}`,
      opportunityId: retiStakingOpportunityId(validatorId),
      assetId: 0,
      assetSymbol: "ALGO",
      amountRaw: stakerInfo.balance.toString(),
      amount: formatUnits(stakerInfo.balance, 6),
      usdValue: tokenUsdValue(stakerInfo.balance, 6, algoUsd),
      notes:
        `Réti stake in validator ${validatorId} pool app ${poolAppId}. ` +
        `totalRewarded=${stakerInfo.totalRewarded.toString()} µALGO` +
        (rewardTokenId > 0
          ? `; rewardTokenBalance=${stakerInfo.rewardTokenBalance.toString()} of ASA ${rewardTokenId}`
          : ""),
      inputHints: {
        validatorId,
        poolAppId,
        assetId: 0,
        depositAssetId: 0
      }
    });

    if (rewardTokenId > 0 && stakerInfo.rewardTokenBalance > 0n) {
      positions.push({
        protocol: "reti",
        positionType: "reward",
        positionId: `reti:reward:${validatorId}:${poolAppId}:${rewardTokenId}`,
        opportunityId: retiStakingOpportunityId(validatorId),
        assetId: rewardTokenId,
        assetSymbol: `ASA-${rewardTokenId}`,
        amountRaw: stakerInfo.rewardTokenBalance.toString(),
        amount: formatUnits(stakerInfo.rewardTokenBalance, 6),
        usdValue: null,
        notes: `Pending Réti reward-token balance for validator ${validatorId}.`,
        inputHints: {
          validatorId,
          poolAppId,
          assetId: rewardTokenId
        }
      });
    }
  }

  const hasUnpricedStaked = positions.some(
    (position) =>
      position.positionType === "staked" && position.usdValue === null
  );
  const hasUnpricedRewards = positions.some(
    (position) =>
      position.positionType === "reward" && position.usdValue === null
  );
  if (hasUnpricedRewards) {
    warnings.push("Réti reward-token USD pricing is unavailable.");
  }

  return {
    positions,
    warnings,
    coverage: {
      suppliedUsdComplete: !hasUnpricedStaked,
      borrowedUsdComplete: true,
      rewardsUsdComplete: !hasUnpricedRewards
    }
  };
}

function readRetiRegistryAppId(): number {
  const raw = process.env.RETI_VALIDATOR_REGISTRY_APP_ID?.trim();
  if (raw) {
    const value = Number(raw);
    if (Number.isInteger(value) && value >= 1) {
      return value;
    }
  }
  return RETI_VALIDATOR_REGISTRY_APP_ID;
}

export async function collectHaystackPositions(
  address: string,
  _snapshot: WalletSnapshot
): Promise<ProtocolPositionsCollection> {
  const warnings: string[] = [];
  const positions: PositionMarketRecord[] = [];

  let record;
  try {
    const algod = createPositionsAlgodClient();
    const boxName = createStakerBoxName(address);
    record = await getStakerBoxRecord(algod, HAYSTACK_STAKING_APP_ID, boxName);
  } catch (error) {
    return {
      positions: [],
      warnings: [`Haystack staking box unavailable: ${errorMessage(error)}`]
    };
  }

  if (!record.hasBox || record.stake <= 0n) {
    // Still surface pending rewards if the box exists with zero stake.
    if (!record.hasBox) {
      return { positions: [], warnings };
    }
  }

  const assetIds = [HAY_ASSET_ID, USDC_ASSET_ID];
  const decimalsByAssetId = await resolveAssetDecimals(assetIds).catch(() => {
    warnings.push("Haystack asset decimals unavailable; defaulting to 6.");
    return new Map<number, number>();
  });
  const hayDecimals = decimalsByAssetId.get(HAY_ASSET_ID) ?? 6;
  const usdcDecimals = decimalsByAssetId.get(USDC_ASSET_ID) ?? 6;

  let prices = new Map<number, number | null>();
  try {
    prices = await fetchTinymanAssetUsdPrices(assetIds);
  } catch (error) {
    warnings.push(`Haystack USD pricing unavailable: ${errorMessage(error)}`);
  }
  const hayUsd = prices.get(HAY_ASSET_ID) ?? null;
  const usdcUsd = prices.get(USDC_ASSET_ID) ?? 1;

  if (record.stake > 0n) {
    positions.push({
      protocol: "haystack",
      positionType: "staked",
      positionId: `haystack:staked:${HAYSTACK_STAKING_APP_ID}`,
      opportunityId: HAYSTACK_STAKING_OPPORTUNITY_ID,
      assetId: HAY_ASSET_ID,
      assetSymbol: "HAY",
      amountRaw: record.stake.toString(),
      amount: formatUnits(record.stake, hayDecimals),
      usdValue: tokenUsdValue(record.stake, hayDecimals, hayUsd),
      notes: "Haystack staker-box HAY stake (source of truth)."
    });
  }

  if (record.pendingRewardsUsdc > 0n) {
    positions.push({
      protocol: "haystack",
      positionType: "reward",
      positionId: `haystack:reward:${HAYSTACK_STAKING_APP_ID}:usdc`,
      opportunityId: HAYSTACK_STAKING_OPPORTUNITY_ID,
      assetId: USDC_ASSET_ID,
      assetSymbol: "USDC",
      amountRaw: record.pendingRewardsUsdc.toString(),
      amount: formatUnits(record.pendingRewardsUsdc, usdcDecimals),
      usdValue: tokenUsdValue(record.pendingRewardsUsdc, usdcDecimals, usdcUsd),
      caveats: [
        "Pending USDC from staker box; live accrual may be higher until the next drip/claim."
      ]
    });
  }

  if (record.pendingRewardsHay > 0n) {
    positions.push({
      protocol: "haystack",
      positionType: "reward",
      positionId: `haystack:reward:${HAYSTACK_STAKING_APP_ID}:hay`,
      opportunityId: HAYSTACK_STAKING_OPPORTUNITY_ID,
      assetId: HAY_ASSET_ID,
      assetSymbol: "HAY",
      amountRaw: record.pendingRewardsHay.toString(),
      amount: formatUnits(record.pendingRewardsHay, hayDecimals),
      usdValue: tokenUsdValue(record.pendingRewardsHay, hayDecimals, hayUsd),
      caveats: [
        "Pending HAY from staker box; live accrual may be higher until the next drip/claim."
      ]
    });
  }

  const rewardsComplete =
    !warnings.some((warning) => warning.includes("USD pricing")) &&
    !positions.some(
      (position) =>
        position.positionType === "reward" && position.usdValue === null
    );

  return {
    positions,
    warnings,
    coverage: {
      suppliedUsdComplete:
        positions
          .filter((position) => position.positionType === "staked")
          .every((position) => position.usdValue !== null),
      borrowedUsdComplete: true,
      rewardsUsdComplete: rewardsComplete
    }
  };
}

async function collectTinymanTAlgoWalletPosition(
  snapshot: WalletSnapshot
): Promise<ProtocolPositionsCollection> {
  const tAlgoId = TALGO_ASSET_ID.mainnet;
  const balance = getWalletAssetBalance(snapshot, tAlgoId);
  if (balance <= 0n) {
    return { positions: [], warnings: [] };
  }

  const warnings: string[] = [];
  let decimals = 6;
  try {
    const decimalsByAssetId = await resolveAssetDecimals([tAlgoId]);
    decimals = decimalsByAssetId.get(tAlgoId) ?? 6;
  } catch (error) {
    warnings.push(
      `Tinyman tALGO decimals unavailable: ${errorMessage(error)}; defaulting to 6.`
    );
  }

  let priceUsd: number | null = null;
  try {
    const prices = await fetchTinymanAssetUsdPrices([tAlgoId]);
    priceUsd = prices.get(tAlgoId) ?? null;
  } catch (error) {
    warnings.push(
      `Tinyman tALGO USD pricing unavailable: ${errorMessage(error)}`
    );
  }

  return {
    positions: [
      {
        protocol: "tinyman",
        positionType: "staked",
        positionId: `tinyman:staked:talgo:${tAlgoId}`,
        opportunityId: TINYMAN_TALGO_STAKING_OPPORTUNITY_ID,
        assetId: tAlgoId,
        assetSymbol: "tALGO",
        amountRaw: balance.toString(),
        amount: formatUnits(balance, decimals),
        usdValue: tokenUsdValue(balance, decimals, priceUsd),
        notes:
          "Wallet tALGO balance is the liquid-staking position size (source of truth)."
      }
    ],
    warnings
  };
}

async function collectTinymanStAlgoWalletPosition(
  snapshot: WalletSnapshot
): Promise<ProtocolPositionsCollection> {
  const stAlgoId = STALGO_ASSET_ID.mainnet;
  const balance = getWalletAssetBalance(snapshot, stAlgoId);
  if (balance <= 0n) {
    return { positions: [], warnings: [] };
  }

  const warnings: string[] = [];
  let decimals = 6;
  try {
    const decimalsByAssetId = await resolveAssetDecimals([stAlgoId]);
    decimals = decimalsByAssetId.get(stAlgoId) ?? 6;
  } catch (error) {
    warnings.push(
      `Tinyman stALGO decimals unavailable: ${errorMessage(error)}; defaulting to 6.`
    );
  }

  // stALGO is 1:1 with tALGO; price via tALGO market when available.
  const tAlgoId = TALGO_ASSET_ID.mainnet;
  let priceUsd: number | null = null;
  try {
    const prices = await fetchTinymanAssetUsdPrices([tAlgoId]);
    priceUsd = prices.get(tAlgoId) ?? null;
  } catch (error) {
    warnings.push(
      `Tinyman stALGO USD pricing unavailable: ${errorMessage(error)}`
    );
  }

  return {
    positions: [
      {
        protocol: "tinyman",
        positionType: "staked",
        positionId: `tinyman:staked:stalgo:${stAlgoId}`,
        opportunityId: TINYMAN_STALGO_STAKING_OPPORTUNITY_ID,
        assetId: stAlgoId,
        assetSymbol: "stALGO",
        amountRaw: balance.toString(),
        amount: formatUnits(balance, decimals),
        usdValue: tokenUsdValue(balance, decimals, priceUsd),
        notes:
          "Wallet stALGO balance is the restake position size (1:1 with tALGO). " +
          "Pending TINY restake rewards are not collected in this phase; claim via manage shapes."
      }
    ],
    warnings
  };
}

async function collectFolksXAlgoWalletPosition(
  snapshot: WalletSnapshot
): Promise<ProtocolPositionsCollection> {
  const xAlgoId = Number(MainnetConsensusConfig.xAlgoId);
  if (!Number.isInteger(xAlgoId) || xAlgoId < 1) {
    return {
      positions: [],
      warnings: ["Folks Finance xALGO asset id is not configured."]
    };
  }

  const balance = getWalletAssetBalance(snapshot, xAlgoId);
  if (balance <= 0n) {
    return { positions: [], warnings: [] };
  }

  const warnings: string[] = [];
  let decimals = 6;
  try {
    const decimalsByAssetId = await resolveAssetDecimals([xAlgoId]);
    decimals = decimalsByAssetId.get(xAlgoId) ?? 6;
  } catch (error) {
    warnings.push(
      `Folks xALGO decimals unavailable: ${errorMessage(error)}; defaulting to 6.`
    );
  }

  let priceUsd: number | null = null;
  try {
    // Prefer Tinyman market price for the xALGO ASA when available.
    const prices = await fetchTinymanAssetUsdPrices([xAlgoId]);
    priceUsd = prices.get(xAlgoId) ?? null;
  } catch (error) {
    warnings.push(
      `Folks xALGO USD pricing unavailable: ${errorMessage(error)}`
    );
  }

  if (priceUsd === null) {
    try {
      priceUsd = await estimateFolksXAlgoUsdPrice(balance, decimals);
    } catch (error) {
      warnings.push(
        `Folks xALGO ALGO-backing price unavailable: ${errorMessage(error)}`
      );
    }
  }

  return {
    positions: [
      {
        protocol: "folks-finance",
        positionType: "staked",
        positionId: `folks-finance:staked:xalgo:${xAlgoId}`,
        opportunityId: FOLKS_XALGO_STAKING_OPPORTUNITY_ID,
        assetId: xAlgoId,
        assetSymbol: "xALGO",
        amountRaw: balance.toString(),
        amount: formatUnits(balance, decimals),
        usdValue: tokenUsdValue(balance, decimals, priceUsd),
        notes:
          "Wallet xALGO balance is the liquid-staking position size (source of truth)."
      }
    ],
    warnings
  };
}

async function estimateFolksXAlgoUsdPrice(
  _balance: bigint,
  _decimals: number
): Promise<number | null> {
  const algod = createPositionsAlgodClient();
  const [consensusState, algoPrices] = await Promise.all([
    getConsensusStateFromFolks(algod),
    fetchTinymanAssetUsdPrices([0])
  ]);
  const algoUsd = algoPrices.get(0) ?? null;
  if (algoUsd === null || consensusState === null) {
    return null;
  }
  const circulating = consensusState.xAlgoCirculatingSupply;
  const algoBalance = consensusState.algoBalance;
  if (circulating <= 0n) {
    return null;
  }
  // ALGO backing per xALGO unit, priced in USD.
  const algoPerXAlgo = Number(algoBalance) / Number(circulating);
  if (!Number.isFinite(algoPerXAlgo) || algoPerXAlgo <= 0) {
    return null;
  }
  return algoPerXAlgo * algoUsd;
}

async function getConsensusStateFromFolks(
  algod: Algodv2
): Promise<ConsensusState | null> {
  try {
    return await getConsensusState(algod, MainnetConsensusConfig);
  } catch {
    return null;
  }
}

async function collectMythDualStakeWalletPositions(
  snapshot: WalletSnapshot,
  _address: string
): Promise<ProtocolPositionsCollection> {
  const heldAssetIds = getHeldWalletAssetIds(snapshot);
  if (heldAssetIds.length === 0) {
    return {
      positions: [],
      warnings: [],
      coverage: {
        suppliedUsdComplete: true,
        borrowedUsdComplete: true,
        rewardsUsdComplete: true
      }
    };
  }

  const warnings: string[] = [];
  let contracts: Array<{ asaId: bigint; appId: bigint; lstId: bigint }>;
  try {
    const algod = createPositionsAlgodClient();
    const algorand = AlgorandClient.fromClients({ algod });
    contracts = await DualStake.getAvailableContracts({
      algorand,
      network: "mainnet",
      dsRegistryAppId: readMythRegistryAppId(),
      tinymanAppId: MYTH_TINYMAN_APP_ID,
      arc59RouterAppId: MYTH_ARC59_ROUTER_APP_ID,
      sender: process.env.MYTH_SIMULATE_SENDER ?? MYTH_SIMULATE_SENDER
    });
  } catch (error) {
    return {
      positions: [],
      warnings: [
        `Myth Finance dualSTAKE registry unavailable: ${errorMessage(error)}`
      ],
      coverage: {
        suppliedUsdComplete: false,
        borrowedUsdComplete: true,
        rewardsUsdComplete: true
      }
    };
  }

  const heldSet = new Set(heldAssetIds);
  const heldLsts = contracts.filter((contract) =>
    heldSet.has(Number(contract.lstId))
  );
  if (heldLsts.length === 0) {
    return {
      positions: [],
      warnings: [],
      coverage: {
        suppliedUsdComplete: true,
        borrowedUsdComplete: true,
        rewardsUsdComplete: true
      }
    };
  }

  const lstIds = heldLsts.map((contract) => Number(contract.lstId));
  const decimalsByAssetId = await resolveAssetDecimals(lstIds).catch(() => {
    warnings.push("Myth Finance LST decimals unavailable; defaulting to 6.");
    return new Map<number, number>();
  });

  let algoUsd: number | null = null;
  try {
    const prices = await fetchTinymanAssetUsdPrices([0]);
    algoUsd = prices.get(0) ?? null;
  } catch (error) {
    warnings.push(
      `Myth Finance ALGO USD pricing unavailable: ${errorMessage(error)}`
    );
  }

  const positions: PositionMarketRecord[] = [];
  for (const contract of heldLsts) {
    const lstId = Number(contract.lstId);
    const appId = Number(contract.appId);
    const balance = getWalletAssetBalance(snapshot, lstId);
    if (balance <= 0n) {
      continue;
    }
    const decimals = decimalsByAssetId.get(lstId) ?? 6;
    // Redeem pays mostly ALGO plus a small paired ASA; USD approximates the ALGO leg only.
    positions.push({
      protocol: "myth-finance",
      positionType: "staked",
      positionId: `myth-finance:staked:${appId}:${lstId}`,
      opportunityId: mythStakingOpportunityId(appId),
      assetId: lstId,
      assetSymbol: `dS-${lstId}`,
      amountRaw: balance.toString(),
      amount: formatUnits(balance, decimals),
      usdValue: tokenUsdValue(balance, decimals, algoUsd),
      notes:
        "Wallet dualSTAKE LST balance is the liquid-staking position size (source of truth). " +
        "Redeem returns mostly ALGO plus a small amount of the paired ASA (not 1:1 ALGO). " +
        "usdValue approximates the ALGO leg only."
    });
  }

  const hasUnpricedStaked = positions.some(
    (position) =>
      position.positionType === "staked" && position.usdValue === null
  );
  return {
    positions,
    warnings,
    coverage: {
      suppliedUsdComplete: !hasUnpricedStaked,
      borrowedUsdComplete: true,
      rewardsUsdComplete: true
    }
  };
}

function createPositionsAlgodClient(): Algodv2 {
  const server = process.env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud";
  const token = process.env.X402_ALGOD_TOKEN ?? "";
  return new algosdk.Algodv2(token, server.replace(/\/$/, ""), "");
}

function readMythRegistryAppId(): bigint {
  const raw = process.env.MYTH_DS_REGISTRY_APP_ID;
  if (raw === undefined || raw.trim() === "") {
    return MYTH_DS_REGISTRY_APP_ID;
  }
  try {
    return BigInt(raw);
  } catch {
    return MYTH_DS_REGISTRY_APP_ID;
  }
}

function readNonNegativeInteger(
  value: string | undefined,
  fallback: number
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
