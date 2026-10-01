import algosdk, { Algodv2 } from "algosdk";

import { InvalidShapeInputError, ShapeStateError } from "../../errors.js";
import { ALGO_ASSET_ID } from "./parse-input.js";

/** Observed ARC-4 selector for managed-weighted add liquidity (`ZEkhvw==`). */
export const PACT_V201_ADD_LIQUIDITY_SELECTOR = Uint8Array.from(
  Buffer.from("ZEkhvw==", "base64")
);

/** Observed ARC-4 selector for managed-weighted remove liquidity (`U6NrJA==`). */
export const PACT_V201_REMOVE_LIQUIDITY_SELECTOR = Uint8Array.from(
  Buffer.from("U6NrJA==", "base64")
);

/** Outer app-call fee covering the pool call plus two vault inners. */
export const PACT_V201_APP_CALL_FEE = 3000n;

const BPS_DENOMINATOR = 10_000n;

export interface PactManagedWeightedPoolState {
  poolAppId: number;
  poolAddress: string;
  vaultAppId: number;
  vaultAddress: string;
  assetAId: number;
  assetBId: number;
  reserveA: bigint;
  reserveB: bigint;
  issuedLp: bigint;
  lpAssetId: number;
  weightA: bigint;
  swapFeeBps: bigint;
  /** Set by the add-liquidity shape after an opt-in check. */
  userOptedIntoLp?: boolean;
}

export interface PactManagedWeightedStateDependencies {
  getApplication: (algod: Algodv2, appId: number) => Promise<{
    params?: { globalState?: ReadonlyArray<GlobalStateEntry> };
  }>;
  getApplicationAddress: (appId: number) => string;
}

interface GlobalStateEntry {
  key: Uint8Array | string;
  value: { uint?: bigint | number; bytes?: Uint8Array | string };
}

let dependencyOverrides: Partial<PactManagedWeightedStateDependencies> | undefined;

export function setPactManagedWeightedStateDependenciesForTests(
  overrides?: Partial<PactManagedWeightedStateDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): PactManagedWeightedStateDependencies {
  return {
    getApplication: async (algod, appId) => algod.getApplicationByID(appId).do(),
    getApplicationAddress: (appId) => algosdk.getApplicationAddress(appId).toString(),
    ...dependencyOverrides
  };
}

export async function resolvePactManagedWeightedPoolState(params: {
  algod: Algodv2;
  poolAppId: number;
}): Promise<PactManagedWeightedPoolState> {
  const dependencies = resolveDependencies();
  let application: { params?: { globalState?: ReadonlyArray<GlobalStateEntry> } };
  try {
    application = await dependencies.getApplication(params.algod, params.poolAppId);
  } catch (error) {
    throw new ShapeStateError("Failed to fetch Pact managed-weighted pool application.", {
      details: { poolAppId: params.poolAppId },
      cause: error
    });
  }

  const values = readGlobalUintMap(application.params?.globalState ?? []);
  const assetAId = readRequiredUint(values, "asset_a", params.poolAppId);
  const assetBId = readRequiredUint(values, "asset_b", params.poolAppId);
  const reserveA = readRequiredBigint(values, "reserve_a", params.poolAppId);
  const reserveB = readRequiredBigint(values, "reserve_b", params.poolAppId);
  const issuedLp = readRequiredBigint(values, "issued_lp", params.poolAppId);
  const lpAssetId = readRequiredUint(values, "lp_asset", params.poolAppId);
  const vaultAppId = readRequiredUint(values, "vault", params.poolAppId);
  const weightA = readRequiredBigint(values, "weight_a", params.poolAppId);
  const swapFeeBps = readRequiredBigint(values, "swap_fee_bps", params.poolAppId);
  const bootstrapped = readRequiredBigint(values, "bootstrapped", params.poolAppId);

  if (bootstrapped !== 1n) {
    throw new ShapeStateError("Pact managed-weighted pool is not bootstrapped.", {
      details: { poolAppId: params.poolAppId, bootstrapped: bootstrapped.toString() }
    });
  }
  if (reserveA <= 0n || reserveB <= 0n || issuedLp <= 0n) {
    throw new ShapeStateError("Pact managed-weighted pool has no reserves to join or exit.", {
      details: {
        poolAppId: params.poolAppId,
        reserveA: reserveA.toString(),
        reserveB: reserveB.toString(),
        issuedLp: issuedLp.toString()
      }
    });
  }
  if (vaultAppId < 1 || lpAssetId < 1) {
    throw new ShapeStateError("Pact managed-weighted pool is missing a vault or LP asset.", {
      details: { poolAppId: params.poolAppId, vaultAppId, lpAssetId }
    });
  }

  return {
    poolAppId: params.poolAppId,
    poolAddress: dependencies.getApplicationAddress(params.poolAppId),
    vaultAppId,
    vaultAddress: dependencies.getApplicationAddress(vaultAppId),
    assetAId,
    assetBId,
    reserveA,
    reserveB,
    issuedLp,
    lpAssetId,
    weightA,
    swapFeeBps
  };
}

export function mapCallerAmountsToPoolAssets(params: {
  state: PactManagedWeightedPoolState;
  assetAId: number;
  assetAAmount: bigint;
  assetBId: number;
  assetBAmount: bigint;
}): { amountA: bigint; amountB: bigint } {
  const { state, assetAId, assetAAmount, assetBId, assetBAmount } = params;
  if (
    assetAId === assetBId ||
    !pairMatches(state, assetAId, assetBId)
  ) {
    throw new ShapeStateError("Requested asset pair does not match the Pact pool.", {
      details: {
        poolAppId: state.poolAppId,
        assetAId,
        assetBId,
        poolAssetAId: state.assetAId,
        poolAssetBId: state.assetBId
      }
    });
  }
  if (assetAId === state.assetAId) {
    return { amountA: assetAAmount, amountB: assetBAmount };
  }
  return { amountA: assetBAmount, amountB: assetAAmount };
}

/**
 * Reject deposits whose asset_b/asset_a ratio diverges from reserves by more
 * than `maxSlippageBps`. The add-liquidity app call has no minimum-LP argument.
 */
export function assertDepositMatchesReserves(params: {
  amountA: bigint;
  amountB: bigint;
  reserveA: bigint;
  reserveB: bigint;
  maxSlippageBps: number;
}): void {
  const { amountA, amountB, reserveA, reserveB, maxSlippageBps } = params;
  const diff = abs(amountB * reserveA - reserveB * amountA);
  const limit = BigInt(maxSlippageBps) * reserveB * amountA;
  if (diff * BPS_DENOMINATOR > limit) {
    throw new InvalidShapeInputError(
      "Deposit ratio is outside maxSlippageBps of the Pact pool reserves.",
      {
        amountA: amountA.toString(),
        amountB: amountB.toString(),
        reserveA: reserveA.toString(),
        reserveB: reserveB.toString(),
        maxSlippageBps
      }
    );
  }
}

export function expectedProportionalMint(params: {
  amountA: bigint;
  amountB: bigint;
  reserveA: bigint;
  reserveB: bigint;
  issuedLp: bigint;
}): bigint {
  const mintA = (params.issuedLp * params.amountA) / params.reserveA;
  const mintB = (params.issuedLp * params.amountB) / params.reserveB;
  return mintA < mintB ? mintA : mintB;
}

export function proportionalMinimumOuts(params: {
  liquidityAmount: bigint;
  reserveA: bigint;
  reserveB: bigint;
  issuedLp: bigint;
  maxSlippageBps: number;
}): { minA: bigint; minB: bigint } {
  const kept = BPS_DENOMINATOR - BigInt(params.maxSlippageBps);
  const grossA = (params.reserveA * params.liquidityAmount) / params.issuedLp;
  const grossB = (params.reserveB * params.liquidityAmount) / params.issuedLp;
  return {
    minA: (grossA * kept) / BPS_DENOMINATOR,
    minB: (grossB * kept) / BPS_DENOMINATOR
  };
}

export function assetIdBoxName(assetId: number): Uint8Array {
  return algosdk.encodeUint64(BigInt(assetId));
}

export function nonAlgoForeignAssets(state: PactManagedWeightedPoolState): bigint[] {
  const assets = [state.assetAId, state.assetBId].filter((assetId) => assetId !== ALGO_ASSET_ID);
  return assets.map((assetId) => BigInt(assetId));
}

function pairMatches(
  state: PactManagedWeightedPoolState,
  assetAId: number,
  assetBId: number
): boolean {
  const pool = new Set([state.assetAId, state.assetBId]);
  return pool.has(assetAId) && pool.has(assetBId);
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function readGlobalUintMap(
  entries: ReadonlyArray<GlobalStateEntry>
): Map<string, bigint> {
  const values = new Map<string, bigint>();
  for (const entry of entries) {
    const key = decodeStateKey(entry.key);
    if (entry.value.uint === undefined) {
      continue;
    }
    values.set(key, BigInt(entry.value.uint));
  }
  return values;
}

function decodeStateKey(key: Uint8Array | string): string {
  if (typeof key === "string") {
    return Buffer.from(key, "base64").toString("utf8");
  }
  return Buffer.from(key).toString("utf8");
}

function readRequiredBigint(
  values: Map<string, bigint>,
  key: string,
  poolAppId: number
): bigint {
  const value = values.get(key);
  if (value === undefined) {
    throw new ShapeStateError("Pact application is not a managed-weighted pool.", {
      details: { poolAppId, missingKey: key }
    });
  }
  return value;
}

function readRequiredUint(
  values: Map<string, bigint>,
  key: string,
  poolAppId: number
): number {
  const value = readRequiredBigint(values, key, poolAppId);
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ShapeStateError("Pact pool global state value is out of range.", {
      details: { poolAppId, key, value: value.toString() }
    });
  }
  return Number(value);
}
