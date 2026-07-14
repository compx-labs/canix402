import algosdk, { Algodv2 } from "algosdk";

import { mapWithThrottle, retryRateLimited } from "./request-throttle.js";

export const ALGO_ASSET_ID = 0;
export const ALGO_DECIMALS = 6;

const MAX_ASA_DECIMALS = 19;

interface AssetInformationResponse {
  params?: {
    decimals?: number | bigint;
  };
}

interface AssetDecimalsDependencies {
  createAlgodClient: () => Algodv2;
  getAssetById: (
    client: Algodv2,
    assetId: number
  ) => Promise<AssetInformationResponse>;
  logWarning: (message: string) => void;
}

let assetDecimalsDependencyOverrides: Partial<AssetDecimalsDependencies> | undefined;

// Asset decimals are immutable once an ASA is created, so a process-lifetime
// cache is safe and removes redundant algod lookups across requests/adapters.
const decimalsCache = new Map<number, number>();

export function setAssetDecimalsDependenciesForTests(
  overrides?: Partial<AssetDecimalsDependencies>
): void {
  assetDecimalsDependencyOverrides = overrides;
  decimalsCache.clear();
}

export async function resolveAssetDecimals(
  assetIds: readonly number[],
  algodClient?: Algodv2
): Promise<Map<number, number>> {
  const dependencies = resolveDependencies();
  const decimalsByAssetId = new Map<number, number>();
  const pending: number[] = [];

  for (const assetId of new Set(assetIds)) {
    if (assetId === ALGO_ASSET_ID) {
      decimalsByAssetId.set(assetId, ALGO_DECIMALS);
      continue;
    }

    if (!isValidAssetId(assetId)) {
      continue;
    }

    const cached = decimalsCache.get(assetId);
    if (cached !== undefined) {
      decimalsByAssetId.set(assetId, cached);
      continue;
    }

    pending.push(assetId);
  }

  if (pending.length === 0) {
    return decimalsByAssetId;
  }

  const client = algodClient ?? dependencies.createAlgodClient();

  await mapWithThrottle(
    pending,
    {
      concurrency: readNonNegativeInteger(
        process.env.ALGOD_LOOKUP_CONCURRENCY,
        1
      ),
      delayMs: readNonNegativeInteger(process.env.ALGOD_LOOKUP_DELAY_MS, 150)
    },
    async (assetId) => {
      const decimals = await lookupAssetDecimals(dependencies, client, assetId);
      if (decimals !== undefined) {
        decimalsCache.set(assetId, decimals);
        decimalsByAssetId.set(assetId, decimals);
      }
    }
  );

  return decimalsByAssetId;
}

function resolveDependencies(): AssetDecimalsDependencies {
  return {
    createAlgodClient: createAlgodClient,
    getAssetById: defaultGetAssetById,
    logWarning: defaultLogWarning,
    ...assetDecimalsDependencyOverrides
  };
}

function createAlgodClient(): Algodv2 {
  const server = process.env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud";
  const token = process.env.X402_ALGOD_TOKEN ?? "";
  return new algosdk.Algodv2(token, trimTrailingSlash(server), "");
}

async function defaultGetAssetById(
  client: Algodv2,
  assetId: number
): Promise<AssetInformationResponse> {
  return (await client.getAssetByID(assetId).do()) as AssetInformationResponse;
}

function defaultLogWarning(message: string): void {
  console.warn(message);
}

async function lookupAssetDecimals(
  dependencies: AssetDecimalsDependencies,
  client: Algodv2,
  assetId: number
): Promise<number | undefined> {
  try {
    const info = await retryRateLimited(
      () => dependencies.getAssetById(client, assetId),
      {
        maxRetries: readNonNegativeInteger(
          process.env.ALGOD_429_MAX_RETRIES,
          2
        ),
        baseDelayMs: readNonNegativeInteger(
          process.env.ALGOD_429_RETRY_BASE_MS,
          250
        ),
        getStatus: extractHttpStatus
      }
    );
    const decimals = normalizeDecimals(info.params?.decimals);
    if (decimals === undefined) {
      dependencies.logWarning(
        `asset-decimals: asset ${assetId} returned no usable decimals; dependent opportunities will be dropped.`
      );
    }
    return decimals;
  } catch (error) {
    // A 404 is an expected "asset does not exist" outcome; anything else
    // (network error, rate limit, 5xx) is transient and worth surfacing
    // because it silently drops otherwise-valid opportunities.
    const status = extractHttpStatus(error);
    if (status !== 404) {
      dependencies.logWarning(
        `asset-decimals: failed to resolve decimals for asset ${assetId} (status=${
          status ?? "unknown"
        }); dependent opportunities will be dropped this request.`
      );
    }
    return undefined;
  }
}

function normalizeDecimals(value: unknown): number | undefined {
  let numeric: number;
  if (typeof value === "number") {
    numeric = value;
  } else if (typeof value === "bigint") {
    numeric = Number(value);
  } else {
    return undefined;
  }

  if (Number.isInteger(numeric) && numeric >= 0 && numeric <= MAX_ASA_DECIMALS) {
    return numeric;
  }

  return undefined;
}

function isValidAssetId(assetId: number): boolean {
  return Number.isInteger(assetId) && assetId > 0;
}

function extractHttpStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") {
      return status;
    }
  }
  return undefined;
}

function readNonNegativeInteger(
  value: string | undefined,
  fallback: number
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
