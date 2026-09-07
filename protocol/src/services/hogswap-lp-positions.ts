import type { Protocol } from "../routes/schemas.js";
import type { PositionMarketRecord } from "./position-execution-shapes.js";
import {
  fetchHogswapLpCatalog,
  fetchHogswapLpValuation,
  HogswapClientError,
  mapHogswapDexToProtocol,
  mapHogswapRequests,
  type HogswapLpCatalogEntry,
  type HogswapLpProtocol,
  type HogswapLpValuation
} from "./hogswap-client.js";
import type {
  PositionCollectionContext,
  ProtocolPositionsCollection
} from "./protocol-positions.js";
import {
  getHeldWalletAssetIds,
  getWalletAssetBalance,
  type WalletSnapshot
} from "./wallet-snapshot.js";

const HOGSWAP_NAV_CAVEAT =
  "HOGSWAP LP valuation is a proportional-share NAV at analytics prices — no slippage, no exit fee; not a market quote. Null supply or price stays null.";

export async function collectStammPositions(
  address: string,
  snapshot: WalletSnapshot,
  context?: PositionCollectionContext
): Promise<ProtocolPositionsCollection> {
  return collectHogswapLpPositions(address, snapshot, "stamm", context);
}

export async function collectAlgofiPositions(
  address: string,
  snapshot: WalletSnapshot,
  context?: PositionCollectionContext
): Promise<ProtocolPositionsCollection> {
  return collectHogswapLpPositions(address, snapshot, "algofi", context);
}

export async function collectHumblePositions(
  address: string,
  snapshot: WalletSnapshot,
  context?: PositionCollectionContext
): Promise<ProtocolPositionsCollection> {
  return collectHogswapLpPositions(address, snapshot, "humble", context);
}

export async function collectHogswapLpPositions(
  _address: string,
  snapshot: WalletSnapshot,
  protocol: HogswapLpProtocol,
  _context?: PositionCollectionContext
): Promise<ProtocolPositionsCollection> {
  const heldAssetIds = getHeldWalletAssetIds(snapshot);
  if (heldAssetIds.length === 0) {
    return emptyCompleteCollection();
  }

  let catalog: Map<number, HogswapLpCatalogEntry>;
  try {
    catalog = await fetchHogswapLpCatalog();
  } catch (error) {
    return {
      positions: [],
      warnings: [
        `HOGSWAP LP catalog unavailable: ${errorMessage(error)}`
      ],
      coverage: {
        suppliedUsdComplete: false,
        borrowedUsdComplete: true,
        rewardsUsdComplete: true
      }
    };
  }

  const matches: Array<{
    lpAssetId: number;
    amount: bigint;
    entry: HogswapLpCatalogEntry;
  }> = [];
  for (const lpAssetId of heldAssetIds) {
    const entry = catalog.get(lpAssetId);
    if (entry === undefined || entry.dedicatedCollector) {
      continue;
    }
    const entryProtocol =
      entry.protocol ??
      (entry.dexName ? mapHogswapDexToProtocol(entry.dexName) : null);
    if (entryProtocol !== protocol) {
      continue;
    }
    const amount = getWalletAssetBalance(snapshot, lpAssetId);
    if (amount <= 0n) {
      continue;
    }
    matches.push({ lpAssetId, amount, entry });
  }

  if (matches.length === 0) {
    return emptyCompleteCollection();
  }

  const positions: PositionMarketRecord[] = [];
  const warnings: string[] = [];
  const settled: Array<
    | { status: "fulfilled"; value: HogswapLpValuation }
    | { status: "rejected"; reason: unknown }
    | undefined
  > = new Array(matches.length);

  await mapHogswapRequests(
    matches.map((match, index) => ({ match, index })),
    async ({ match, index }) => {
      try {
        const valuation = await fetchHogswapLpValuation(
          match.lpAssetId,
          match.amount
        );
        settled[index] = { status: "fulfilled", value: valuation };
      } catch (reason) {
        settled[index] = { status: "rejected", reason };
      }
    }
  );

  for (const [index, result] of settled.entries()) {
    const match = matches[index]!;
    if (result === undefined) {
      warnings.push(`HOGSWAP /lp/${match.lpAssetId} returned no result.`);
      continue;
    }
    if (result.status === "rejected") {
      if (
        result.reason instanceof HogswapClientError &&
        result.reason.status === 404
      ) {
        warnings.push(
          `HOGSWAP has no LP valuation for ASA ${match.lpAssetId}.`
        );
        continue;
      }
      warnings.push(
        `HOGSWAP /lp/${match.lpAssetId} unavailable: ${errorMessage(result.reason)}`
      );
      continue;
    }
    const record = normalizeHogswapLpPosition(
      protocol,
      match.amount,
      match.entry,
      result.value
    );
    if (record === null) {
      continue;
    }
    positions.push(record);
  }

  const hasUnpricedLp = positions.some((position) => position.usdValue === null);
  if (hasUnpricedLp) {
    warnings.push(
      "HOGSWAP LP USD is null where supply or a reserve price was unavailable."
    );
  }

  return {
    positions,
    warnings,
    coverage: {
      suppliedUsdComplete: warnings.length === 0 && !hasUnpricedLp,
      borrowedUsdComplete: true,
      rewardsUsdComplete: true
    }
  };
}

/**
 * Normalize a HOGSWAP `/lp/{id}?amount=` payload into an `lp` position row.
 * Null supply/price stay null — never invent USD.
 */
export function normalizeHogswapLpPosition(
  protocol: Protocol,
  heldAmount: bigint,
  catalog: Pick<
    HogswapLpCatalogEntry,
    "lpAssetId" | "poolId" | "dexName" | "tierIndex" | "assetA" | "assetB" | "lpDecimals"
  >,
  valuation: HogswapLpValuation
): PositionMarketRecord | null {
  if (heldAmount <= 0n) {
    return null;
  }
  const lpAssetId = valuation.assetId || catalog.lpAssetId;
  const decimals = valuation.lpDecimals ?? catalog.lpDecimals ?? 6;
  const assetA = valuation.assetA ?? catalog.assetA;
  const assetB = valuation.assetB ?? catalog.assetB;
  const tierIndex = valuation.tierIndex ?? catalog.tierIndex;
  const poolId = valuation.poolId ?? catalog.poolId;
  const dexName = valuation.dexName ?? catalog.dexName;
  const pair = formatAssetPair(assetA, assetB);
  const usdValue = microUsdToUsd(valuation.valueUsdMicro);
  const assetIds =
    assetA !== null && assetB !== null ? [assetA, assetB] : undefined;
  const notes = [
    `DEX=${dexName}.`,
    `Pair ${pair}.`,
    redeemableNote(assetA, assetB, valuation),
    HOGSWAP_NAV_CAVEAT
  ].join(" ");

  return {
    protocol,
    positionType: "lp",
    positionId: `${protocol}:lp:${lpAssetId}`,
    opportunityId:
      tierIndex !== null ? `${poolId}:lp:${tierIndex}` : `${poolId}:lp`,
    assetId: lpAssetId,
    assetSymbol: `${pair} LP`,
    amountRaw: heldAmount.toString(),
    amount: formatUnits(heldAmount, decimals),
    usdValue,
    ...(assetIds !== undefined ? { assetIds } : {}),
    notes,
    caveats: [HOGSWAP_NAV_CAVEAT],
    inputHints: {
      liquidityAssetId: lpAssetId,
      ...(poolId > 0 ? { poolAppId: poolId, poolId: String(poolId) } : {}),
      ...(assetA !== null ? { assetAId: assetA } : {}),
      ...(assetB !== null ? { assetBId: assetB } : {}),
      ...(tierIndex !== null ? { tierIndex } : {})
    }
  };
}

function redeemableNote(
  assetA: number | null,
  assetB: number | null,
  valuation: HogswapLpValuation
): string {
  const a = valuation.redeemableAssetAMicro;
  const b = valuation.redeemableAssetBMicro;
  if (a === null || b === null || assetA === null || assetB === null) {
    return "Redeemable underlyings unavailable (null supply or price).";
  }
  return (
    `Redeemable (proportional): ${a.toString()} base units of asset ${assetA}` +
    ` and ${b.toString()} base units of asset ${assetB}.`
  );
}

function formatAssetPair(assetA: number | null, assetB: number | null): string {
  return `${assetLabel(assetA)}/${assetLabel(assetB)}`;
}

function assetLabel(assetId: number | null): string {
  if (assetId === null) {
    return "unknown";
  }
  return assetId === 0 ? "ALGO" : `ASSET-${assetId}`;
}

function microUsdToUsd(micro: number | null): number | null {
  if (micro === null) {
    return null;
  }
  const value = micro / 1_000_000;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function formatUnits(value: bigint, decimals: number): string {
  if (decimals <= 0) {
    return value.toString();
  }
  const raw = value.toString().padStart(decimals + 1, "0");
  const whole = raw.slice(0, -decimals);
  const fraction = raw.slice(-decimals).replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

function emptyCompleteCollection(): ProtocolPositionsCollection {
  return {
    positions: [],
    warnings: [],
    coverage: {
      suppliedUsdComplete: true,
      borrowedUsdComplete: true,
      rewardsUsdComplete: true
    }
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
