import algosdk, { Algodv2 } from "algosdk";

import { buildSourceMetadata } from "../services/source-metadata.js";
import { OpportunityMarketRecord } from "../types/opportunity.js";
import { skipLiveCatalogInTests } from "./offline-test-runtime.js";
import {
  HAYSTACK_STAKING_APP_ID,
  HAY_ASSET_ID,
  USDC_ASSET_ID
} from "../execution/shapes/haystack/constants.js";

export const HAYSTACK_STAKING_OPPORTUNITY_ID = "haystack-staking-hay";

/** On-chain EMA fields use 1e6 = 1% (percentage points × 1e6). */
const HAYSTACK_APR_FIXED_POINT = 1_000_000;

export class HaystackAdapterError extends Error {
  public readonly cause?: unknown;

  public constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "HaystackAdapterError";
    this.cause = cause;
  }
}

export interface HaystackPoolSnapshot {
  appId: number;
  hayAssetId: number;
  usdcAssetId: number;
  totalStaked: bigint;
  emaAprUsdc: bigint;
  emaAprHay: bigint;
  paused: boolean;
}

interface HaystackAdapterDependencies {
  createAlgodClient: () => Algodv2;
  getPoolSnapshot: (algod: Algodv2, appId: number) => Promise<HaystackPoolSnapshot>;
  fetchHayUsdPrice: (fetchImpl: typeof fetch) => Promise<number | null>;
}

let dependencyOverrides: Partial<HaystackAdapterDependencies> | undefined;

export function setHaystackAdapterDependenciesForTests(
  overrides?: Partial<HaystackAdapterDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): HaystackAdapterDependencies {
  return {
    createAlgodClient: createHaystackAlgodClient,
    getPoolSnapshot: fetchHaystackPoolSnapshot,
    fetchHayUsdPrice: fetchHayUsdPriceFromTinyman,
    ...dependencyOverrides
  };
}

export async function fetchHaystackOpportunities(
  fetchImpl: typeof fetch = fetch
): Promise<OpportunityMarketRecord[]> {
  if (skipLiveCatalogInTests(dependencyOverrides)) {
    throw new HaystackAdapterError("Haystack live catalog is disabled in CI/tests.");
  }
  const dependencies = resolveDependencies();
  const fetchedAtIso = new Date().toISOString();

  try {
    const algod = dependencies.createAlgodClient();
    const [snapshot, hayUsdPrice] = await Promise.all([
      dependencies.getPoolSnapshot(algod, HAYSTACK_STAKING_APP_ID),
      dependencies.fetchHayUsdPrice(fetchImpl)
    ]);

    const opportunity = normalizeHaystackStakingOpportunity({
      snapshot,
      hayUsdPrice,
      fetchedAtIso
    });
    return opportunity === null ? [] : [opportunity];
  } catch (error) {
    if (error instanceof HaystackAdapterError) {
      throw error;
    }
    throw new HaystackAdapterError("Haystack adapter request failed.", error);
  }
}

export function normalizeHaystackStakingOpportunity(input: {
  snapshot: HaystackPoolSnapshot;
  hayUsdPrice: number | null;
  fetchedAtIso: string;
}): OpportunityMarketRecord | null {
  const { snapshot, hayUsdPrice, fetchedAtIso } = input;

  if (snapshot.paused) {
    return null;
  }
  if (snapshot.totalStaked <= 0n) {
    return null;
  }
  if (hayUsdPrice === null || !(hayUsdPrice > 0)) {
    return null;
  }

  const aprUsdc = fixedPointAprToPercentage(snapshot.emaAprUsdc);
  const aprHay = fixedPointAprToPercentage(snapshot.emaAprHay);
  if (aprUsdc === null || aprHay === null) {
    return null;
  }
  const apr = aprUsdc + aprHay;
  if (!Number.isFinite(apr) || apr < 0) {
    return null;
  }

  const tvlUsd = (Number(snapshot.totalStaked) / 1_000_000) * hayUsdPrice;
  if (!Number.isFinite(tvlUsd) || tvlUsd <= 0) {
    return null;
  }

  return {
    protocol: "haystack",
    opportunityType: "staking",
    opportunityId: HAYSTACK_STAKING_OPPORTUNITY_ID,
    assetPair: "HAY/USDC+HAY",
    assetIds: [snapshot.hayAssetId, snapshot.usdcAssetId],
    apy: apr,
    yieldBasis: "apr",
    apr,
    tvlUsd,
    ...buildSourceMetadata({
      fetchedAtIso,
      contextNotes: [
        `Haystack single-token HAY staking (app ${snapshot.appId}). ` +
          `APR combines on-chain emaAPRUsdc (${aprUsdc.toFixed(2)}%) and emaAPRHay ` +
          `(${aprHay.toFixed(2)}%) where 1e6 = 1%. Dual USDC+HAY rewards.`
      ]
    })
  };
}

export function fixedPointAprToPercentage(value: bigint): number | null {
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber) || asNumber < 0) {
    return null;
  }
  return asNumber / HAYSTACK_APR_FIXED_POINT;
}

async function fetchHaystackPoolSnapshot(
  algod: Algodv2,
  appId: number
): Promise<HaystackPoolSnapshot> {
  const application = await algod.getApplicationByID(appId).do();
  const values = new Map<string, bigint>();
  for (const entry of application.params?.globalState ?? []) {
    const key = Buffer.from(entry.key).toString("utf8");
    values.set(key, BigInt(entry.value.uint ?? 0));
  }

  const hay = values.get("hay");
  const usdc = values.get("usdc");
  const staked = values.get("staked");
  const emaAprUsdc = values.get("emaAPRUsdc");
  const emaAprHay = values.get("emaAPRHay");
  if (
    hay === undefined ||
    usdc === undefined ||
    staked === undefined ||
    emaAprUsdc === undefined ||
    emaAprHay === undefined
  ) {
    throw new HaystackAdapterError(
      "Haystack staking app is missing required global state fields."
    );
  }

  return {
    appId,
    hayAssetId: Number(hay),
    usdcAssetId: Number(usdc),
    totalStaked: staked,
    emaAprUsdc,
    emaAprHay,
    paused: (values.get("paus") ?? 0n) !== 0n
  };
}

async function fetchHayUsdPriceFromTinyman(
  fetchImpl: typeof fetch
): Promise<number | null> {
  const baseUrl =
    process.env.TINYMAN_API_BASE_URL ?? "https://mainnet.analytics.tinyman.org/api/v1";
  const apiKey = process.env.TINYMAN_API_KEY;
  const requestUrl = `${trimTrailingSlash(baseUrl)}/assets/${HAY_ASSET_ID}/`;
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

function createHaystackAlgodClient(): Algodv2 {
  const server = process.env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud";
  const token = process.env.X402_ALGOD_TOKEN ?? "";
  return new algosdk.Algodv2(token, trimTrailingSlash(server), "");
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

// Re-export constants useful to tests / collectors.
export { HAYSTACK_STAKING_APP_ID, HAY_ASSET_ID, USDC_ASSET_ID };
