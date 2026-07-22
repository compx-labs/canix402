import algosdk, { Algodv2 } from "algosdk";
import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import {
  DualStake,
  type DSContractListing,
  type DSContractState,
  type DSEnvironmentConfig
} from "@myth-finance/dualstake-ts-sdk";
import { DSFarmSDK, type FarmStateAndAPR } from "@myth-finance/dualstake-farm-sdk";

import { OpportunityMarketRecord } from "../types/opportunity.js";
import {
  CONSENSUS_PAYOUT_FEE_PERCENT,
  estimateConsensusStakingApr,
  type ConsensusStakingAprEstimate
} from "../services/consensus-staking-apr.js";
import { buildSourceMetadata } from "../services/source-metadata.js";

export const MYTH_STAKING_OPPORTUNITY_ID_PREFIX = "myth-staking-";
export const MYTH_FARM_OPPORTUNITY_ID_PREFIX = "myth-farm-";

/** Mainnet dualSTAKE registry application id. */
export const MYTH_DS_REGISTRY_APP_ID = 2933409454n;
/** Mainnet dualSTAKE farm registry application id. */
export const MYTH_DS_FARM_APP_ID = 2933417632n;
export const MYTH_TINYMAN_APP_ID = 1002541853n;
export const MYTH_ARC59_ROUTER_APP_ID = 2449590623n;

/** Read-only simulate sender (Algorand fee sink). */
export const MYTH_SIMULATE_SENDER =
  "A7NMWS3NT3IUDMLVO26ULGXGIIOUQ3ND2TXSER6EBGRZNOBOUIQXHIBGDE";

const FEE_BPS_SCALE = 10_000;
const MICRO_ALGO = 1_000_000;
const LISTING_CONCURRENCY = 2;

export class MythFinanceAdapterError extends Error {
  public readonly cause?: unknown;

  public constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "MythFinanceAdapterError";
    this.cause = cause;
  }
}

export function mythStakingOpportunityId(appId: number | bigint): string {
  return `${MYTH_STAKING_OPPORTUNITY_ID_PREFIX}${appId.toString()}`;
}

export function mythFarmOpportunityId(appId: number | bigint): string {
  return `${MYTH_FARM_OPPORTUNITY_ID_PREFIX}${appId.toString()}`;
}

export function parseMythStakingAppId(opportunityId: string): number | null {
  return parsePrefixedAppId(opportunityId, MYTH_STAKING_OPPORTUNITY_ID_PREFIX);
}

export function parseMythFarmAppId(opportunityId: string): number | null {
  return parsePrefixedAppId(opportunityId, MYTH_FARM_OPPORTUNITY_ID_PREFIX);
}

export function isMythStakingOpportunityId(opportunityId: string): boolean {
  return parseMythStakingAppId(opportunityId) !== null;
}

export function isMythFarmOpportunityId(opportunityId: string): boolean {
  return parseMythFarmAppId(opportunityId) !== null;
}

function parsePrefixedAppId(opportunityId: string, prefix: string): number | null {
  if (!opportunityId.startsWith(prefix)) {
    return null;
  }
  const value = Number(opportunityId.slice(prefix.length));
  if (!Number.isInteger(value) || value < 1) {
    return null;
  }
  return value;
}

interface MythListingSnapshot {
  appId: bigint;
  listing: DSContractListing;
  platformFeeBps: number;
  noderunnerFeeBps: number;
}

interface MythFinanceDependencies {
  createAlgodClient: () => Algodv2;
  createAlgorandClient: (algod: Algodv2) => AlgorandClient;
  estimateConsensusApr: (algod: Algodv2) => Promise<ConsensusStakingAprEstimate>;
  fetchAlgoUsdPrice: (fetchImpl: typeof fetch) => Promise<number | null>;
  getAvailableContractIds: (config: DSEnvironmentConfig) => Promise<bigint[]>;
  getListingAndFees: (
    config: DSEnvironmentConfig,
    appId: bigint
  ) => Promise<MythListingSnapshot>;
  getFarmsAndApr: (
    config: DSEnvironmentConfig,
    appIds: bigint[]
  ) => Promise<Map<bigint, FarmStateAndAPR>>;
  dsRegistryAppId: bigint;
  dsFarmAppId: bigint;
  tinymanAppId: bigint;
  arc59RouterAppId: bigint;
  simulateSender: string;
}

let mythFinanceDependencyOverrides: Partial<MythFinanceDependencies> | undefined;

export function setMythFinanceSdkDependenciesForTests(
  overrides?: Partial<MythFinanceDependencies>
): void {
  mythFinanceDependencyOverrides = overrides;
}

export async function fetchMythFinanceOpportunities(
  fetchImpl: typeof fetch = fetch
): Promise<OpportunityMarketRecord[]> {
  const dependencies = resolveDependencies();
  const fetchedAtIso = new Date().toISOString();

  try {
    const algod = dependencies.createAlgodClient();
    const algorand = dependencies.createAlgorandClient(algod);
    const envConfig: DSEnvironmentConfig = {
      algorand,
      network: "mainnet",
      dsRegistryAppId: dependencies.dsRegistryAppId,
      tinymanAppId: dependencies.tinymanAppId,
      arc59RouterAppId: dependencies.arc59RouterAppId,
      sender: dependencies.simulateSender
    };

    const [appIds, consensus, algoUsdPrice] = await Promise.all([
      dependencies.getAvailableContractIds(envConfig),
      dependencies.estimateConsensusApr(algod),
      dependencies.fetchAlgoUsdPrice(fetchImpl)
    ]);

    if (algoUsdPrice === null || !(algoUsdPrice > 0)) {
      throw new MythFinanceAdapterError("Failed to resolve ALGO USD price for Myth TVL.");
    }

    const listings = await mapWithConcurrency(
      appIds,
      LISTING_CONCURRENCY,
      async (appId) => {
        try {
          return await dependencies.getListingAndFees(envConfig, appId);
        } catch {
          return null;
        }
      }
    );

    const snapshots = listings.filter(
      (entry): entry is MythListingSnapshot => entry !== null
    );
    const snapshotAppIds = snapshots.map((entry) => entry.appId);

    let farmsByAppId = new Map<bigint, FarmStateAndAPR>();
    try {
      farmsByAppId = await dependencies.getFarmsAndApr(envConfig, snapshotAppIds);
    } catch {
      farmsByAppId = new Map();
    }

    const opportunities: OpportunityMarketRecord[] = [];
    for (const snapshot of snapshots) {
      const farm = farmsByAppId.get(snapshot.appId);
      const staking = normalizeMythStakingOpportunity({
        snapshot,
        consensusApr: consensus.apr,
        sampleSize: consensus.sampleSize,
        algoUsdPrice,
        ...(farm !== undefined ? { farm } : {}),
        fetchedAtIso
      });
      if (staking !== null) {
        opportunities.push(staking);
      }

      const farmOpportunity = normalizeMythFarmOpportunity({
        snapshot,
        ...(farm !== undefined ? { farm } : {}),
        algoUsdPrice,
        fetchedAtIso
      });
      if (farmOpportunity !== null) {
        opportunities.push(farmOpportunity);
      }
    }

    return opportunities;
  } catch (error) {
    if (error instanceof MythFinanceAdapterError) {
      throw error;
    }
    throw new MythFinanceAdapterError("Myth Finance adapter request failed.", error);
  }
}

export function normalizeMythStakingOpportunity(input: {
  snapshot: MythListingSnapshot;
  consensusApr: number;
  sampleSize: number;
  algoUsdPrice: number;
  farm?: FarmStateAndAPR;
  fetchedAtIso: string;
}): OpportunityMarketRecord | null {
  const { snapshot, consensusApr, sampleSize, algoUsdPrice, farm, fetchedAtIso } = input;
  const { listing, platformFeeBps, noderunnerFeeBps, appId } = snapshot;

  if (!Number.isFinite(consensusApr) || consensusApr < 0) {
    return null;
  }
  if (listing.staked <= 0n) {
    return null;
  }

  const feeFraction = (platformFeeBps + noderunnerFeeBps) / FEE_BPS_SCALE;
  if (!Number.isFinite(feeFraction) || feeFraction < 0 || feeFraction >= 1) {
    return null;
  }

  const tvlUsd = (Number(listing.staked) / MICRO_ALGO) * algoUsdPrice;
  if (!Number.isFinite(tvlUsd) || tvlUsd <= 0) {
    return null;
  }

  const consensusNetApr = consensusApr * (1 - feeFraction);
  const farmAprPercentage = activeFarmAprPercentage(farm);
  const apy = consensusNetApr + farmAprPercentage;
  if (!Number.isFinite(apy) || apy < 0) {
    return null;
  }

  const appIdNumber = Number(appId);
  const asaId = Number(listing.asaId);
  const lstId = Number(listing.lstId);
  if (
    !Number.isInteger(appIdNumber) ||
    !Number.isInteger(asaId) ||
    !Number.isInteger(lstId) ||
    asaId < 0 ||
    lstId < 1
  ) {
    return null;
  }

  const unitName = listing.asaUnitName || listing.asaName || `ASA-${asaId}`;
  const lstName = listing.lstName || `dS-${lstId}`;
  const notes = [
    `Myth Finance dualSTAKE ${lstName}. Mint deposits ALGO + a small ${unitName} leg; receipt is ${lstName}.`,
    `Redeem is not 1:1 ALGO — burns ${lstName} for mostly ALGO plus a small amount of ${unitName}.`,
    `APY from Algorand consensus rewards (Foundation bonus + ${CONSENSUS_PAYOUT_FEE_PERCENT}% of fees) / online stake, ` +
      `net of platform fee ${(platformFeeBps / 100).toFixed(2)}% and node-runner fee ${(noderunnerFeeBps / 100).toFixed(2)}%.`,
    farmAprPercentage > 0
      ? `Includes active farm incentive ${farmAprPercentage.toFixed(2)}% APR (passive; accrues while holding ${lstName}).`
      : "No active farm incentive on this instance.",
    listing.isOnline ? "Contract is online for consensus." : "Contract is currently offline.",
    `Fee share averaged over ${sampleSize} recent blocks. TVL is staked ALGO at ALGO/USD (excludes ASA inventory).`
  ].join(" ");

  return {
    protocol: "myth-finance",
    opportunityType: "staking",
    opportunityId: mythStakingOpportunityId(appIdNumber),
    assetPair: `ALGO/${unitName}→${lstName}`,
    assetIds: [0, asaId, lstId],
    apy,
    yieldBasis: "apy",
    tvlUsd,
    apr: consensusApr,
    ...buildSourceMetadata({
      fetchedAtIso,
      contextNotes: [notes]
    })
  };
}

export function normalizeMythFarmOpportunity(input: {
  snapshot: MythListingSnapshot;
  farm?: FarmStateAndAPR;
  algoUsdPrice: number;
  fetchedAtIso: string;
}): OpportunityMarketRecord | null {
  const { snapshot, farm, algoUsdPrice, fetchedAtIso } = input;
  const farmAprPercentage = activeFarmAprPercentage(farm);
  if (farmAprPercentage <= 0 || farm === undefined) {
    return null;
  }

  const { listing, appId } = snapshot;
  if (listing.staked <= 0n) {
    return null;
  }

  const tvlUsd = (Number(listing.staked) / MICRO_ALGO) * algoUsdPrice;
  if (!Number.isFinite(tvlUsd) || tvlUsd <= 0) {
    return null;
  }

  const appIdNumber = Number(appId);
  const asaId = Number(listing.asaId);
  const lstId = Number(listing.lstId);
  if (
    !Number.isInteger(appIdNumber) ||
    !Number.isInteger(asaId) ||
    !Number.isInteger(lstId) ||
    asaId < 0 ||
    lstId < 1
  ) {
    return null;
  }

  const unitName = listing.asaUnitName || listing.asaName || `ASA-${asaId}`;
  const lstName = listing.lstName || `dS-${lstId}`;
  const remainingHours = Number(farm.remainingDurationSec) / 3600;
  const remainingNote = Number.isFinite(remainingHours)
    ? `About ${Math.max(0, remainingHours).toFixed(1)} hours remaining.`
    : "Remaining duration unknown.";

  return {
    protocol: "myth-finance",
    opportunityType: "farm",
    opportunityId: mythFarmOpportunityId(appIdNumber),
    assetPair: `${lstName} farm (${unitName})`,
    assetIds: [0, asaId, lstId],
    apy: farmAprPercentage,
    yieldBasis: "apr",
    tvlUsd,
    apr: farmAprPercentage,
    ...buildSourceMetadata({
      fetchedAtIso,
      contextNotes: [
        `Myth Finance dualSTAKE farm for ${lstName}. Farm rewards accrue passively into the LST ` +
          `exchange rate — enter by minting (ALGO + small ${unitName} leg), exit by redeeming ${lstName} ` +
          `for mostly ALGO plus a small amount of ${unitName} (not 1:1 ALGO). ` +
          `${remainingNote}`
      ]
    })
  };
}

function activeFarmAprPercentage(farm?: FarmStateAndAPR): number {
  if (farm === undefined) {
    return 0;
  }
  const remaining = Number(farm.remainingDurationSec);
  if (!Number.isFinite(remaining) || remaining <= 0) {
    return 0;
  }
  const farmAprBps = Number(farm.farmAprBps);
  if (!Number.isFinite(farmAprBps) || farmAprBps <= 0) {
    return 0;
  }
  // Consensus APR is percentage points; convert farm bps (582 = 5.82%).
  return farmAprBps / 100;
}

function resolveDependencies(): MythFinanceDependencies {
  return {
    createAlgodClient: createMythAlgodClient,
    createAlgorandClient: (algod) => AlgorandClient.fromClients({ algod }),
    estimateConsensusApr: (algod) => estimateConsensusStakingApr(algod),
    fetchAlgoUsdPrice: fetchTinymanAlgoUsdPrice,
    getAvailableContractIds: (config) => DualStake.getAvailableContractIDs(config),
    getListingAndFees: async (config, appId) => {
      const client = DualStake.getContractAppClient({ ...config, appId });
      const state = await client.getState();
      return {
        appId,
        listing: {
          round: state.round,
          appId: state.appId,
          rate: state.rate,
          algoBalance: state.algoBalance,
          asaBalance: state.asaBalance,
          staked: state.staked,
          lstId: state.lstId,
          lstName: state.lstName,
          asaId: state.asaId,
          asaName: state.asaName,
          asaUnitName: state.asaUnitName,
          asaDecimals: state.asaDecimals,
          needSwap: state.needSwap,
          incentiveEligible: state.incentiveEligible,
          isOnline: state.isOnline,
          upgrading: state.upgrading,
          userProtestingStake: state.userProtestingStake
        },
        platformFeeBps: toBpsNumber(state.platformFeeBps),
        noderunnerFeeBps: toBpsNumber(state.noderunnerFeeBps)
      };
    },
    getFarmsAndApr: async (config, appIds) => {
      if (appIds.length === 0) {
        return new Map();
      }
      const farmSdk = new DSFarmSDK({
        appId: MYTH_DS_FARM_APP_ID,
        algorand: config.algorand,
        sender: config.sender
      });
      const knownFarms = await farmSdk.getFarms();
      const farmAppIds = appIds.filter((appId) => knownFarms.has(appId));
      if (farmAppIds.length === 0) {
        return new Map();
      }
      return farmSdk.getFarmsAndAPR(farmAppIds);
    },
    dsRegistryAppId: readBigIntEnv("MYTH_DS_REGISTRY_APP_ID", MYTH_DS_REGISTRY_APP_ID),
    dsFarmAppId: readBigIntEnv("MYTH_DS_FARM_APP_ID", MYTH_DS_FARM_APP_ID),
    tinymanAppId: MYTH_TINYMAN_APP_ID,
    arc59RouterAppId: MYTH_ARC59_ROUTER_APP_ID,
    simulateSender: process.env.MYTH_SIMULATE_SENDER ?? MYTH_SIMULATE_SENDER,
    ...mythFinanceDependencyOverrides
  };
}

function toBpsNumber(value: bigint | number): number {
  const asNumber = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isFinite(asNumber) || asNumber < 0) {
    return 0;
  }
  return asNumber;
}

function readBigIntEnv(name: string, fallback: bigint): bigint {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  try {
    return BigInt(raw);
  } catch {
    return fallback;
  }
}

function createMythAlgodClient(): Algodv2 {
  const server = process.env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud";
  const token = process.env.X402_ALGOD_TOKEN ?? "";
  return new algosdk.Algodv2(token, trimTrailingSlash(server), "");
}

async function fetchTinymanAlgoUsdPrice(
  fetchImpl: typeof fetch
): Promise<number | null> {
  const baseUrl =
    process.env.TINYMAN_API_BASE_URL ?? "https://mainnet.analytics.tinyman.org/api/v1";
  const apiKey = process.env.TINYMAN_API_KEY;
  const requestUrl = `${trimTrailingSlash(baseUrl)}/assets/0/`;
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

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) {
        continue;
      }
      results[index] = await mapper(item);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

/** @internal exported for shapes */
export type { DSContractListing, DSContractState, DSEnvironmentConfig };
