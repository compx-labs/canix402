import algosdk, { Algodv2 } from "algosdk";
import { TinymanTAlgoClient } from "@tinymanorg/tinyman-js-sdk";

import {
  CONSENSUS_PAYOUT_FEE_PERCENT,
  estimateConsensusStakingApr,
  type ConsensusStakingAprEstimate
} from "../services/consensus-staking-apr.js";
import { buildSourceMetadata } from "../services/source-metadata.js";
import { OpportunityMarketRecord } from "../types/opportunity.js";
import {
  STALGO_ASSET_ID,
  TALGO_ASSET_ID,
  TINY_ASSET_ID,
  TINYMAN_RESTAKE_APP_ID
} from "../execution/shapes/tinyman/liquid-stake-state.js";

/** Mainnet tALGO ASA (Tinyman liquid staking). */
const TALGO_MAINNET_ASSET_ID = TALGO_ASSET_ID.mainnet;
const STALGO_MAINNET_ASSET_ID = STALGO_ASSET_ID.mainnet;
const TINY_MAINNET_ASSET_ID = TINY_ASSET_ID.mainnet;
const RESTAKE_APP_ID_MAINNET = TINYMAN_RESTAKE_APP_ID.mainnet;
const SECONDS_PER_YEAR = 365.25 * 24 * 60 * 60;

/**
 * Pools always fetched by address in addition to the top-N list.
 * COMPX/ALGO often falls outside TINYMAN_POOL_LIMIT due to lower liquidity.
 */
export const TINYMAN_DEFAULT_EXTRA_POOL_ADDRESSES = [
  "ZKAP7DLHJ25VTHPD3W73FGDM7VGU3DJAXL7GNUFW5CG4MIMY72EZ5GFIAI"
] as const;

interface TinymanPoolApiRecord {
  address?: string;
  version?: string;
  is_verified?: boolean | null;
  annual_percentage_rate?: number | string | null;
  annual_percentage_yield?: number | string | null;
  total_annual_percentage_rate?: number | string | null;
  total_annual_percentage_yield?: number | string | null;
  staking_total_annual_percentage_rate?: number | string | null;
  staking_total_annual_percentage_yield?: number | string | null;
  liquidity_in_usd?: number | string | null;
  is_stable?: boolean | null;
  asset_1?: { id?: number | string | null; unit_name?: string | null; name?: string | null };
  asset_2?: { id?: number | string | null; unit_name?: string | null; name?: string | null };
}

interface TinymanApiResponse {
  results?: TinymanPoolApiRecord[];
}

interface TinymanAssetApiRecord {
  price_in_usd?: number | string | null;
}

/** Tinyman deducts 8% of consensus block rewards before accruing into tALGO. */
export const TINYMAN_LIQUID_STAKE_PROTOCOL_FEE = 0.08;
export const TINYMAN_TALGO_STAKING_OPPORTUNITY_ID = "tinyman-staking-talgo";
export const TINYMAN_STALGO_STAKING_OPPORTUNITY_ID = "tinyman-staking-stalgo";

export class TinymanAdapterError extends Error {
  public readonly cause?: unknown;

  public constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "TinymanAdapterError";
    this.cause = cause;
  }
}

interface TinymanRestakeGlobalState {
  totalStakedAmount: bigint;
  currentRewardRatePerTime: bigint;
}

interface TinymanAdapterDependencies {
  estimateConsensusApr: () => Promise<ConsensusStakingAprEstimate>;
  createAlgodClient: () => Algodv2;
  getTAlgoCirculatingSupply: (algod: Algodv2) => Promise<bigint>;
  getAlgoToTAlgoRatio: (algod: Algodv2) => Promise<number>;
  getRestakeGlobalState: (algod: Algodv2) => Promise<TinymanRestakeGlobalState>;
  fetchAlgoUsdPrice: (fetchImpl: typeof fetch) => Promise<number | null>;
  fetchAssetUsdPrice: (
    fetchImpl: typeof fetch,
    assetId: number
  ) => Promise<number | null>;
}

let tinymanDependencyOverrides: Partial<TinymanAdapterDependencies> | undefined;

export function setTinymanAdapterDependenciesForTests(
  overrides?: Partial<TinymanAdapterDependencies>
): void {
  tinymanDependencyOverrides = overrides;
}

function resolveTinymanDependencies(): TinymanAdapterDependencies {
  return {
    estimateConsensusApr: () => estimateConsensusStakingApr(),
    createAlgodClient: createTinymanAlgodClient,
    getTAlgoCirculatingSupply: async (algod) => {
      const client = new TinymanTAlgoClient(algod, "mainnet");
      return client.getCirculatingSupply();
    },
    getAlgoToTAlgoRatio: async (algod) => {
      const client = new TinymanTAlgoClient(algod, "mainnet");
      return client.getRatio();
    },
    getRestakeGlobalState: fetchTinymanRestakeGlobalState,
    fetchAlgoUsdPrice: fetchTinymanAlgoUsdPrice,
    fetchAssetUsdPrice: fetchTinymanAssetUsdPrice,
    ...tinymanDependencyOverrides
  };
}

export async function fetchTinymanOpportunities(
  fetchImpl: typeof fetch = fetch
): Promise<OpportunityMarketRecord[]> {
  const baseUrl = trimTrailingSlash(
    process.env.TINYMAN_API_BASE_URL ?? "https://mainnet.analytics.tinyman.org/api/v1"
  );
  const apiKey = process.env.TINYMAN_API_KEY;
  const query = new URLSearchParams({
    with_statistics: "true",
    limit: process.env.TINYMAN_POOL_LIMIT ?? "100"
  });
  const versions = parseVersions(process.env.TINYMAN_POOL_VERSIONS ?? "2.0");
  for (const version of versions) {
    query.append("version__in", version);
  }
  const requestUrl = `${baseUrl}/pools/?${query.toString()}`;
  const fetchedAt = new Date().toISOString();
  const onlyVerified = parseBoolean(process.env.TINYMAN_ONLY_VERIFIED, true);
  const extraPoolAddresses = resolveExtraPoolAddresses();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const requestInit: RequestInit = {
      signal: controller.signal
    };
    if (apiKey) {
      requestInit.headers = { authorization: `Bearer ${apiKey}` };
    }

    const [poolResponse, extraPoolRecords, tAlgoStaking, stAlgoStaking] =
      await Promise.all([
        fetchImpl(requestUrl, {
          ...requestInit
        }),
        Promise.all(
          extraPoolAddresses.map((address) =>
            fetchTinymanPoolByAddress(baseUrl, address, fetchImpl, requestInit).catch(
              () => null
            )
          )
        ),
        fetchTinymanTAlgoStakingOpportunity(fetchImpl, fetchedAt).catch(() => null),
        fetchTinymanStAlgoStakingOpportunity(fetchImpl, fetchedAt).catch(() => null)
      ]);

    if (!poolResponse.ok) {
      throw new TinymanAdapterError(
        `Tinyman API returned non-2xx status: ${poolResponse.status}`
      );
    }

    const payload = (await poolResponse.json()) as TinymanApiResponse;
    const listRecords = payload.results ?? [];
    const extraRecords = extraPoolRecords.filter(
      (record): record is TinymanPoolApiRecord => record !== null
    );
    const records = mergePoolRecordsByAddress(listRecords, extraRecords);

    const poolOpportunities = records
      .filter((record) => (onlyVerified ? record.is_verified === true : true))
      .flatMap((record) => normalizeTinymanPoolOpportunities(record, fetchedAt));

    const liquidStake = [tAlgoStaking, stAlgoStaking].filter(
      (entry): entry is OpportunityMarketRecord => entry !== null
    );
    return [...poolOpportunities, ...liquidStake];
  } catch (error) {
    if (error instanceof TinymanAdapterError) {
      throw error;
    }

    throw new TinymanAdapterError("Tinyman adapter request failed.", error);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch a single pool by address. Non-2xx / invalid payloads return null so the
 * adapter can still return the top-N list when an extra pool is unavailable.
 */
async function fetchTinymanPoolByAddress(
  baseUrl: string,
  address: string,
  fetchImpl: typeof fetch,
  requestInit: RequestInit
): Promise<TinymanPoolApiRecord | null> {
  const requestUrl = `${baseUrl}/pools/${encodeURIComponent(address)}/`;
  const response = await fetchImpl(requestUrl, requestInit);
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as unknown;
  return parseTinymanPoolDetail(payload);
}

/**
 * Accept a pool detail object (has top-level `address`). Skip list-shaped
 * `{ results: [...] }` payloads so URL-agnostic test mocks keep working.
 */
export function parseTinymanPoolDetail(
  payload: unknown
): TinymanPoolApiRecord | null {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const record = payload as TinymanPoolApiRecord & { results?: unknown };
  if (Array.isArray(record.results)) {
    return null;
  }
  if (typeof record.address !== "string" || record.address.length === 0) {
    return null;
  }
  return record;
}

function mergePoolRecordsByAddress(
  listRecords: TinymanPoolApiRecord[],
  extraRecords: TinymanPoolApiRecord[]
): TinymanPoolApiRecord[] {
  const byAddress = new Map<string, TinymanPoolApiRecord>();
  for (const record of listRecords) {
    const address = record.address?.trim();
    if (address) {
      byAddress.set(address, record);
    } else {
      // Preserve address-less rows from the list (normalize will fall back).
      byAddress.set(`__anon_${byAddress.size}`, record);
    }
  }
  for (const record of extraRecords) {
    const address = record.address?.trim();
    if (!address) {
      continue;
    }
    if (!byAddress.has(address)) {
      byAddress.set(address, record);
    }
  }
  return [...byAddress.values()];
}

export function resolveExtraPoolAddresses(
  envValue: string | undefined = process.env.TINYMAN_EXTRA_POOL_ADDRESSES
): string[] {
  const fromEnv = (envValue ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && algosdk.isValidAddress(entry));
  const seen = new Set<string>();
  const addresses: string[] = [];
  for (const address of [...TINYMAN_DEFAULT_EXTRA_POOL_ADDRESSES, ...fromEnv]) {
    if (seen.has(address)) {
      continue;
    }
    seen.add(address);
    addresses.push(address);
  }
  return addresses;
}

export async function fetchTinymanTAlgoStakingOpportunity(
  fetchImpl: typeof fetch = fetch,
  fetchedAtIso: string = new Date().toISOString()
): Promise<OpportunityMarketRecord | null> {
  const dependencies = resolveTinymanDependencies();

  try {
    const algod = dependencies.createAlgodClient();
    const [consensus, circulatingSupply, algoToTAlgoRatio, algoUsdPrice] =
      await Promise.all([
        dependencies.estimateConsensusApr(),
        dependencies.getTAlgoCirculatingSupply(algod),
        dependencies.getAlgoToTAlgoRatio(algod),
        dependencies.fetchAlgoUsdPrice(fetchImpl)
      ]);

    return normalizeTinymanTAlgoStakingOpportunity({
      consensusApr: consensus.apr,
      circulatingSupply,
      algoToTAlgoRatio,
      algoUsdPrice,
      sampleSize: consensus.sampleSize,
      fetchedAtIso
    });
  } catch {
    return null;
  }
}

export async function fetchTinymanStAlgoStakingOpportunity(
  fetchImpl: typeof fetch = fetch,
  fetchedAtIso: string = new Date().toISOString()
): Promise<OpportunityMarketRecord | null> {
  const dependencies = resolveTinymanDependencies();

  try {
    const algod = dependencies.createAlgodClient();
    const [restake, algoToTAlgoRatio, algoUsdPrice, tinyUsdPrice] =
      await Promise.all([
        dependencies.getRestakeGlobalState(algod),
        dependencies.getAlgoToTAlgoRatio(algod),
        dependencies.fetchAlgoUsdPrice(fetchImpl),
        dependencies.fetchAssetUsdPrice(fetchImpl, TINY_MAINNET_ASSET_ID)
      ]);

    return normalizeTinymanStAlgoStakingOpportunity({
      totalStakedAmount: restake.totalStakedAmount,
      currentRewardRatePerTime: restake.currentRewardRatePerTime,
      algoToTAlgoRatio,
      algoUsdPrice,
      tinyUsdPrice,
      fetchedAtIso
    });
  } catch {
    return null;
  }
}

export function normalizeTinymanTAlgoStakingOpportunity(input: {
  consensusApr: number;
  circulatingSupply: bigint;
  algoToTAlgoRatio: number;
  algoUsdPrice: number | null;
  sampleSize: number;
  fetchedAtIso: string;
}): OpportunityMarketRecord | null {
  const {
    consensusApr,
    circulatingSupply,
    algoToTAlgoRatio,
    algoUsdPrice,
    sampleSize,
    fetchedAtIso
  } = input;

  if (
    !Number.isFinite(consensusApr) ||
    consensusApr < 0 ||
    circulatingSupply <= 0n ||
    !(algoToTAlgoRatio > 0) ||
    !Number.isFinite(algoToTAlgoRatio) ||
    algoUsdPrice === null ||
    !(algoUsdPrice > 0)
  ) {
    return null;
  }

  const stakedAlgoBaseUnits = Number(circulatingSupply) * algoToTAlgoRatio;
  if (!Number.isFinite(stakedAlgoBaseUnits) || stakedAlgoBaseUnits <= 0) {
    return null;
  }

  const tvlUsd = (stakedAlgoBaseUnits / 1_000_000) * algoUsdPrice;
  const apy = consensusApr * (1 - TINYMAN_LIQUID_STAKE_PROTOCOL_FEE);
  if (!Number.isFinite(apy) || !Number.isFinite(tvlUsd) || tvlUsd <= 0) {
    return null;
  }

  return {
    protocol: "tinyman",
    opportunityType: "staking",
    opportunityId: TINYMAN_TALGO_STAKING_OPPORTUNITY_ID,
    assetPair: "ALGO/tALGO",
    assetIds: [0, TALGO_MAINNET_ASSET_ID],
    apy,
    yieldBasis: "apy",
    tvlUsd,
    apr: consensusApr,
    ...buildSourceMetadata({
      fetchedAtIso,
      contextNotes: [
        `Tinyman tALGO liquid staking. APY from Algorand consensus rewards ` +
          `(Foundation bonus + ${CONSENSUS_PAYOUT_FEE_PERCENT}% of fees) / online stake, net of Tinyman's ` +
          `${TINYMAN_LIQUID_STAKE_PROTOCOL_FEE * 100}% protocol fee. ` +
          `Fee share averaged over ${sampleSize} recent blocks.`
      ]
    })
  };
}

export function normalizeTinymanStAlgoStakingOpportunity(input: {
  totalStakedAmount: bigint;
  currentRewardRatePerTime: bigint;
  algoToTAlgoRatio: number;
  algoUsdPrice: number | null;
  tinyUsdPrice: number | null;
  fetchedAtIso: string;
}): OpportunityMarketRecord | null {
  const {
    totalStakedAmount,
    currentRewardRatePerTime,
    algoToTAlgoRatio,
    algoUsdPrice,
    tinyUsdPrice,
    fetchedAtIso
  } = input;

  if (
    totalStakedAmount <= 0n ||
    currentRewardRatePerTime < 0n ||
    !(algoToTAlgoRatio > 0) ||
    !Number.isFinite(algoToTAlgoRatio) ||
    algoUsdPrice === null ||
    !(algoUsdPrice > 0) ||
    tinyUsdPrice === null ||
    !(tinyUsdPrice > 0)
  ) {
    return null;
  }

  const stakedAlgoBaseUnits = Number(totalStakedAmount) * algoToTAlgoRatio;
  if (!Number.isFinite(stakedAlgoBaseUnits) || stakedAlgoBaseUnits <= 0) {
    return null;
  }

  const tvlUsd = (stakedAlgoBaseUnits / 1_000_000) * algoUsdPrice;
  const tinyPerYear = Number(currentRewardRatePerTime) * SECONDS_PER_YEAR;
  if (!Number.isFinite(tinyPerYear) || tinyPerYear < 0) {
    return null;
  }
  const rewardUsdPerYear = (tinyPerYear / 1_000_000) * tinyUsdPrice;
  if (!Number.isFinite(tvlUsd) || tvlUsd <= 0 || !Number.isFinite(rewardUsdPerYear)) {
    return null;
  }

  const apr = (rewardUsdPerYear / tvlUsd) * 100;
  if (!Number.isFinite(apr) || apr < 0) {
    return null;
  }

  return {
    protocol: "tinyman",
    opportunityType: "staking",
    opportunityId: TINYMAN_STALGO_STAKING_OPPORTUNITY_ID,
    assetPair: "tALGO/stALGO",
    assetIds: [TALGO_MAINNET_ASSET_ID, STALGO_MAINNET_ASSET_ID],
    apy: apr,
    yieldBasis: "apr",
    tvlUsd,
    apr,
    ...buildSourceMetadata({
      fetchedAtIso,
      contextNotes: [
        "Tinyman stALGO restake. APR estimated from restake app " +
          "`current_reward_rate_per_time` (TINY/sec) × TINY USD / staked TVL " +
          "(tALGO stake valued via ALGO/tALGO ratio). Claim requires TINY power; " +
          "stALGO is non-transferable while staked."
      ]
    })
  };
}

async function fetchTinymanAlgoUsdPrice(
  fetchImpl: typeof fetch
): Promise<number | null> {
  return fetchTinymanAssetUsdPrice(fetchImpl, 0);
}

async function fetchTinymanAssetUsdPrice(
  fetchImpl: typeof fetch,
  assetId: number
): Promise<number | null> {
  const baseUrl =
    process.env.TINYMAN_API_BASE_URL ?? "https://mainnet.analytics.tinyman.org/api/v1";
  const apiKey = process.env.TINYMAN_API_KEY;
  const requestUrl = `${trimTrailingSlash(baseUrl)}/assets/${assetId}/`;
  const requestInit: RequestInit = {};
  if (apiKey) {
    requestInit.headers = { authorization: `Bearer ${apiKey}` };
  }

  const response = await fetchImpl(requestUrl, requestInit);
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json()) as TinymanAssetApiRecord;
  return toNumber(payload.price_in_usd);
}

async function fetchTinymanRestakeGlobalState(
  algod: Algodv2
): Promise<TinymanRestakeGlobalState> {
  const app = await algod.getApplicationByID(RESTAKE_APP_ID_MAINNET).do();
  const values = new Map<string, bigint>();
  for (const entry of app.params?.globalState ?? []) {
    const key = Buffer.from(entry.key).toString("utf8");
    values.set(key, BigInt(entry.value.uint ?? 0));
  }

  const totalStakedAmount = values.get("total_staked_amount");
  const currentRewardRatePerTime = values.get("current_reward_rate_per_time");
  if (totalStakedAmount === undefined || currentRewardRatePerTime === undefined) {
    throw new TinymanAdapterError(
      "Tinyman restake app is missing total_staked_amount or current_reward_rate_per_time."
    );
  }

  return { totalStakedAmount, currentRewardRatePerTime };
}

function createTinymanAlgodClient(): Algodv2 {
  const server = process.env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud";
  const token = process.env.X402_ALGOD_TOKEN ?? "";
  return new algosdk.Algodv2(token, trimTrailingSlash(server), "");
}

export function normalizeTinymanPool(
  record: TinymanPoolApiRecord,
  fetchedAtIso: string = new Date().toISOString()
): OpportunityMarketRecord | null {
  const sourceApy =
    toNumber(record.annual_percentage_yield) ??
    toNumber(record.total_annual_percentage_yield);
  const tvlUsd = toNumber(record.liquidity_in_usd);

  if (sourceApy === null || tvlUsd === null) {
    return null;
  }

  const sourceApr =
    toNumber(record.annual_percentage_rate) ??
    toNumber(record.total_annual_percentage_rate);
  // Tinyman's analytics API expresses annual yield/rate fields as decimal
  // fractions (0.280425 = 28.0425%). OpportunityMarketRecord uses percentage
  // points, consistent with the values displayed in Tinyman's UI.
  const apy = toPercentagePoints(sourceApy);
  const apr = sourceApr === null ? null : toPercentagePoints(sourceApr);
  const id = record.address ?? "";
  const pairName = buildPairName(record);
  const assetIds = buildAssetIds(record);
  const usedFallbackIdentifiers = id.length === 0 || pairName.length === 0;

  return {
    protocol: "tinyman",
    opportunityType: "lp",
    opportunityId: id.length > 0 ? `${id}:lp` : `tinyman-${pairName || "unknown"}:lp`,
    assetPair: pairName || "unknown/unknown",
    ...(assetIds.length > 0 ? { assetIds } : {}),
    apy,
    yieldBasis: "apy",
    tvlUsd,
    ...(apr !== null ? { apr } : {}),
    ...buildSourceMetadata({
      fetchedAtIso,
      usedFallbackIdentifiers
    })
  };
}

function normalizeTinymanPoolOpportunities(
  record: TinymanPoolApiRecord,
  fetchedAtIso: string
): OpportunityMarketRecord[] {
  const output: OpportunityMarketRecord[] = [];
  const lpOpportunity = normalizeTinymanPool(record, fetchedAtIso);
  if (lpOpportunity !== null) {
    output.push(lpOpportunity);
  }

  const farmOpportunity = normalizeTinymanFarm(record, fetchedAtIso);
  if (farmOpportunity !== null) {
    output.push(farmOpportunity);
  }

  return output;
}

function normalizeTinymanFarm(
  record: TinymanPoolApiRecord,
  fetchedAtIso: string
): OpportunityMarketRecord | null {
  const sourceStakingApy = toNumber(record.staking_total_annual_percentage_yield);
  const sourceStakingApr = toNumber(record.staking_total_annual_percentage_rate);
  const tvlUsd = toNumber(record.liquidity_in_usd);
  if (tvlUsd === null) {
    return null;
  }

  const hasFarmData =
    (sourceStakingApy !== null && sourceStakingApy > 0) ||
    (sourceStakingApr !== null && sourceStakingApr > 0);
  if (!hasFarmData) {
    return null;
  }
  const stakingApy =
    sourceStakingApy === null ? null : toPercentagePoints(sourceStakingApy);
  const stakingApr =
    sourceStakingApr === null ? null : toPercentagePoints(sourceStakingApr);

  const id = record.address ?? "";
  const pairName = buildPairName(record);
  const assetIds = buildAssetIds(record);
  const usedFallbackIdentifiers = id.length === 0 || pairName.length === 0;

  return {
    protocol: "tinyman",
    opportunityType: "farm",
    opportunityId: id.length > 0 ? `${id}:farm` : `tinyman-${pairName || "unknown"}:farm`,
    assetPair: pairName || "unknown/unknown",
    ...(assetIds.length > 0 ? { assetIds } : {}),
    apy: stakingApy ?? 0,
    yieldBasis: "apy",
    tvlUsd,
    ...(stakingApr !== null ? { apr: stakingApr } : {}),
    ...buildSourceMetadata({
      fetchedAtIso,
      usedFallbackIdentifiers
    })
  };
}

function buildAssetIds(record: TinymanPoolApiRecord): number[] {
  return [record.asset_1?.id, record.asset_2?.id]
    .map((value) => toAssetId(value))
    .filter((value): value is number => value !== null);
}

function toAssetId(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function buildPairName(record: TinymanPoolApiRecord): string {
  const left = record.asset_1?.unit_name ?? record.asset_1?.name;
  const right = record.asset_2?.unit_name ?? record.asset_2?.name;

  if (left && right) {
    return `${left}/${right}`;
  }
  if (left) {
    return `${left}/unknown`;
  }
  if (right) {
    return `unknown/${right}`;
  }

  return "";
}

function toNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toPercentagePoints(value: number): number {
  return value * 100;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function parseVersions(value: string): string[] {
  const versions = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return versions.length > 0 ? versions : ["2.0"];
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
