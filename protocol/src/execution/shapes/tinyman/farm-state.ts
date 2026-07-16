import { Algodv2 } from "algosdk";
import { getStakingAppID } from "@tinymanorg/tinyman-js-sdk";

import { InvalidShapeInputError, ShapeStateError } from "../../errors.js";
import type { ExecutionNetwork } from "../../types.js";
import {
  TinymanV2PoolState,
  orderTinymanAssets,
  resolveTinymanV2PoolState
} from "./pool-state.js";

/** UTF-8 prefix of the note attached to a Tinyman staking commit transaction. */
export const TINYMAN_STAKING_COMMIT_NOTE_PREFIX = "tinymanStaking/v1:b";

/** Tinyman farm commit records a commitment against the staking app via a NoOp app call. */
export const COMMIT_APP_ARG = "commit";
/** Optional second app call that logs the wallet balance of a required asset. */
export const LOG_BALANCE_APP_ARG = "log_balance";

/**
 * Resolved on-chain context needed to build a Tinyman farm commit. LP tokens
 * never leave the wallet; the commit only records the user's committed amount
 * against the staking application.
 */
export interface TinymanFarmState {
  network: ExecutionNetwork;
  /** Tinyman staking application id for the network. */
  stakingAppId: number;
  /** Tinyman staking program id linked to the pool/LP token. */
  programId: number;
  /** Tinyman staking program account linked to the pool/LP token. */
  programAccount: string;
  /** Optional asset whose wallet balance Tinyman logs after committing. */
  requiredAssetId?: number;
  /** Pool (liquidity) token asset id the user commits. */
  liquidityAssetId: number;
  /** Current wallet balance of the LP token, used to sanity-check the commit. */
  userLpBalance: bigint;
  /** Pool address when the LP token was resolved from pool assets. */
  poolAddress?: string;
}

export interface TinymanFarmStateDependencies {
  resolvePoolState: (params: {
    network: ExecutionNetwork;
    algod: Algodv2;
    asset1Id: number;
    asset2Id: number;
  }) => Promise<TinymanV2PoolState>;
  getStakingAppId: (network: ExecutionNetwork) => number;
  getAccountAssetBalance: (algod: Algodv2, address: string, assetId: number) => Promise<bigint>;
  resolveFarmProgram: typeof resolveTinymanFarmProgram;
}

let dependencyOverrides: Partial<TinymanFarmStateDependencies> | undefined;

export function setTinymanFarmStateDependenciesForTests(
  overrides?: Partial<TinymanFarmStateDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): TinymanFarmStateDependencies {
  return {
    resolvePoolState: resolveTinymanV2PoolState,
    getStakingAppId: (network) => getStakingAppID(network),
    getAccountAssetBalance,
    resolveFarmProgram: resolveTinymanFarmProgram,
    ...dependencyOverrides
  };
}

/**
 * Resolve the LP token id (either directly or via the pool pair), the staking
 * app id, and the user's current LP-token balance for a farm commit.
 */
export async function resolveTinymanFarmState(params: {
  network: ExecutionNetwork;
  algod: Algodv2;
  userAddress: string;
  programId?: number;
  programAccount?: string;
  requiredAssetId?: number;
  liquidityAssetId?: number;
  assetAId?: number;
  assetBId?: number;
  poolAddress?: string;
}): Promise<TinymanFarmState> {
  const dependencies = resolveDependencies();
  const { network, algod, userAddress } = params;

  let liquidityAssetId = params.liquidityAssetId;
  let poolAddress = params.poolAddress;

  if (liquidityAssetId === undefined) {
    if (params.assetAId === undefined || params.assetBId === undefined) {
      throw new ShapeStateError(
        "Tinyman farm commit requires liquidityAssetId or the pool pair (assetAId and assetBId).",
        { details: { network } }
      );
    }
    const { asset1Id, asset2Id } = orderTinymanAssets(params.assetAId, params.assetBId);
    const poolState = await dependencies.resolvePoolState({
      network,
      algod,
      asset1Id,
      asset2Id
    });
    liquidityAssetId = poolState.poolTokenId;
    poolAddress = poolState.poolAddress;
  }

  const resolvedProgram =
    params.programId !== undefined && params.programAccount !== undefined
      ? {
          programId: params.programId,
          programAccount: params.programAccount,
          ...(params.requiredAssetId === undefined ? {} : { requiredAssetId: params.requiredAssetId })
        }
      : await dependencies.resolveFarmProgram({
          network,
          liquidityAssetId,
          ...(poolAddress === undefined ? {} : { poolAddress }),
          ...(params.assetAId === undefined ? {} : { assetAId: params.assetAId }),
          ...(params.assetBId === undefined ? {} : { assetBId: params.assetBId })
        });
  const program = {
    ...resolvedProgram,
    ...(params.requiredAssetId === undefined ? {} : { requiredAssetId: params.requiredAssetId })
  };

  const userLpBalance = await dependencies.getAccountAssetBalance(
    algod,
    userAddress,
    liquidityAssetId
  );

  return {
    network,
    stakingAppId: dependencies.getStakingAppId(network),
    ...program,
    liquidityAssetId,
    userLpBalance,
    ...(poolAddress === undefined ? {} : { poolAddress })
  };
}

export interface TinymanFarmProgram {
  programId: number;
  programAccount: string;
  requiredAssetId?: number;
}

interface TinymanStakingProgramApiRecord {
  id?: number | string | null;
  address?: string | null;
  required_asset_id?: number | string | null;
  is_verified?: boolean | null;
  commitment_start_datetime?: string | null;
  commitment_end_datetime?: string | null;
  end_datetime?: string | null;
  pools?: Array<{
    pool?: {
      address?: string | null;
      asset_1?: { id?: number | string | null };
      asset_2?: { id?: number | string | null };
      liquidity_asset?: { id?: number | string | null };
    } | null;
  }>;
}

interface TinymanStakingProgramsApiResponse {
  next?: string | null;
  results?: TinymanStakingProgramApiRecord[];
}

export async function resolveTinymanFarmProgram(params: {
  network: ExecutionNetwork;
  liquidityAssetId: number;
  poolAddress?: string;
  assetAId?: number;
  assetBId?: number;
  fetchImpl?: typeof fetch;
}): Promise<TinymanFarmProgram> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const records = await fetchTinymanStakingPrograms(params.network, fetchImpl);
  const matches = records.filter((record) => stakingProgramMatchesPool(record, params));
  const selected = selectPreferredStakingProgram(matches);
  if (selected === undefined) {
    throw new ShapeStateError("No Tinyman staking program found for the supplied pool/LP token.", {
      details: {
        liquidityAssetId: params.liquidityAssetId,
        poolAddress: params.poolAddress,
        assetAId: params.assetAId,
        assetBId: params.assetBId
      }
    });
  }

  const programId = parseOptionalInteger(selected.id);
  const programAccount = selected.address ?? undefined;
  if (programId === undefined || programAccount === undefined || programAccount.length === 0) {
    throw new ShapeStateError("Tinyman staking program payload is missing id or address.", {
      details: { id: selected.id, address: selected.address }
    });
  }

  const requiredAssetId = parseOptionalInteger(selected.required_asset_id);
  return {
    programId,
    programAccount,
    ...(requiredAssetId === undefined ? {} : { requiredAssetId })
  };
}

async function fetchTinymanStakingPrograms(
  network: ExecutionNetwork,
  fetchImpl: typeof fetch
): Promise<TinymanStakingProgramApiRecord[]> {
  const baseUrl =
    process.env.TINYMAN_API_BASE_URL ?? `https://${network}.analytics.tinyman.org/api/v1`;
  const output: TinymanStakingProgramApiRecord[] = [];
  let url: string | null = `${trimTrailingSlash(baseUrl)}/staking/programs/?limit=100`;

  while (url !== null) {
    const response = await fetchImpl(url);
    if (!response.ok) {
      throw new ShapeStateError(
        `Tinyman staking programs API returned non-2xx status: ${response.status}.`
      );
    }
    const payload = (await response.json()) as TinymanStakingProgramsApiResponse;
    output.push(...(payload.results ?? []));
    url = payload.next ?? null;
  }
  return output;
}

function stakingProgramMatchesPool(
  record: TinymanStakingProgramApiRecord,
  params: {
    liquidityAssetId: number;
    poolAddress?: string;
    assetAId?: number;
    assetBId?: number;
  }
): boolean {
  return (record.pools ?? []).some((entry) => {
    const pool = entry.pool;
    if (pool === null || pool === undefined) {
      return false;
    }
    const poolLiquidityAssetId = parseOptionalInteger(pool.liquidity_asset?.id);
    if (poolLiquidityAssetId === params.liquidityAssetId) {
      return true;
    }
    if (params.poolAddress !== undefined && pool.address === params.poolAddress) {
      return true;
    }
    if (params.assetAId !== undefined && params.assetBId !== undefined) {
      const poolAsset1Id = parseOptionalInteger(pool.asset_1?.id);
      const poolAsset2Id = parseOptionalInteger(pool.asset_2?.id);
      return (
        poolAsset1Id !== undefined &&
        poolAsset2Id !== undefined &&
        ((poolAsset1Id === params.assetAId && poolAsset2Id === params.assetBId) ||
          (poolAsset1Id === params.assetBId && poolAsset2Id === params.assetAId))
      );
    }
    return false;
  });
}

function selectPreferredStakingProgram(
  records: TinymanStakingProgramApiRecord[]
): TinymanStakingProgramApiRecord | undefined {
  const now = Date.now();
  return [...records].sort((a, b) => scoreProgram(b, now) - scoreProgram(a, now))[0];
}

function scoreProgram(record: TinymanStakingProgramApiRecord, now: number): number {
  let score = 0;
  if (record.is_verified === true) {
    score += 10;
  }
  if (isCommitmentOpen(record, now)) {
    score += 100;
  }
  if (!isEnded(record, now)) {
    score += 20;
  }
  return score;
}

function isCommitmentOpen(record: TinymanStakingProgramApiRecord, now: number): boolean {
  const start = parseDateMs(record.commitment_start_datetime);
  const end = parseDateMs(record.commitment_end_datetime);
  return (start === undefined || start <= now) && (end === undefined || now <= end);
}

function isEnded(record: TinymanStakingProgramApiRecord, now: number): boolean {
  const end = parseDateMs(record.end_datetime);
  return end !== undefined && end < now;
}

function parseDateMs(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined || value.length === 0) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptionalInteger(value: number | string | null | undefined): number | undefined {
  const numeric = typeof value === "string" ? Number(value) : value;
  return typeof numeric === "number" && Number.isInteger(numeric) && numeric >= 0
    ? numeric
    : undefined;
}

/** Read the wallet balance of an ASA (or ALGO for asset id 0). */
export async function getAccountAssetBalance(
  algod: Algodv2,
  address: string,
  assetId: number
): Promise<bigint> {
  const account = await algod.accountInformation(address).do();
  if (assetId === 0) {
    return BigInt(account.amount);
  }
  const holding = account.assets?.find((asset) => Number(asset.assetId) === assetId);
  return holding === undefined ? 0n : BigInt(holding.amount);
}

// -- Shared farm input parsing --------------------------------------------

export function parseFarmAddress(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidShapeInputError("userAddress must be a non-empty string.");
  }
  if (!/^[A-Z2-7]{58}$/.test(value)) {
    throw new InvalidShapeInputError("userAddress must be a valid Algorand address.");
  }
  return value;
}

export function parseProgramAccount(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidShapeInputError("programAccount must be a non-empty string.");
  }
  if (!/^[A-Z2-7]{58}$/.test(value)) {
    throw new InvalidShapeInputError("programAccount must be a valid Algorand address.");
  }
  return value;
}

export function parseOptionalProgramAccount(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return parseProgramAccount(value);
}

export function parseProgramId(value: unknown): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isInteger(numeric) || numeric <= 0) {
    throw new InvalidShapeInputError("programId must be a positive integer program id.", {
      programId: value
    });
  }
  return numeric;
}

export function parseOptionalProgramId(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return parseProgramId(value);
}

export function parseAssetId(value: unknown, field: string): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isInteger(numeric) || numeric < 0) {
    throw new InvalidShapeInputError(`${field} must be a non-negative integer asset id.`, {
      [field]: value
    });
  }
  return numeric;
}

export function parseOptionalAssetId(value: unknown, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return parseAssetId(value, field);
}

export function parseBaseUnitAmount(value: unknown, field: string): bigint {
  let result: bigint;
  if (typeof value === "bigint") {
    result = value;
  } else if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new InvalidShapeInputError(`${field} must be an integer amount in base units.`, {
        [field]: value
      });
    }
    result = BigInt(value);
  } else if (typeof value === "string" && /^\d+$/.test(value)) {
    result = BigInt(value);
  } else {
    throw new InvalidShapeInputError(
      `${field} must be a positive integer amount in base units.`,
      { [field]: value }
    );
  }
  if (result <= 0n) {
    throw new InvalidShapeInputError(`${field} must be greater than zero.`, {
      [field]: value
    });
  }
  return result;
}

export function parseOptionalBaseUnitAmount(value: unknown, field: string): bigint | undefined {
  if (value === undefined) {
    return undefined;
  }
  return parseBaseUnitAmount(value, field);
}

export function parseOptionalPoolId(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidShapeInputError("poolId must be a non-empty string when provided.");
  }
  return value;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
