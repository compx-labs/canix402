import { createRequire } from "node:module";
import algosdk, { Algodv2 } from "algosdk";
import { PactClient } from "@pactfi/pactsdk";
import type { Pool, PoolState, PoolType } from "@pactfi/pactsdk";

import { ShapeStateError } from "../../errors.js";
import type { ExecutionNetwork } from "../../types.js";
import { parseAssetId } from "./parse-input.js";

/**
 * @pactfi/pactsdk is published as CJS and nests algosdk v2. Canix depends on
 * algosdk v3 (ESM). Mixing Address / SuggestedParams values across those copies
 * produces "address seems to be malformed" inside Pact's Transaction builders.
 */
const require = createRequire(import.meta.url);
const pactSdkRequire = createRequire(require.resolve("@pactfi/pactsdk"));
const pactBuilderAlgodSdk = pactSdkRequire("algosdk") as typeof import("algosdk");

const ALGORAND_ADDRESS_RE = /^[A-Z2-7]{58}$/;

/**
 * Execution-focused view of a Pact liquidity pool. Resolved from chain via the
 * Pact SDK rather than the discovery API.
 */
export interface PactPoolState {
  network: ExecutionNetwork;
  poolAppId: number;
  escrowAddress: string;
  primaryAssetId: number;
  secondaryAssetId: number;
  liquidityAssetId: number;
  poolType: PoolType;
  contractVersion: number;
  feeBps: number;
  reserves: PoolState;
  /** Raw SDK pool instance for quote/txn builders. */
  pool: Pool;
}

export interface PactPoolStateDependencies {
  createPactClient: (algod: Algodv2, network: ExecutionNetwork) => PactClient;
  fetchPoolById: (client: PactClient, poolAppId: number) => Promise<Pool>;
}

let dependencyOverrides: Partial<PactPoolStateDependencies> | undefined;

export function setPactPoolStateDependenciesForTests(
  overrides?: Partial<PactPoolStateDependencies>
): void {
  dependencyOverrides = overrides;
}

interface AlgodRequestLike<T = unknown> {
  do: () => Promise<T>;
}

type AlgodMethod = (...args: unknown[]) => AlgodRequestLike;

type RecordLike = Record<string, unknown>;

/**
 * Map caller asset ids to Pact primary (lower index) and secondary (higher
 * index) amounts.
 */
export function mapAssetsToPactAmounts(params: {
  assetAId: number;
  assetAAmount: bigint;
  assetBId: number;
  assetBAmount: bigint;
  primaryAssetId: number;
  secondaryAssetId: number;
}): { primaryAssetAmount: bigint; secondaryAssetAmount: bigint } {
  const { assetAId, assetAAmount, assetBId, assetBAmount, primaryAssetId, secondaryAssetId } =
    params;

  if (assetAId === primaryAssetId && assetBId === secondaryAssetId) {
    return { primaryAssetAmount: assetAAmount, secondaryAssetAmount: assetBAmount };
  }
  if (assetAId === secondaryAssetId && assetBId === primaryAssetId) {
    return { primaryAssetAmount: assetBAmount, secondaryAssetAmount: assetAAmount };
  }

  throw new ShapeStateError(
    "Requested assets do not match the resolved Pact pool primary/secondary pair.",
    {
      details: {
        assetAId,
        assetBId,
        primaryAssetId,
        secondaryAssetId
      }
    }
  );
}

export async function resolvePactPoolState(params: {
  network: ExecutionNetwork;
  algod: Algodv2;
  poolAppId: number;
  assetAId?: number;
  assetBId?: number;
}): Promise<PactPoolState> {
  const dependencies = resolveDependencies();
  const { network, algod, poolAppId } = params;

  const pactClient = dependencies.createPactClient(algod, network);

  let pool: Pool;
  try {
    pool = await dependencies.fetchPoolById(pactClient, poolAppId);
  } catch (error) {
    throw new ShapeStateError("Failed to fetch Pact pool by application id.", {
      details: { poolAppId, network },
      cause: error
    });
  }

  const primaryAssetId = pool.primaryAsset.index;
  const secondaryAssetId = pool.secondaryAsset.index;
  const liquidityAssetId = pool.liquidityAsset.index;

  if (params.assetAId !== undefined && params.assetBId !== undefined) {
    const expected = new Set([primaryAssetId, secondaryAssetId]);
    const requested = new Set([params.assetAId, params.assetBId]);
    if (expected.size !== requested.size || ![...expected].every((id) => requested.has(id))) {
      throw new ShapeStateError(
        "Requested asset pair does not match the resolved Pact pool assets.",
        {
          details: {
            poolAppId,
            assetAId: params.assetAId,
            assetBId: params.assetBId,
            primaryAssetId,
            secondaryAssetId
          }
        }
      );
    }
    if (params.assetAId === params.assetBId) {
      throw new ShapeStateError("Pact liquidity operations require two distinct assets.", {
        details: { assetAId: params.assetAId, assetBId: params.assetBId }
      });
    }
  }

  return {
    network,
    poolAppId: pool.appId,
    escrowAddress: addressToStringForPact(pool.getEscrowAddress(), "pool.escrowAddress"),
    primaryAssetId,
    secondaryAssetId,
    liquidityAssetId,
    poolType: pool.poolType,
    contractVersion: pool.version,
    feeBps: pool.feeBps,
    reserves: pool.state,
    pool
  };
}

export function parseOptionalAssetPair(raw: Record<string, unknown>): {
  assetAId?: number;
  assetBId?: number;
} {
  const result: { assetAId?: number; assetBId?: number } = {};
  if (raw.assetAId !== undefined) {
    result.assetAId = parseAssetId(raw.assetAId, "assetAId");
  }
  if (raw.assetBId !== undefined) {
    result.assetBId = parseAssetId(raw.assetBId, "assetBId");
  }
  return result;
}

function resolveDependencies(): PactPoolStateDependencies {
  return {
    createPactClient: defaultCreatePactClient,
    fetchPoolById: defaultFetchPoolById,
    ...dependencyOverrides
  };
}

function defaultCreatePactClient(_algod: Algodv2, network: ExecutionNetwork): PactClient {
  // Prefer Pact's nested algosdk client so Address values match builders.
  // Still wrap for camelCase / bytes → kebab-case / base64 when callers inject
  // a v3 algod (tests), and keep creator coercion for defense in depth.
  return new PactClient(
    createPactCompatibleAlgodClient(createPactBuilderAlgodClient()) as unknown as ConstructorParameters<
      typeof PactClient
    >[0],
    {
      network
    }
  );
}

async function defaultFetchPoolById(client: PactClient, poolAppId: number): Promise<Pool> {
  return client.fetchPoolById(poolAppId);
}

/**
 * Algod client constructed with the same CommonJS algosdk instance nested under
 * @pactfi/pactsdk. Use this for farm/pool builders and suggested-params fetches.
 */
export function createPactBuilderAlgodClient(): Algodv2 {
  const server = process.env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud";
  const token = process.env.X402_ALGOD_TOKEN ?? "";
  return new pactBuilderAlgodSdk.Algodv2(token, trimTrailingSlash(server), "") as unknown as Algodv2;
}

export function getPactBuilderAlgodSdk(): typeof import("algosdk") {
  return pactBuilderAlgodSdk;
}

/**
 * Coerce algosdk v3 Address (or any toString-able address) to a plain base32
 * string that Pact's nested algosdk v2 decodeAddress accepts.
 */
export function addressToStringForPact(value: unknown, label: string): string {
  if (typeof value === "string") {
    if (!ALGORAND_ADDRESS_RE.test(value)) {
      throw new ShapeStateError(`Pact ${label} address seems to be malformed.`, {
        details: { field: label, value }
      });
    }
    return value;
  }

  if (value !== null && typeof value === "object") {
    const asString =
      typeof (value as { toString?: unknown }).toString === "function"
        ? (value as { toString: () => string }).toString()
        : "";
    if (ALGORAND_ADDRESS_RE.test(asString)) {
      return asString;
    }
  }

  throw new ShapeStateError(`Pact ${label} address seems to be malformed.`, {
    details: {
      field: label,
      typeof: typeof value,
      value:
        value === null || value === undefined
          ? String(value)
          : Object.prototype.toString.call(value)
    }
  });
}

/**
 * Pact SDK 0.8.x parses Algod responses using algosdk v2 field names and
 * base64 strings. algosdk v3 returns camelCase fields, Uint8Array values, and
 * Address objects for creator / account fields.
 */
export function createPactCompatibleAlgodClient(algod: Algodv2): Algodv2 {
  return new Proxy(algod, {
    get(target, property, receiver) {
      if (property === "getApplicationByID") {
        return (...args: unknown[]) => {
          const request = (target.getApplicationByID as AlgodMethod).apply(target, args);
          return wrapAlgodRequest(request, normalizeApplicationResponseForPact);
        };
      }

      if (property === "getAssetByID") {
        return (...args: unknown[]) => {
          const request = (target.getAssetByID as AlgodMethod).apply(target, args);
          return wrapAlgodRequest(request, normalizeAssetResponseForPact);
        };
      }

      if (property === "accountInformation") {
        return (...args: unknown[]) => {
          const request = (target.accountInformation as AlgodMethod).apply(target, args);
          return wrapAlgodRequest(request, normalizeAccountResponseForPact);
        };
      }

      if (property === "getTransactionParams") {
        return (...args: unknown[]) => {
          const request = (target.getTransactionParams as AlgodMethod).apply(target, args);
          return wrapAlgodRequest(request, (value) =>
            normalizeSuggestedParamsForPact(value as algosdk.SuggestedParams)
          );
        };
      }

      return Reflect.get(target, property, receiver);
    }
  });
}

export function normalizeSuggestedParamsForPact(
  params: algosdk.SuggestedParams
): algosdk.SuggestedParams {
  const raw = params as algosdk.SuggestedParams & {
    firstRound?: unknown;
    lastRound?: unknown;
  };
  // algosdk v3 uses firstValid/lastValid; Pact's nested v2 uses firstRound/lastRound.
  const firstRound = toPactNumber(raw.firstValid ?? raw.firstRound, "firstValid");
  const lastRound = toPactNumber(raw.lastValid ?? raw.lastRound, "lastValid");
  const genesisHash = normalizeGenesisHashForPact(raw.genesisHash);
  return {
    ...params,
    fee: toPactNumber(params.fee, "fee"),
    minFee: toPactNumber(params.minFee, "minFee"),
    firstValid: firstRound,
    lastValid: lastRound,
    firstRound,
    lastRound,
    ...(genesisHash === undefined ? {} : { genesisHash })
  } as unknown as algosdk.SuggestedParams;
}

function wrapAlgodRequest<T>(
  request: AlgodRequestLike<T>,
  normalize: (value: T) => T
): AlgodRequestLike<T> {
  return {
    ...request,
    do: async () => normalize(await request.do())
  };
}

function normalizeApplicationResponseForPact<T>(response: T): T {
  if (!isRecordLike(response) || !isRecordLike(response.params)) {
    return response;
  }

  const params = response.params;
  const globalState = params["global-state"] ?? params.globalState;
  const creator = params.creator;

  return {
    ...response,
    params: {
      ...params,
      ...(creator === undefined
        ? {}
        : { creator: coerceAddressField(creator, "application.creator") }),
      ...(globalState === undefined
        ? {}
        : { "global-state": normalizeStateEntries(globalState) })
    }
  } as T;
}

function normalizeAssetResponseForPact<T>(response: T): T {
  if (!isRecordLike(response) || !isRecordLike(response.params)) {
    return response;
  }

  const params = response.params;
  return {
    ...response,
    params: {
      ...params,
      "unit-name": params["unit-name"] ?? params.unitName
    }
  } as T;
}

/**
 * Pact farming reads wallet local state with algosdk v2 field names
 * (`apps-local-state`, base64 keys). algosdk v3 returns camelCase + bytes.
 */
function normalizeAccountResponseForPact<T>(response: T): T {
  if (!isRecordLike(response)) {
    return response;
  }

  const appsLocalState = response["apps-local-state"] ?? response.appsLocalState;
  const assets = response.assets;
  const address = response.address;

  return {
    ...response,
    ...(address === undefined
      ? {}
      : { address: coerceAddressField(address, "account.address") }),
    "apps-local-state": normalizeAppsLocalState(appsLocalState),
    ...(assets === undefined
      ? {}
      : {
          assets: Array.isArray(assets)
            ? assets.map((holding) => {
                if (!isRecordLike(holding)) {
                  return holding;
                }
                return {
                  ...holding,
                  "asset-id": holding["asset-id"] ?? holding.assetId,
                  amount:
                    typeof holding.amount === "bigint"
                      ? Number(holding.amount)
                      : holding.amount
                };
              })
            : assets
        })
  } as T;
}

/**
 * Soft coerce used inside algod response wrappers — never throw mid-fetch so
 * unrelated fields can still be read; builders call addressToStringForPact.
 */
function coerceAddressField(value: unknown, _label: string): unknown {
  if (typeof value === "string") {
    return value;
  }
  if (value !== null && typeof value === "object") {
    const asString =
      typeof (value as { toString?: unknown }).toString === "function"
        ? (value as { toString: () => string }).toString()
        : "";
    if (ALGORAND_ADDRESS_RE.test(asString)) {
      return asString;
    }
  }
  return value;
}

function normalizeGenesisHashForPact(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("base64");
  }
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64");
  }
  return undefined;
}

function normalizeAppsLocalState(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  return value.map((entry) => {
    if (!isRecordLike(entry)) {
      return entry;
    }
    const keyValue = entry["key-value"] ?? entry.keyValue;
    return {
      ...entry,
      id: typeof entry.id === "bigint" ? Number(entry.id) : entry.id,
      "key-value": normalizeStateEntries(keyValue)
    };
  });
}

function normalizeStateEntries(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.map((entry) => {
    if (!isRecordLike(entry)) {
      return entry;
    }

    const rawValue = entry.value;
    const normalizedValue = isRecordLike(rawValue)
      ? {
          ...rawValue,
          bytes: encodeBytesForPact(rawValue.bytes),
          uint: normalizeUintForPact(rawValue.uint)
        }
      : rawValue;

    return {
      ...entry,
      key: encodeBytesForPact(entry.key),
      value: normalizedValue
    };
  });
}

function encodeBytesForPact(value: unknown): unknown {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("base64");
  }
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64");
  }
  if (value instanceof ArrayBuffer) {
    return Buffer.from(value).toString("base64");
  }
  return value;
}

function normalizeUintForPact(value: unknown): unknown {
  return typeof value === "bigint" ? Number(value) : value;
}

function toPactNumber(value: unknown, label: string): number {
  const numeric = typeof value === "bigint" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isSafeInteger(numeric) || numeric < 0) {
    throw new ShapeStateError(`Suggested params ${label} is not a Pact-compatible number.`, {
      details: { [label]: String(value) }
    });
  }
  return numeric;
}

function isRecordLike(value: unknown): value is RecordLike {
  return typeof value === "object" && value !== null;
}

export function createExecutionAlgodClient(): Algodv2 {
  const server = process.env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud";
  const token = process.env.X402_ALGOD_TOKEN ?? "";
  return new algosdk.Algodv2(token, trimTrailingSlash(server), "");
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
