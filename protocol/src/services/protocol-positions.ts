import algosdk, { Algodv2 } from "algosdk";
import {
  MainnetDepositsAppId,
  MainnetLoans,
  MainnetOracle,
  MainnetPoolManagerAppId,
  MainnetPools,
  retrieveUserDepositsFullInfo,
  retrieveUserLoansInfo
} from "@folks-finance/algorand-sdk";
import { makeFarmFromRawState } from "@pactfi/pactsdk";

import { fetchCompXOpportunities } from "../adapters/index.js";
import {
  resolveCompXLendingMarketState
} from "../execution/shapes/compx/market-state.js";
import {
  resolveCompXStakingPoolState
} from "../execution/shapes/compx/pool-state.js";
import {
  DORKFI_ALGORAND_ASA_MARKETS
} from "../execution/shapes/dorkfi/market-catalog.js";
import {
  resolveDorkFiLendingMarketState
} from "../execution/shapes/dorkfi/market-state.js";
import { simulateWithdrawUnderlyingAmount } from "../execution/shapes/dorkfi/abi.js";
import type { OpportunityMarketRecord } from "../types/opportunity.js";
import type { PositionMarketRecord } from "./position-execution-shapes.js";
import { resolveAssetDecimals } from "./asset-decimals.js";import {
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
  _address: string,
  snapshot: WalletSnapshot
): Promise<ProtocolPositionsCollection> {
  const positions: PositionMarketRecord[] = [];
  const warnings = [
    "Tinyman farm staking and unclaimed rewards are not exposed by the installed SDK."
  ];
  const heldAssetIds = getHeldWalletAssetIds(snapshot);
  if (heldAssetIds.length === 0) {
    return tinymanCollection(positions, warnings);
  }

  const pools = await fetchTinymanPoolsForLiquidityAssets(heldAssetIds);
  for (const pool of pools) {
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
      notes: "LP-token claim; underlying reserve composition changes with pool state."
    });
  }

  return tinymanCollection(positions, warnings);
}

function tinymanCollection(
  positions: PositionMarketRecord[],
  warnings: string[]
): ProtocolPositionsCollection {
  return {
    positions,
    warnings,
    coverage: {
      suppliedUsdComplete: positions.every((position) => position.usdValue !== null),
      borrowedUsdComplete: true,
      rewardsUsdComplete: false
    }
  };
}

interface TinymanPositionPool {
  address?: string;
  asset_1?: {
    id?: number | string | null;
    unit_name?: string | null;
    name?: string | null;
  };
  asset_2?: {
    id?: number | string | null;
    unit_name?: string | null;
    name?: string | null;
  };
  liquidity_asset?: {
    id?: number | string | null;
    decimals?: number | string | null;
  };
  current_issued_liquidity_assets?: number | string | null;
  liquidity_in_usd?: number | string | null;
  is_verified?: boolean | null;
}

async function fetchTinymanPoolsForLiquidityAssets(
  assetIds: readonly number[]
): Promise<TinymanPositionPool[]> {
  const baseUrl =
    process.env.TINYMAN_API_BASE_URL ??
    "https://mainnet.analytics.tinyman.org/api/v1";
  const apiKey = process.env.TINYMAN_API_KEY;
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
      const requestInit: RequestInit = {};
      if (apiKey) {
        requestInit.headers = { authorization: `Bearer ${apiKey}` };
      }
      const response = await fetch(
        `${trimTrailingSlash(baseUrl)}/pools/?${query.toString()}`,
        requestInit
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
      const farm = await fetchPactFarmFromState(algod, farmAppId);
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
          caveats: ["The Pact SDK does not provide reward-asset USD prices."]
        });
      }
    } catch (error) {
      warnings.push(`${farmAppId}:farm: ${errorMessage(error)}`);
    }
  }

  const sourceFailures = warnings.length;
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
        sourceFailures === 0 &&
        positions
          .filter((position) => position.positionType !== "reward")
          .every((position) => position.usdValue !== null),
      borrowedUsdComplete: true,
      rewardsUsdComplete: sourceFailures === 0 && !hasUnpricedRewards
    }
  };
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
  _snapshot: WalletSnapshot
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
  const warnings = [
    "Folks Finance deposit-staking rewards are not included."
  ];

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
      for (const borrow of loan.borrows) {
        if (borrow.borrowBalance <= 0n) {
          continue;
        }
        const entry = poolsByAppId.get(borrow.poolAppId);
        positions.push({
          protocol: "folks-finance",
          positionType: "debt",
          positionId: `folks-finance:debt:${loan.escrowAddress}:${borrow.poolAppId}`,
          opportunityId: `folks-lending-${borrow.poolAppId}`,
          assetId: borrow.assetId,
          assetSymbol: entry?.symbol ?? null,
          amountRaw: borrow.borrowBalance.toString(),
          amount: formatUnits(
            borrow.borrowBalance,
            entry?.pool.assetDecimals ?? 0
          ),
          usdValue: scaledUsd(borrow.borrowBalanceValue, 14),
          healthFactor,
          caveats: [
            `${result.value.loanType} loan escrow ${loan.escrowAddress}.`
          ]
        });
      }
    }
  }

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
      borrowedUsdComplete: failedLoanSources === 0,
      rewardsUsdComplete: false
    }
  };
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
  const warnings = [
    "CompX per-user lending debt is not exposed by the installed SDK.",
    "CompX pending staking rewards cannot be derived from the available staker state."
  ];

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
          if (
            lstTokenId !== undefined &&
            getWalletAssetBalance(snapshot, lstTokenId) === 0n
          ) {
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
            notes: "Underlying claim derived from the cAsset share of circulating supply."
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
          const decimals = (
            await resolveAssetDecimals([state.stakedAssetId], algod)
          ).get(state.stakedAssetId);
          if (decimals === undefined) {
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
            amount: formatUnits(state.staker.stake, decimals),
            usdValue: proportionalUsd(
              opportunity.tvlUsd,
              state.staker.stake,
              state.pool.totalStaked
            ),
            sourceTimestamp: opportunity.sourceTimestamp,
            caveats: ["Pending rewards are not exposed by CompX staker state."]
          });
        }
      } catch (error) {
        warnings.push(`${opportunity.opportunityId}: ${errorMessage(error)}`);
      }
    }
  );

  const sourceWarnings = warnings.slice(2);
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
          .filter((position) => position.positionType !== "reward")
          .every((position) => position.usdValue !== null),
      borrowedUsdComplete: false,
      rewardsUsdComplete: false
    }
  };
}

export async function collectDorkFiPositions(
  address: string,
  snapshot: WalletSnapshot,
  context: PositionCollectionContext = createPositionCollectionContext()
): Promise<ProtocolPositionsCollection> {
  try {
    return await fetchDorkFiIndexedPositions(address);
  } catch (indexedError) {
    const fallback = await collectDorkFiOnChainSupply(address, snapshot, context);
    fallback.warnings.unshift(
      `Dork.fi indexed debt/health source unavailable: ${errorMessage(indexedError)}`
    );
    fallback.coverage = {
      suppliedUsdComplete: false,
      borrowedUsdComplete: false,
      rewardsUsdComplete: true
    };
    return fallback;
  }
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
    const debtRaw = parseUnsignedBigInt(record.totalBorrowValue);
    const healthFactor = parseNullableNonNegativeNumber(record.healthFactor);
    if (poolAppId === null || suppliedRaw === null || debtRaw === null) {
      warnings.push("Dork.fi health API returned an invalid Algorand record.");
      continue;
    }
    const sourceTimestamp = parseSourceTimestamp(
      record.updatedAt ?? record.lastUpdated ?? record.lastUpdateTime
    );
    const caveats = [
      "Pool-level USD value from the Dork.fi index; it is not an asset-level token amount."
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
    if (debtRaw > 0n) {
      positions.push({
        protocol: "dorkfi",
        positionType: "debt",
        positionId: `dorkfi:debt-usd:${poolAppId}`,
        opportunityId: null,
        assetId: null,
        assetSymbol: "USD",
        amountRaw: debtRaw.toString(),
        amount: formatUnits(debtRaw, 12),
        usdValue: scaledUsd(debtRaw, 12),
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
      borrowedUsdComplete: warnings.length === 0,
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
  const algod = createAlgodClient(context.algodRequestGate);
  const walletHoldings = new Map(
    snapshot.assets.map((holding) => [holding.assetId, holding.amount])
  );
  walletHoldings.set(0, snapshot.amount);
  const positions: PositionMarketRecord[] = [];
  const warnings: string[] = [];

  await mapPositionCandidates(
    DORKFI_ALGORAND_ASA_MARKETS,
    async (market) => {
      try {
        const state = await resolveDorkFiLendingMarketState({
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
        const suppliedRaw = await simulateWithdrawUnderlyingAmount({
          algod,
          poolAppId: market.poolAppId,
          marketAppId: market.marketAppId,
          nTokenAmount: state.userNTokenBalance,
          userAddress: address
        });
        positions.push({
          protocol: "dorkfi",
          positionType: "supplied",
          positionId: `dorkfi:supplied:${market.marketAppId}`,
          opportunityId: `dorkfi:algorand:${market.marketAppId}:${market.assetId}:lending`,
          assetId: market.assetId,
          assetSymbol: market.symbol,
          amountRaw: suppliedRaw.toString(),
          amount: formatUnits(suppliedRaw, market.decimals),
          usdValue: null,
          notes: "Underlying amount is the current simulated withdrawal value of the nToken balance."
        });
      } catch (error) {
        warnings.push(`${market.marketAppId}: ${errorMessage(error)}`);
      }
    }
  );

  throwIfEveryCandidateFailed(
    "Dork.fi",
    DORKFI_ALGORAND_ASA_MARKETS.length,
    positions,
    warnings
  );
  return { positions, warnings };
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
