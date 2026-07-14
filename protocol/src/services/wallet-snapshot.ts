import algosdk, { type Indexer } from "algosdk";

export interface WalletAssetHolding {
  assetId: number;
  amount: bigint;
}

export interface WalletAppLocalState {
  id: number;
  keyValue?: unknown;
}

export interface WalletSnapshot {
  address: string;
  amount: bigint;
  assets: WalletAssetHolding[];
  appsLocalState: WalletAppLocalState[];
  /**
   * Compatibility view consumed by protocol SDKs that still expect the
   * algod v2 JSON field names.
   */
  accountInfo: Record<string, unknown>;
}

export class WalletSnapshotError extends Error {
  public readonly cause?: unknown;

  public constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "WalletSnapshotError";
    this.cause = cause;
  }
}

export async function fetchWalletSnapshot(
  address: string,
  indexer: Indexer = createIndexerClient()
): Promise<WalletSnapshot> {
  try {
    const response = await indexer
      .lookupAccountByID(address)
      .includeAll(false)
      .do();
    const account = response.account;
    const assets = (account.assets ?? []).map((holding) => ({
      assetId: Number(holding.assetId),
      amount: BigInt(holding.amount)
    }));
    const appsLocalState = (account.appsLocalState ?? []).map((state) => ({
      id: Number(state.id),
      ...(state.keyValue === undefined ? {} : { keyValue: state.keyValue })
    }));

    return {
      address,
      amount: BigInt(account.amount),
      assets,
      appsLocalState,
      accountInfo: {
        ...account,
        assets: assets.map((holding) => ({
          "asset-id": holding.assetId,
          assetId: holding.assetId,
          amount: holding.amount
        })),
        "apps-local-state": appsLocalState.map((state) => ({
          id: state.id,
          ...(state.keyValue === undefined
            ? {}
            : {
                "key-value": toLegacyTealKeyValue(state.keyValue),
                keyValue: state.keyValue
              })
        }))
      }
    };
  } catch (error) {
    throw new WalletSnapshotError(
      "Failed to read wallet holdings from the indexer.",
      error
    );
  }
}

export function emptyWalletSnapshot(address: string): WalletSnapshot {
  return {
    address,
    amount: 0n,
    assets: [],
    appsLocalState: [],
    accountInfo: {
      address,
      amount: 0n,
      assets: [],
      "apps-local-state": []
    }
  };
}

export function getWalletAssetBalance(
  snapshot: WalletSnapshot,
  assetId: number
): bigint {
  if (assetId === 0) {
    return snapshot.amount;
  }
  return (
    snapshot.assets.find((holding) => holding.assetId === assetId)?.amount ?? 0n
  );
}

export function getHeldWalletAssetIds(snapshot: WalletSnapshot): number[] {
  return snapshot.assets
    .filter((holding) => holding.amount > 0n)
    .map((holding) => holding.assetId);
}

export function getWalletLocalAppIds(snapshot: WalletSnapshot): Set<number> {
  return new Set(snapshot.appsLocalState.map((state) => state.id));
}

function createIndexerClient(): Indexer {
  return new algosdk.Indexer(
    process.env.X402_INDEXER_TOKEN ?? "",
    trimTrailingSlash(
      process.env.X402_INDEXER_URL ?? "https://mainnet-idx.algonode.cloud"
    ),
    ""
  );
}

function toLegacyTealKeyValue(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      return entry;
    }
    const record = entry as {
      key?: unknown;
      value?: {
        bytes?: unknown;
        type?: unknown;
        uint?: unknown;
      };
    };
    const key =
      record.key instanceof Uint8Array
        ? Buffer.from(record.key).toString("base64")
        : record.key;
    const bytes =
      record.value?.bytes instanceof Uint8Array
        ? Buffer.from(record.value.bytes).toString("base64")
        : record.value?.bytes;
    const uint =
      typeof record.value?.uint === "bigint"
        ? Number(record.value.uint)
        : record.value?.uint;
    return {
      key,
      value: {
        bytes,
        type: record.value?.type,
        uint
      }
    };
  });
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
