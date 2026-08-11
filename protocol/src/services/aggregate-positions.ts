import type { Protocol } from "../routes/schemas.js";
import type {
  ProtocolPositionResult,
  WalletPositionTotals,
  WalletPositionsResponse
} from "../types/position.js";
import {
  collectAlphaArcadePositions,
  collectCompXPositions,
  collectDorkFiPositions,
  collectFolksFinancePositions,
  collectHaystackPositions,
  collectMythFinancePositions,
  collectPactPositions,
  collectRetiPositions,
  collectTinymanPositions,
  type PositionCollectionContext,
  type ProtocolPositionsCollection,
  type PositionCollector
} from "./protocol-positions.js";
import { attachExecutionShapesToPositions } from "./position-execution-shapes.js";
import type { PositionMarketRecord } from "./position-execution-shapes.js";
import { createRequestGate, mapWithThrottle } from "./request-throttle.js";
import {
  emptyWalletSnapshot,
  fetchWalletSnapshot
} from "./wallet-snapshot.js";

export const SUPPORTED_POSITION_PROTOCOLS = [
  "tinyman",
  "pact",
  "folks-finance",
  "compx",
  "dorkfi",
  "myth-finance",
  "haystack",
  "reti",
  "alpha-arcade"
] as const satisfies readonly Protocol[];

export class AllPositionSourcesUnavailableError extends Error {
  public constructor() {
    super("All wallet position sources are unavailable.");
    this.name = "AllPositionSourcesUnavailableError";
  }
}

type PositionCollectors = Record<Protocol, PositionCollector>;

let collectorOverrides: Partial<PositionCollectors> | undefined;

export function setPositionCollectorsForTests(
  overrides?: Partial<PositionCollectors>
): void {
  collectorOverrides = overrides;
}

export async function fetchWalletPositions(
  address: string
): Promise<WalletPositionsResponse> {
  const collectors = resolveCollectors();
  const snapshot =
    collectorOverrides === undefined
      ? await fetchWalletSnapshot(address)
      : emptyWalletSnapshot(address);
  const context: PositionCollectionContext = {
    algodRequestGate: createRequestGate({
      concurrency: readPositiveInteger(
        process.env.POSITIONS_RPC_CONCURRENCY,
        2
      ),
      delayMs: readNonNegativeInteger(process.env.POSITIONS_RPC_DELAY_MS, 125)
    })
  };
  const settled: Array<
    PromiseSettledResult<ProtocolPositionsCollection> | undefined
  > = new Array(SUPPORTED_POSITION_PROTOCOLS.length);
  await mapWithThrottle(
    SUPPORTED_POSITION_PROTOCOLS.map((protocol, index) => ({
      protocol,
      index
    })),
    {
      concurrency: readPositiveInteger(
        process.env.POSITIONS_PROTOCOL_CONCURRENCY,
        2
      ),
      delayMs: 0
    },
    async ({ protocol, index }) => {
      try {
        settled[index] = {
          status: "fulfilled",
          value: await collectors[protocol](address, snapshot, context)
        };
      } catch (reason) {
        settled[index] = { status: "rejected", reason };
      }
    }
  );
  const data: PositionMarketRecord[] = [];
  const protocols: ProtocolPositionResult[] = [];
  const coverage = {
    suppliedUsdComplete: true,
    borrowedUsdComplete: true,
    rewardsUsdComplete: true
  };

  settled.forEach((result, index) => {
    if (result === undefined) {
      throw new Error(`Positions collector ${index} returned no result.`);
    }
    const protocol = SUPPORTED_POSITION_PROTOCOLS[index]!;
    if (result.status === "rejected") {
      coverage.suppliedUsdComplete = false;
      if (
        protocol === "folks-finance" ||
        protocol === "compx" ||
        protocol === "dorkfi"
      ) {
        // Debt-capable collectors: missing liabilities must null borrowedUsd.
        coverage.borrowedUsdComplete = false;
      }
      coverage.rewardsUsdComplete = false;
      protocols.push({
        protocol,
        status: "unavailable",
        positionCount: 0,
        message: errorMessage(result.reason)
      });
      return;
    }

    data.push(...result.value.positions);
    const sourceCoverage = result.value.coverage ?? {
      // Collectors should return explicit coverage. If they omit it, only treat
      // warnings as a supplied-USD gap — do not hard-null borrowed/rewards.
      suppliedUsdComplete: result.value.warnings.length === 0,
      borrowedUsdComplete: true,
      rewardsUsdComplete: true
    };
    coverage.suppliedUsdComplete &&= sourceCoverage.suppliedUsdComplete;
    coverage.borrowedUsdComplete &&= sourceCoverage.borrowedUsdComplete;
    coverage.rewardsUsdComplete &&= sourceCoverage.rewardsUsdComplete;
    protocols.push({
      protocol,
      status: result.value.warnings.length > 0 ? "partial" : "ok",
      positionCount: result.value.positions.length,
      message:
        result.value.warnings.length > 0
          ? result.value.warnings.join("; ")
          : null
    });
  });

  if (protocols.every((result) => result.status === "unavailable")) {
    throw new AllPositionSourcesUnavailableError();
  }

  const enrichedData = attachExecutionShapesToPositions(data);

  return {
    data: enrichedData,
    protocols,
    totals: calculateTotals(enrichedData, coverage),
    meta: {
      address,
      fetchedAt: new Date().toISOString()
    }
  };
}

function calculateTotals(
  positions: PositionMarketRecord[] | WalletPositionsResponse["data"],
  coverage: {
    suppliedUsdComplete: boolean;
    borrowedUsdComplete: boolean;
    rewardsUsdComplete: boolean;
  }
): WalletPositionTotals {
  const suppliedUsd = sumUsd(
    positions.filter((position) =>
      ["supplied", "lp", "staked"].includes(position.positionType)
    ),
    coverage.suppliedUsdComplete
  );
  const borrowedUsd = sumUsd(
    positions.filter((position) => position.positionType === "debt"),
    coverage.borrowedUsdComplete
  );
  const rewardsUsd = sumUsd(
    positions.filter((position) => position.positionType === "reward"),
    coverage.rewardsUsdComplete
  );
  return {
    suppliedUsd,
    borrowedUsd,
    rewardsUsd,
    netUsd:
      suppliedUsd === null || borrowedUsd === null || rewardsUsd === null
        ? null
        : suppliedUsd - borrowedUsd + rewardsUsd
  };
}

function sumUsd(
  positions: ReadonlyArray<{ usdValue: number | null }>,
  complete: boolean
): number | null {
  if (!complete) {
    return null;
  }
  // Unpriced supplemental rows (e.g. Dork.fi ASA exit-planning supplies) must
  // not poison priced USD aggregates from the same wallet response.
  const priced = positions.filter((position) => position.usdValue !== null);
  if (priced.length === 0) {
    return positions.length === 0 ? 0 : null;
  }
  return priced.reduce(
    (sum, position) => sum + (position.usdValue ?? 0),
    0
  );
}

function resolveCollectors(): PositionCollectors {
  return {
    tinyman: collectTinymanPositions,
    pact: collectPactPositions,
    "folks-finance": collectFolksFinancePositions,
    compx: collectCompXPositions,
    dorkfi: collectDorkFiPositions,
    "myth-finance": collectMythFinancePositions,
    haystack: collectHaystackPositions,
    reti: collectRetiPositions,
    "alpha-arcade": collectAlphaArcadePositions,
    ...collectorOverrides
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeInteger(
  value: string | undefined,
  fallback: number
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
