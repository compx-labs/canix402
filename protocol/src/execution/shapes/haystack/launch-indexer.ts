import {
  ABI_RETURN_LOG_PREFIX,
  HAYSTACK_LAUNCH_APP_ID
} from "./launch-constants.js";
import { LAUNCH_METHOD_SELECTORS, readUint64 } from "./launch-spec.js";

export interface IndexedTokenLaunch {
  tokenNum: number;
  assetId: number | null;
  launchedAt: string;
}

interface IndexerApplicationTransaction {
  roundTime?: number;
  "round-time"?: number;
  applicationTransaction?: {
    applicationArgs?: Array<Uint8Array | string>;
  };
  "application-transaction"?: {
    "application-args"?: string[];
  };
  logs?: Array<Uint8Array | string>;
  innerTxns?: IndexerInnerTransaction[];
  "inner-txns"?: IndexerInnerTransaction[];
}

interface IndexerInnerTransaction {
  createdAssetIndex?: number | bigint;
  "created-asset-index"?: number | bigint;
  innerTxns?: IndexerInnerTransaction[];
  "inner-txns"?: IndexerInnerTransaction[];
}

/**
 * Pull HayLaunch creates out of an indexer application-transaction page.
 * `launchedAt` is the outer transaction's round time.
 */
export function parseIndexedLaunches(
  transactions: readonly IndexerApplicationTransaction[]
): IndexedTokenLaunch[] {
  const launches: IndexedTokenLaunch[] = [];
  for (const transaction of transactions) {
    const selector = firstArgSelector(transaction);
    if (selector === undefined || !LAUNCH_METHOD_SELECTORS.has(selector)) {
      continue;
    }
    const tokenNum = tokenNumFromLogs(transaction.logs ?? []);
    if (tokenNum === undefined) {
      continue;
    }
    const roundTime = transaction.roundTime ?? transaction["round-time"];
    if (roundTime === undefined) {
      continue;
    }
    launches.push({
      tokenNum,
      assetId: createdAssetId(transaction.innerTxns ?? transaction["inner-txns"] ?? []),
      launchedAt: new Date(roundTime * 1000).toISOString()
    });
  }
  return launches;
}

export function launchIndexerApplicationId(): number {
  return HAYSTACK_LAUNCH_APP_ID;
}

function firstArgSelector(transaction: IndexerApplicationTransaction): string | undefined {
  const sdkArgs = transaction.applicationTransaction?.applicationArgs;
  const httpArgs = transaction["application-transaction"]?.["application-args"];
  const first = sdkArgs?.[0] ?? httpArgs?.[0];
  if (first === undefined) {
    return undefined;
  }
  const bytes = typeof first === "string" ? Buffer.from(first, "base64") : Buffer.from(first);
  if (bytes.length < 4) {
    return undefined;
  }
  return bytes.subarray(0, 4).toString("hex");
}

function tokenNumFromLogs(logs: ReadonlyArray<Uint8Array | string>): number | undefined {
  for (const log of logs) {
    const bytes = typeof log === "string" ? Buffer.from(log, "base64") : Buffer.from(log);
    if (bytes.length !== 12) {
      continue;
    }
    if (bytes.subarray(0, 4).toString("hex") !== ABI_RETURN_LOG_PREFIX) {
      continue;
    }
    return Number(readUint64(bytes, 4));
  }
  return undefined;
}

function createdAssetId(inners: readonly IndexerInnerTransaction[]): number | null {
  for (const inner of inners) {
    const created = inner.createdAssetIndex ?? inner["created-asset-index"];
    if (created !== undefined && Number(created) > 0) {
      return Number(created);
    }
    const nested = createdAssetId(inner.innerTxns ?? inner["inner-txns"] ?? []);
    if (nested !== null) {
      return nested;
    }
  }
  return null;
}
