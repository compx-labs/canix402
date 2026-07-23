import algosdk, { Algodv2 } from "algosdk";

export class AccountAssetsError extends Error {
  public readonly cause?: unknown;

  public constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "AccountAssetsError";
    this.cause = cause;
  }
}

interface AccountAssetHolding {
  assetId: number | bigint;
  amount: number | bigint;
}

interface AccountInformation {
  amount: number | bigint;
  assets?: AccountAssetHolding[];
}

export interface AccountHoldings {
  heldAssetIds: Set<number>;
  /** Base-unit balances keyed by asset id (0 = ALGO). */
  balances: Map<number, bigint>;
}

interface AccountAssetsDependencies {
  createAlgodClient: () => Algodv2;
  fetchAccountInformation: (
    client: Algodv2,
    address: string
  ) => Promise<AccountInformation>;
}

let accountAssetsDependencyOverrides: Partial<AccountAssetsDependencies> | undefined;

export function setAccountAssetsDependenciesForTests(
  overrides?: Partial<AccountAssetsDependencies>
): void {
  accountAssetsDependencyOverrides = overrides;
}

export async function fetchHeldAssetIds(address: string): Promise<Set<number>> {
  const holdings = await fetchAccountHoldings(address);
  return holdings.heldAssetIds;
}

export async function fetchAccountHoldings(address: string): Promise<AccountHoldings> {
  const dependencies = resolveDependencies();

  try {
    const client = dependencies.createAlgodClient();
    const accountInfo = await dependencies.fetchAccountInformation(client, address);

    const heldAssetIds = new Set<number>();
    const balances = new Map<number, bigint>();

    const algoBalance = toBigInt(accountInfo.amount);
    balances.set(0, algoBalance);
    if (algoBalance > 0n) {
      heldAssetIds.add(0);
    }

    for (const holding of accountInfo.assets ?? []) {
      const assetId = Number(holding.assetId);
      const amount = toBigInt(holding.amount);
      balances.set(assetId, amount);
      if (amount > 0n) {
        heldAssetIds.add(assetId);
      }
    }

    return { heldAssetIds, balances };
  } catch (error) {
    if (error instanceof AccountAssetsError) {
      throw error;
    }

    throw new AccountAssetsError(
      "Failed to read account holdings from algod.",
      error
    );
  }
}

function resolveDependencies(): AccountAssetsDependencies {
  return {
    createAlgodClient: createAlgodClient,
    fetchAccountInformation: defaultFetchAccountInformation,
    ...accountAssetsDependencyOverrides
  };
}

function createAlgodClient(): Algodv2 {
  const server = process.env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud";
  const token = process.env.X402_ALGOD_TOKEN ?? "";
  return new algosdk.Algodv2(token, trimTrailingSlash(server), "");
}

async function defaultFetchAccountInformation(
  client: Algodv2,
  address: string
): Promise<AccountInformation> {
  return (await client.accountInformation(address).do()) as AccountInformation;
}

function toBigInt(value: number | bigint): bigint {
  return typeof value === "bigint" ? value : BigInt(Math.trunc(value));
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
