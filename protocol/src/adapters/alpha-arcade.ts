import algosdk, { Algodv2, Indexer } from "algosdk";

import { buildSourceMetadata } from "../services/source-metadata.js";
import { OpportunityMarketRecord } from "../types/opportunity.js";
import {
  ALPHA_ARCADE_STAKING_APP_ID,
  ALPHA_ASSET_ID,
  USDC_ASSET_ID
} from "../execution/shapes/alpha-arcade/constants.js";

export const ALPHA_ARCADE_STAKING_OPPORTUNITY_ID = "alpha-arcade-staking-alpha";

/** Trailing window for fee-share APR estimate (days). */
export const TRAILING_APR_WINDOW_DAYS = 7;

export class AlphaArcadeAdapterError extends Error {
  public readonly cause?: unknown;

  public constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "AlphaArcadeAdapterError";
    this.cause = cause;
  }
}

export interface AlphaArcadePoolSnapshot {
  appId: number;
  alphaAssetId: number;
  usdcAssetId: number;
  totalStaked: bigint;
  appAddress: string;
}

interface AlphaArcadeAdapterDependencies {
  createAlgodClient: () => Algodv2;
  createIndexerClient: () => Indexer;
  getPoolSnapshot: (algod: Algodv2, appId: number) => Promise<AlphaArcadePoolSnapshot>;
  fetchAlphaUsdPrice: (fetchImpl: typeof fetch) => Promise<number | null>;
  fetchTrailingUsdcInflowsMicro: (
    indexer: Indexer,
    appAddress: string,
    usdcAssetId: number,
    windowDays: number
  ) => Promise<bigint | null>;
}

let dependencyOverrides: Partial<AlphaArcadeAdapterDependencies> | undefined;

export function setAlphaArcadeAdapterDependenciesForTests(
  overrides?: Partial<AlphaArcadeAdapterDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): AlphaArcadeAdapterDependencies {
  return {
    createAlgodClient: createAlphaArcadeAlgodClient,
    createIndexerClient: createAlphaArcadeIndexerClient,
    getPoolSnapshot: fetchAlphaArcadePoolSnapshot,
    fetchAlphaUsdPrice: fetchAlphaUsdPriceFromTinyman,
    fetchTrailingUsdcInflowsMicro: fetchTrailingUsdcInflowsFromIndexer,
    ...dependencyOverrides
  };
}

export async function fetchAlphaArcadeOpportunities(
  fetchImpl: typeof fetch = fetch
): Promise<OpportunityMarketRecord[]> {
  const dependencies = resolveDependencies();
  const fetchedAtIso = new Date().toISOString();

  try {
    const algod = dependencies.createAlgodClient();
    const indexer = dependencies.createIndexerClient();
    const snapshot = await dependencies.getPoolSnapshot(algod, ALPHA_ARCADE_STAKING_APP_ID);
    const [alphaUsdPrice, usdcInflowsMicro] = await Promise.all([
      dependencies.fetchAlphaUsdPrice(fetchImpl),
      dependencies.fetchTrailingUsdcInflowsMicro(
        indexer,
        snapshot.appAddress,
        snapshot.usdcAssetId,
        TRAILING_APR_WINDOW_DAYS
      )
    ]);

    const opportunity = normalizeAlphaArcadeStakingOpportunity({
      snapshot,
      alphaUsdPrice,
      usdcInflowsMicro,
      windowDays: TRAILING_APR_WINDOW_DAYS,
      fetchedAtIso
    });
    return opportunity === null ? [] : [opportunity];
  } catch (error) {
    if (error instanceof AlphaArcadeAdapterError) {
      throw error;
    }
    throw new AlphaArcadeAdapterError("Alpha Arcade adapter request failed.", error);
  }
}

export function normalizeAlphaArcadeStakingOpportunity(input: {
  snapshot: AlphaArcadePoolSnapshot;
  alphaUsdPrice: number | null;
  usdcInflowsMicro: bigint | null;
  windowDays: number;
  fetchedAtIso: string;
}): OpportunityMarketRecord | null {
  const { snapshot, alphaUsdPrice, usdcInflowsMicro, windowDays, fetchedAtIso } = input;

  if (snapshot.totalStaked <= 0n) {
    return null;
  }
  if (alphaUsdPrice === null || !(alphaUsdPrice > 0)) {
    return null;
  }
  if (usdcInflowsMicro === null || usdcInflowsMicro <= 0n) {
    return null;
  }

  const tvlUsd = (Number(snapshot.totalStaked) / 1_000_000) * alphaUsdPrice;
  if (!Number.isFinite(tvlUsd) || tvlUsd <= 0) {
    return null;
  }

  const usdcInflowsUsd = Number(usdcInflowsMicro) / 1_000_000;
  if (!Number.isFinite(usdcInflowsUsd) || usdcInflowsUsd <= 0) {
    return null;
  }

  const apr = annualizeTrailingFeeApr({
    usdcInflowsUsd,
    tvlUsd,
    windowDays
  });
  if (apr === null) {
    return null;
  }

  return {
    protocol: "alpha-arcade",
    opportunityType: "staking",
    opportunityId: ALPHA_ARCADE_STAKING_OPPORTUNITY_ID,
    assetPair: "ALPHA/USDC",
    assetIds: [snapshot.alphaAssetId, snapshot.usdcAssetId],
    apy: apr,
    yieldBasis: "apr",
    apr,
    tvlUsd,
    ...buildSourceMetadata({
      fetchedAtIso,
      contextNotes: [
        `Alpha Arcade ALPHA fee-sharing stake (app ${snapshot.appId}). ` +
          `APR is a trailing ${windowDays}d estimate from USDC inflows to the pool ` +
          `annualized against ALPHA TVL; yield depends on prediction-market trading volume ` +
          `and is not guaranteed.`
      ]
    })
  };
}

/**
 * Annualize fee inflows: (inflows / TVL) * (365 / windowDays) * 100 → APR %.
 */
export function annualizeTrailingFeeApr(params: {
  usdcInflowsUsd: number;
  tvlUsd: number;
  windowDays: number;
}): number | null {
  const { usdcInflowsUsd, tvlUsd, windowDays } = params;
  if (!(tvlUsd > 0) || !(windowDays > 0) || !(usdcInflowsUsd > 0)) {
    return null;
  }
  const apr = (usdcInflowsUsd / tvlUsd) * (365 / windowDays) * 100;
  if (!Number.isFinite(apr) || apr < 0) {
    return null;
  }
  return apr;
}

async function fetchAlphaArcadePoolSnapshot(
  algod: Algodv2,
  appId: number
): Promise<AlphaArcadePoolSnapshot> {
  const application = await algod.getApplicationByID(appId).do();
  let totalStaked = 0n;
  for (const entry of application.params?.globalState ?? []) {
    const key = Buffer.from(entry.key).toString("utf8");
    if (key === "total_staked") {
      totalStaked = BigInt(entry.value.uint ?? 0);
    }
  }

  return {
    appId,
    alphaAssetId: ALPHA_ASSET_ID,
    usdcAssetId: USDC_ASSET_ID,
    totalStaked,
    appAddress: algosdk.getApplicationAddress(appId).toString()
  };
}

/**
 * Sum USDC asset transfers received by the staking app address over the trailing
 * window. Returns null when the indexer call fails or yields no usable data.
 */
async function fetchTrailingUsdcInflowsFromIndexer(
  indexer: Indexer,
  appAddress: string,
  usdcAssetId: number,
  windowDays: number
): Promise<bigint | null> {
  try {
    const afterTime = new Date(
      Date.now() - windowDays * 24 * 60 * 60 * 1000
    ).toISOString();

    let nextToken: string | undefined;
    let total = 0n;
    let sawPage = false;

    do {
      let query = indexer
        .lookupAccountTransactions(appAddress)
        .txType("axfer")
        .assetID(usdcAssetId)
        .afterTime(afterTime)
        .limit(1000);
      if (nextToken) {
        query = query.nextToken(nextToken);
      }
      const page = await query.do();
      sawPage = true;
      for (const txn of page.transactions ?? []) {
        const transfer = txn.assetTransferTransaction;
        if (transfer === undefined) {
          continue;
        }
        const receiver = String(transfer.receiver ?? "");
        if (receiver !== appAddress) {
          continue;
        }
        const amount = BigInt(transfer.amount ?? 0);
        if (amount > 0n) {
          total += amount;
        }
      }
      nextToken = page.nextToken;
    } while (nextToken);

    if (!sawPage) {
      return null;
    }
    return total;
  } catch {
    return null;
  }
}

async function fetchAlphaUsdPriceFromTinyman(
  fetchImpl: typeof fetch
): Promise<number | null> {
  const baseUrl =
    process.env.TINYMAN_API_BASE_URL ?? "https://mainnet.analytics.tinyman.org/api/v1";
  const apiKey = process.env.TINYMAN_API_KEY;
  const requestUrl = `${trimTrailingSlash(baseUrl)}/assets/${ALPHA_ASSET_ID}/`;
  const requestInit: RequestInit = {};
  if (apiKey) {
    requestInit.headers = { authorization: `Bearer ${apiKey}` };
  }
  const response = await fetchImpl(requestUrl, requestInit);
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json()) as { price_in_usd?: number | string | null };
  const price = Number(payload.price_in_usd);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function createAlphaArcadeAlgodClient(): Algodv2 {
  const server = process.env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud";
  const token = process.env.X402_ALGOD_TOKEN ?? "";
  return new algosdk.Algodv2(token, trimTrailingSlash(server), "");
}

function createAlphaArcadeIndexerClient(): Indexer {
  return new algosdk.Indexer(
    process.env.X402_INDEXER_TOKEN ?? "",
    trimTrailingSlash(
      process.env.X402_INDEXER_URL ?? "https://mainnet-idx.algonode.cloud"
    ),
    ""
  );
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export { ALPHA_ARCADE_STAKING_APP_ID, ALPHA_ASSET_ID, USDC_ASSET_ID };
