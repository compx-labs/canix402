import { Algodv2 } from "algosdk";

import type {
  OpportunityCapacity,
  OpportunityEntryGate,
  OpportunityEntryRequirements,
  OpportunityMarketRecord
} from "../types/opportunity.js";
import {
  estimateConsensusStakingApr,
  type ConsensusStakingAprEstimate
} from "../services/consensus-staking-apr.js";
import { buildSourceMetadata } from "../services/source-metadata.js";
import {
  createRetiAlgodClient,
  retiGetCurMaxStakePerPool,
  retiGetNumValidators,
  retiGetPools,
  retiGetValidatorConfig,
  retiGetValidatorState,
  type RetiPoolInfo,
  type RetiValidatorConfig,
  type RetiValidatorState
} from "../reti/abi.js";
import {
  RETI_GATING_TYPE_ASSET_ID,
  RETI_GATING_TYPE_ASSETS_CREATED_BY,
  RETI_GATING_TYPE_CREATED_BY_NFD_ADDRESSES,
  RETI_GATING_TYPE_NONE,
  RETI_GATING_TYPE_SEGMENT_OF_NFD,
  RETI_MAX_STAKERS_PER_POOL,
  RETI_PERCENT_TO_VALIDATOR_SCALE,
  RETI_STAKING_OPPORTUNITY_ID_PREFIX,
  RETI_VALIDATOR_REGISTRY_APP_ID,
  RETI_ZERO_ADDRESS
} from "../reti/constants.js";

const MICRO_ALGO = 1_000_000;
const VALIDATOR_CONCURRENCY = 3;

export class RetiAdapterError extends Error {
  public readonly cause?: unknown;

  public constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "RetiAdapterError";
    this.cause = cause;
  }
}

export function retiStakingOpportunityId(validatorId: number | bigint): string {
  return `${RETI_STAKING_OPPORTUNITY_ID_PREFIX}${validatorId.toString()}`;
}

export function parseRetiValidatorId(opportunityId: string): number | null {
  if (!opportunityId.startsWith(RETI_STAKING_OPPORTUNITY_ID_PREFIX)) {
    return null;
  }
  const value = Number(opportunityId.slice(RETI_STAKING_OPPORTUNITY_ID_PREFIX.length));
  if (!Number.isInteger(value) || value < 1) {
    return null;
  }
  return value;
}

export function isRetiStakingOpportunityId(opportunityId: string): boolean {
  return parseRetiValidatorId(opportunityId) !== null;
}

export interface RetiValidatorSnapshot {
  validatorId: number;
  config: RetiValidatorConfig;
  state: RetiValidatorState;
  pools: RetiPoolInfo[];
  maxStakePerPool: bigint;
  currentRound: bigint;
}

interface RetiAdapterDependencies {
  createAlgodClient: () => Algodv2;
  estimateConsensusApr: (algod: Algodv2) => Promise<ConsensusStakingAprEstimate>;
  fetchAlgoUsdPrice: (fetchImpl: typeof fetch) => Promise<number | null>;
  getNumValidators: (algod: Algodv2, appId: number) => Promise<number>;
  getValidatorSnapshot: (
    algod: Algodv2,
    validatorId: number,
    appId: number
  ) => Promise<RetiValidatorSnapshot>;
  registryAppId: number;
}

let retiDependencyOverrides: Partial<RetiAdapterDependencies> | undefined;

export function setRetiAdapterDependenciesForTests(
  overrides?: Partial<RetiAdapterDependencies>
): void {
  retiDependencyOverrides = overrides;
}

function resolveDependencies(): RetiAdapterDependencies {
  return {
    createAlgodClient: createRetiAlgodClient,
    estimateConsensusApr: estimateConsensusStakingApr,
    fetchAlgoUsdPrice: fetchAlgoUsdPriceViaTinyman,
    getNumValidators: retiGetNumValidators,
    getValidatorSnapshot: defaultGetValidatorSnapshot,
    registryAppId: readRegistryAppId(),
    ...retiDependencyOverrides
  };
}

function readRegistryAppId(): number {
  const raw = process.env.RETI_VALIDATOR_REGISTRY_APP_ID?.trim();
  if (raw) {
    const value = Number(raw);
    if (Number.isInteger(value) && value >= 1) {
      return value;
    }
  }
  return RETI_VALIDATOR_REGISTRY_APP_ID;
}

async function fetchAlgoUsdPriceViaTinyman(
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

  try {
    const response = await fetchImpl(requestUrl, requestInit);
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as {
      price_in_usd?: number | string | null;
    };
    const price = Number(payload.price_in_usd);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

async function defaultGetValidatorSnapshot(
  algod: Algodv2,
  validatorId: number,
  appId: number
): Promise<RetiValidatorSnapshot> {
  const [config, state, pools, maxStakePerPool, status] = await Promise.all([
    retiGetValidatorConfig(algod, validatorId, appId),
    retiGetValidatorState(algod, validatorId, appId),
    retiGetPools(algod, validatorId, appId),
    retiGetCurMaxStakePerPool(algod, validatorId, appId),
    algod.status().do()
  ]);
  return {
    validatorId,
    config,
    state,
    pools,
    maxStakePerPool,
    currentRound: BigInt(status.lastRound ?? 0)
  };
}

export async function fetchRetiOpportunities(
  fetchImpl: typeof fetch = fetch
): Promise<OpportunityMarketRecord[]> {
  const dependencies = resolveDependencies();
  const fetchedAtIso = new Date().toISOString();

  try {
    const algod = dependencies.createAlgodClient();
    const [numValidators, consensus, algoUsdPrice] = await Promise.all([
      dependencies.getNumValidators(algod, dependencies.registryAppId),
      dependencies.estimateConsensusApr(algod),
      dependencies.fetchAlgoUsdPrice(fetchImpl)
    ]);

    if (algoUsdPrice === null || !(algoUsdPrice > 0)) {
      throw new RetiAdapterError("Failed to resolve ALGO USD price for Réti TVL.");
    }
    if (!Number.isInteger(numValidators) || numValidators < 1) {
      return [];
    }

    const validatorIds = Array.from({ length: numValidators }, (_, index) => index + 1);
    const snapshots = await mapWithConcurrency(
      validatorIds,
      VALIDATOR_CONCURRENCY,
      async (validatorId) => {
        try {
          return await dependencies.getValidatorSnapshot(
            algod,
            validatorId,
            dependencies.registryAppId
          );
        } catch {
          return null;
        }
      }
    );

    const opportunities: OpportunityMarketRecord[] = [];
    for (const snapshot of snapshots) {
      if (snapshot === null) {
        continue;
      }
      const opportunity = normalizeRetiStakingOpportunity({
        snapshot,
        consensusApr: consensus.apr,
        sampleSize: consensus.sampleSize,
        algoUsdPrice,
        fetchedAtIso
      });
      if (opportunity !== null) {
        opportunities.push(opportunity);
      }
    }

    return opportunities;
  } catch (error) {
    if (error instanceof RetiAdapterError) {
      throw error;
    }
    throw new RetiAdapterError("Réti adapter request failed.", error);
  }
}

export function normalizeRetiStakingOpportunity(input: {
  snapshot: RetiValidatorSnapshot;
  consensusApr: number;
  sampleSize: number;
  algoUsdPrice: number;
  fetchedAtIso: string;
}): OpportunityMarketRecord | null {
  const { snapshot, consensusApr, sampleSize, algoUsdPrice, fetchedAtIso } = input;
  const { validatorId, config, state, pools, maxStakePerPool, currentRound } = snapshot;

  if (!Number.isFinite(consensusApr) || consensusApr < 0) {
    return null;
  }
  if (state.totalAlgoStaked <= 0n && pools.length === 0) {
    return null;
  }

  const feeFraction = config.percentToValidator / RETI_PERCENT_TO_VALIDATOR_SCALE;
  if (!Number.isFinite(feeFraction) || feeFraction < 0 || feeFraction >= 1) {
    return null;
  }

  const stakedAlgo = Number(state.totalAlgoStaked) / MICRO_ALGO;
  const tvlUsd = stakedAlgo * algoUsdPrice;
  if (!Number.isFinite(tvlUsd) || tvlUsd < 0) {
    return null;
  }

  const apy = consensusApr * (1 - feeFraction);
  if (!Number.isFinite(apy) || apy < 0) {
    return null;
  }

  const entryRequirements = buildEntryRequirements(config);
  const capacity = buildCapacity({
    pools,
    maxStakePerPool,
    sunsettingOn: config.sunsettingOn,
    currentRound,
    numPools: state.numPools
  });

  const commissionBps = Math.round(feeFraction * 10_000);
  const metadata = buildSourceMetadata({
    fetchedAtIso,
    contextNotes: [
      `Réti validator ${validatorId}; consensus APR net of ${commissionBps} bps validator commission; ` +
        `sampleSize=${sampleSize}; pools=${state.numPools}; ` +
        `minEntryStake=${config.minEntryStake.toString()} µALGO.`
    ]
  });

  return {
    protocol: "reti",
    opportunityType: "staking",
    opportunityId: retiStakingOpportunityId(validatorId),
    assetPair: "ALGO",
    assetIds: [0],
    apy,
    yieldBasis: "apr",
    apr: apy,
    tvlUsd,
    sourceTimestamp: metadata.sourceTimestamp,
    fetchedAt: metadata.fetchedAt,
    ...(metadata.notes !== undefined ? { notes: metadata.notes } : {}),
    entryRequirements,
    capacity
  };
}

export function buildEntryRequirements(
  config: RetiValidatorConfig
): OpportunityEntryRequirements {
  const gates = buildGates(config);
  // Only ASA gates are checkable in personalized matching; creator/NFD are not.
  const eligibilityFullyCheckable =
    gates.length === 0 || gates.every((gate) => gate.kind === "asa");

  const requirements: OpportunityEntryRequirements = {
    minAmount: {
      assetId: 0,
      amount: config.minEntryStake.toString()
    },
    eligibilityFullyCheckable
  };

  if (gates.length > 0) {
    requirements.gates = gates;
    requirements.gateMatch = "any";
  }

  return requirements;
}

function buildGates(config: RetiValidatorConfig): OpportunityEntryGate[] {
  const type = config.entryGatingType;
  if (type === RETI_GATING_TYPE_NONE) {
    return [];
  }

  const minBalance =
    config.gatingAssetMinBalance > 0n
      ? config.gatingAssetMinBalance.toString()
      : undefined;

  if (type === RETI_GATING_TYPE_ASSET_ID) {
    const gates: OpportunityEntryGate[] = [];
    for (const assetId of config.entryGatingAssets) {
      if (assetId <= 0n) {
        continue;
      }
      gates.push({
        kind: "asa",
        assetId: Number(assetId),
        ...(minBalance !== undefined ? { minBalance } : {})
      });
    }
    return gates;
  }

  if (type === RETI_GATING_TYPE_ASSETS_CREATED_BY) {
    if (
      !config.entryGatingAddress ||
      config.entryGatingAddress === RETI_ZERO_ADDRESS
    ) {
      return [];
    }
    return [
      {
        kind: "asa-creator",
        creator: config.entryGatingAddress,
        ...(minBalance !== undefined ? { minBalance } : {})
      }
    ];
  }

  if (type === RETI_GATING_TYPE_CREATED_BY_NFD_ADDRESSES) {
    const nfdAppId = config.entryGatingAssets[0] ?? 0n;
    if (nfdAppId <= 0n) {
      return [];
    }
    return [{ kind: "nfd-linked-creators", nfd: nfdAppId.toString() }];
  }

  if (type === RETI_GATING_TYPE_SEGMENT_OF_NFD) {
    const nfdAppId = config.entryGatingAssets[0] ?? 0n;
    if (nfdAppId <= 0n) {
      return [];
    }
    return [{ kind: "nfd-root-segment", nfdRoot: nfdAppId.toString() }];
  }

  return [];
}

export function buildCapacity(input: {
  pools: readonly RetiPoolInfo[];
  maxStakePerPool: bigint;
  sunsettingOn: bigint;
  currentRound: bigint;
  numPools: number;
}): OpportunityCapacity {
  const { pools, maxStakePerPool, sunsettingOn, currentRound, numPools } = input;

  let stakerSlotsRemaining = 0;
  let algoRoom = 0n;
  for (const pool of pools) {
    if (pool.poolAppId <= 0n) {
      continue;
    }
    stakerSlotsRemaining += Math.max(
      0,
      RETI_MAX_STAKERS_PER_POOL - pool.totalStakers
    );
    const room = maxStakePerPool - pool.totalAlgoStaked;
    if (room > 0n) {
      algoRoom += room;
    }
  }

  const sunsetActive =
    sunsettingOn > 0n && currentRound >= sunsettingOn;
  const acceptingStake =
    !sunsetActive &&
    numPools > 0 &&
    stakerSlotsRemaining > 0 &&
    algoRoom > 0n;

  return {
    stakerSlotsRemaining,
    algoRoomMicroAlgos: algoRoom.toString(),
    acceptingStake
  };
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index] as T, index);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}
