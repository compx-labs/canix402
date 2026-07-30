import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../../src/app.js";
import {
  fetchWalletPositions,
  setPositionCollectorsForTests,
  SUPPORTED_POSITION_PROTOCOLS
} from "../../src/services/aggregate-positions.js";
import {
  buildDorkFiLendingOpportunityId,
  DORKFI_ALGORAND_ASA_MARKETS,
  findCatalogMarket
} from "../../src/execution/shapes/dorkfi/market-catalog.js";
import { normalizeDorkFiHealthRecords } from "../../src/services/protocol-positions.js";
import type { PositionMarketRecord } from "../../src/services/position-execution-shapes.js";
import type { PositionRecordV1 } from "../../src/types/position.js";

const VALID_ADDRESS =
  "RS7TLLQRXKBAQDAVTSZC2ZLMVMLNSCL3FOUOESJJZ5XSKFFL56UI6X33CI";

const COMPLETE_COVERAGE = {
  suppliedUsdComplete: true,
  borrowedUsdComplete: true,
  rewardsUsdComplete: true
} as const;

test.afterEach(() => {
  setPositionCollectorsForTests(undefined);
});

test("aggregate returns every protocol status and preserves safe amounts", async () => {
  const position: PositionMarketRecord = {
    protocol: "tinyman",
    positionType: "lp",
    positionId: "tinyman:lp:99",
    opportunityId: "pool:lp",
    assetId: 99,
    assetSymbol: "ALGO/USDC LP",
    amountRaw: "900719925474099312345",
    amount: "900719925474099.312345",
    usdValue: 42.5
  };
  setPositionCollectorsForTests({
    tinyman: async () => ({
      positions: [position],
      warnings: [],
      coverage: COMPLETE_COVERAGE
    }),
    pact: async () => ({
      positions: [],
      warnings: ["one pool failed"],
      coverage: {
        suppliedUsdComplete: false,
        borrowedUsdComplete: true,
        rewardsUsdComplete: true
      }
    }),
    "folks-finance": async () => {
      throw new Error("indexer offline");
    },
    compx: async () => ({
      positions: [],
      warnings: [],
      coverage: COMPLETE_COVERAGE
    }),
    dorkfi: async () => ({
      positions: [],
      warnings: [],
      coverage: COMPLETE_COVERAGE
    }),
    "myth-finance": async () => ({
      positions: [],
      warnings: [],
      coverage: COMPLETE_COVERAGE
    }),
    haystack: async () => ({
      positions: [],
      warnings: [],
      coverage: COMPLETE_COVERAGE
    }),
    reti: async () => ({
      positions: [],
      warnings: [],
      coverage: COMPLETE_COVERAGE
    })
  });

  const response = await fetchWalletPositions(VALID_ADDRESS);

  assert.equal(response.data[0]?.amountRaw, "900719925474099312345");
  assert.ok(
    (response.data[0]?.compatibleExitShapeKeys.length ?? 0) > 0,
    "LP positions should expose Tinyman remove-liquidity exit shapes"
  );
  // Folks unavailable nulls supplied/rewards USD totals, but borrowed stays
  // complete (debt/lending is out of scope for portfolio responses).
  assert.deepEqual(response.totals, {
    suppliedUsd: null,
    borrowedUsd: 0,
    rewardsUsd: null,
    netUsd: null
  });
  assert.deepEqual(
    response.protocols.map(({ protocol, status }) => ({ protocol, status })),
    [
      { protocol: "tinyman", status: "ok" },
      { protocol: "pact", status: "partial" },
      { protocol: "folks-finance", status: "unavailable" },
      { protocol: "compx", status: "ok" },
      { protocol: "dorkfi", status: "ok" },
      { protocol: "myth-finance", status: "ok" },
      { protocol: "haystack", status: "ok" },
      { protocol: "reti", status: "ok" }
    ]
  );
});

test("aggregate bounds concurrent protocol collectors and preserves protocol order", async () => {
  const originalConcurrency = process.env.POSITIONS_PROTOCOL_CONCURRENCY;
  process.env.POSITIONS_PROTOCOL_CONCURRENCY = "2";
  const started: string[] = [];
  let releaseCollectors: (() => void) | undefined;
  const release = new Promise<void>((resolve) => {
    releaseCollectors = resolve;
  });
  let resolveFirstPair: (() => void) | undefined;
  const firstPairStarted = new Promise<void>((resolve) => {
    resolveFirstPair = resolve;
  });
  const collector = (protocol: string) => async () => {
    started.push(protocol);
    if (started.length === 2) {
      resolveFirstPair?.();
    }
    await release;
    return { positions: [], warnings: [], coverage: COMPLETE_COVERAGE };
  };
  setPositionCollectorsForTests({
    tinyman: collector("tinyman"),
    pact: collector("pact"),
    "folks-finance": collector("folks-finance"),
    compx: collector("compx"),
    dorkfi: collector("dorkfi"),
    "myth-finance": collector("myth-finance"),
    haystack: collector("haystack"),
    reti: collector("reti")
  });

  try {
    const responsePromise = fetchWalletPositions(VALID_ADDRESS);
    await firstPairStarted;

    assert.deepEqual(started, ["tinyman", "pact"]);

    releaseCollectors?.();
    const response = await responsePromise;
    assert.deepEqual(
      response.protocols.map(({ protocol }) => protocol),
      [...SUPPORTED_POSITION_PROTOCOLS]
    );
  } finally {
    if (originalConcurrency === undefined) {
      delete process.env.POSITIONS_PROTOCOL_CONCURRENCY;
    } else {
      process.env.POSITIONS_PROTOCOL_CONCURRENCY = originalConcurrency;
    }
  }
});

test("GET /positions returns 200 for a valid empty wallet", async () => {
  setAllCollectors(async () => ({
    positions: [],
    warnings: [],
    coverage: COMPLETE_COVERAGE
  }));
  const app = buildApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: "GET",
      url: `/positions?address=${VALID_ADDRESS}`
    });
    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      data: unknown[];
      protocols: Array<{ status: string }>;
      totals: {
        suppliedUsd: number;
        borrowedUsd: number;
        rewardsUsd: number;
        netUsd: number;
      };
      meta: { address: string };
    };
    assert.deepEqual(body.data, []);
    assert.equal(body.protocols.length, SUPPORTED_POSITION_PROTOCOLS.length);
    assert.ok(body.protocols.every(({ status }) => status === "ok"));
    assert.deepEqual(body.totals, {
      suppliedUsd: 0,
      borrowedUsd: 0,
      rewardsUsd: 0,
      netUsd: 0
    });
    assert.equal(body.meta.address, VALID_ADDRESS);
  } finally {
    await app.close();
  }
});

test("aggregate calculates complete supplied, borrowed, reward, and net totals", async () => {
  const position = (
    positionType: PositionRecordV1["positionType"],
    usdValue: number
  ): PositionMarketRecord => ({
    protocol: "tinyman",
    positionType,
    positionId: `${positionType}:1`,
    opportunityId: null,
    assetId: 1,
    assetSymbol: "TEST",
    amountRaw: "1",
    amount: "1",
    usdValue
  });
  const emptyCollector = async () => ({
    positions: [],
    warnings: [],
    coverage: COMPLETE_COVERAGE
  });
  setPositionCollectorsForTests({
    tinyman: async () => ({
      positions: [
        position("supplied", 100),
        position("lp", 50),
        position("staked", 25),
        position("debt", 40),
        position("reward", 5)
      ],
      warnings: [],
      coverage: COMPLETE_COVERAGE
    }),
    pact: emptyCollector,
    "folks-finance": emptyCollector,
    compx: emptyCollector,
    dorkfi: emptyCollector,
    "myth-finance": emptyCollector,
    haystack: emptyCollector,
    reti: emptyCollector
  });

  const response = await fetchWalletPositions(VALID_ADDRESS);
  assert.deepEqual(response.totals, {
    suppliedUsd: 175,
    borrowedUsd: 40,
    rewardsUsd: 5,
    netUsd: 140
  });
});

test("complete Tinyman/CompX coverage does not hard-null wallet totals", async () => {
  const emptyCollector = async () => ({
    positions: [],
    warnings: [],
    coverage: COMPLETE_COVERAGE
  });
  setPositionCollectorsForTests({
    tinyman: async () => ({
      positions: [
        {
          protocol: "tinyman",
          positionType: "lp",
          positionId: "tinyman:lp:1",
          opportunityId: null,
          assetId: 1,
          assetSymbol: "LP",
          amountRaw: "1",
          amount: "1",
          usdValue: 100
        },
        {
          protocol: "tinyman",
          positionType: "reward",
          positionId: "tinyman:reward:1",
          opportunityId: null,
          assetId: 2,
          assetSymbol: "TINY",
          amountRaw: "1",
          amount: "1",
          usdValue: 3
        }
      ],
      warnings: [],
      coverage: COMPLETE_COVERAGE
    }),
    pact: emptyCollector,
    "folks-finance": emptyCollector,
    compx: async () => ({
      positions: [
        {
          protocol: "compx",
          positionType: "debt",
          positionId: "compx:debt:1",
          opportunityId: null,
          assetId: 31566704,
          assetSymbol: "USDC",
          amountRaw: "2500000",
          amount: "2.5",
          usdValue: 2.5
        },
        {
          protocol: "compx",
          positionType: "reward",
          positionId: "compx:reward:1",
          opportunityId: null,
          assetId: 31566704,
          assetSymbol: "USDC",
          amountRaw: "100000",
          amount: "0.1",
          usdValue: 0.1
        }
      ],
      warnings: [],
      coverage: COMPLETE_COVERAGE
    }),
    dorkfi: emptyCollector,
    "myth-finance": emptyCollector,
    haystack: emptyCollector,
    reti: emptyCollector
  });

  const response = await fetchWalletPositions(VALID_ADDRESS);
  assert.deepEqual(response.totals, {
    suppliedUsd: 100,
    borrowedUsd: 2.5,
    rewardsUsd: 3.1,
    netUsd: 100.6
  });
  assert.ok(response.protocols.every(({ status }) => status === "ok"));
});

test("rewards-only incomplete coverage nulls rewardsUsd and netUsd only", async () => {
  const emptyCollector = async () => ({
    positions: [],
    warnings: [],
    coverage: COMPLETE_COVERAGE
  });
  setPositionCollectorsForTests({
    tinyman: async () => ({
      positions: [
        {
          protocol: "tinyman",
          positionType: "lp",
          positionId: "tinyman:lp:1",
          opportunityId: null,
          assetId: 1,
          assetSymbol: "LP",
          amountRaw: "1",
          amount: "1",
          usdValue: 50
        },
        {
          protocol: "tinyman",
          positionType: "reward",
          positionId: "tinyman:reward:1",
          opportunityId: null,
          assetId: 2,
          assetSymbol: "TINY",
          amountRaw: "1",
          amount: "1",
          usdValue: null
        }
      ],
      warnings: ["Tinyman farm reward USD pricing is unavailable."],
      coverage: {
        suppliedUsdComplete: true,
        borrowedUsdComplete: true,
        rewardsUsdComplete: false
      }
    }),
    pact: emptyCollector,
    "folks-finance": emptyCollector,
    compx: emptyCollector,
    dorkfi: emptyCollector,
    "myth-finance": emptyCollector,
    haystack: emptyCollector,
    reti: emptyCollector
  });

  const response = await fetchWalletPositions(VALID_ADDRESS);
  assert.deepEqual(response.totals, {
    suppliedUsd: 50,
    borrowedUsd: 0,
    rewardsUsd: null,
    netUsd: null
  });
  assert.equal(
    response.protocols.find((row) => row.protocol === "tinyman")?.status,
    "partial"
  );
});

test("collector warnings without coverage no longer hard-null borrowed/rewards", async () => {
  const emptyCollector = async () => ({
    positions: [],
    warnings: [],
    coverage: COMPLETE_COVERAGE
  });
  setPositionCollectorsForTests({
    tinyman: async () => ({
      positions: [
        {
          protocol: "tinyman",
          positionType: "lp",
          positionId: "tinyman:lp:1",
          opportunityId: null,
          assetId: 1,
          assetSymbol: "LP",
          amountRaw: "1",
          amount: "1",
          usdValue: 20
        }
      ],
      warnings: [],
      coverage: COMPLETE_COVERAGE
    }),
    // Legacy/omitted coverage + warning used to force all three flags false.
    pact: async () => ({
      positions: [],
      warnings: ["one pool failed"]
    }),
    "folks-finance": emptyCollector,
    compx: emptyCollector,
    dorkfi: emptyCollector,
    "myth-finance": emptyCollector,
    haystack: emptyCollector,
    reti: emptyCollector
  });

  const response = await fetchWalletPositions(VALID_ADDRESS);
  assert.deepEqual(response.totals, {
    suppliedUsd: null,
    borrowedUsd: 0,
    rewardsUsd: 0,
    netUsd: null
  });
});

test("Dork.fi indexed health records normalize supplied USD only (no debt)", () => {
  const result = normalizeDorkFiHealthRecords([
    {
      network: "algorand-mainnet",
      appId: "3333688282",
      totalCollateralValue: "12500000000000",
      totalBorrowValue: "3000000000000",
      healthFactor: "4.1667",
      lastUpdated: 1_783_944_000_000
    }
  ]);

  assert.equal(result.positions.length, 1);
  assert.deepEqual(
    result.positions.map((position) => ({
      type: position.positionType,
      positionId: position.positionId,
      opportunityId: position.opportunityId,
      usdValue: position.usdValue,
      healthFactor: position.healthFactor,
      sourceTimestamp: position.sourceTimestamp
    })),
    [
      {
        type: "supplied",
        positionId: "dorkfi:supplied-usd:3333688282",
        opportunityId: null,
        usdValue: 12.5,
        healthFactor: 4.1667,
        sourceTimestamp: "2026-07-13T12:00:00.000Z"
      }
    ]
  );
  assert.deepEqual(result.warnings, []);
  assert.equal(result.coverage?.borrowedUsdComplete, true);
  assert.ok(
    (result.positions[0]?.caveats ?? []).some((caveat) =>
      caveat.includes("Not executable")
    )
  );
});

test("Dork.fi ASA catalog opportunityId uses poolAppId and resolves distinct marketAppId", () => {
  const usdc = DORKFI_ALGORAND_ASA_MARKETS.find((market) => market.symbol === "USDC");
  assert.ok(usdc);
  const opportunityId = buildDorkFiLendingOpportunityId({
    poolAppId: usdc.poolAppId,
    assetId: usdc.assetId
  });
  assert.equal(opportunityId, "dorkfi:algorand:3333688282:31566704:lending");
  assert.notEqual(opportunityId, `dorkfi:algorand:${usdc.marketAppId}:${usdc.assetId}:lending`);

  const catalog = findCatalogMarket({
    poolAppId: usdc.poolAppId,
    marketAppId: usdc.marketAppId,
    assetId: usdc.assetId
  });
  assert.equal(catalog?.marketAppId, 3210682240);
  assert.equal(catalog?.poolAppId, 3333688282);
});

test("GET /positions returns 502 only when every source is unavailable", async () => {
  setAllCollectors(async () => {
    throw new Error("offline");
  });
  const app = buildApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: "GET",
      url: `/positions?address=${VALID_ADDRESS}`
    });
    assert.equal(response.statusCode, 502);
    assert.equal(response.json().error.code, "INTERNAL_ERROR");
  } finally {
    await app.close();
  }
});

test("GET /positions rejects invalid Algorand addresses", async () => {
  const app = buildApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: "GET",
      url: "/positions?address=invalid"
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "VALIDATION_ERROR");
  } finally {
    await app.close();
  }
});

function setAllCollectors(
  collector: () => Promise<{
    positions: PositionMarketRecord[];
    warnings: string[];
    coverage?: {
      suppliedUsdComplete: boolean;
      borrowedUsdComplete: boolean;
      rewardsUsdComplete: boolean;
    };
  }>
): void {
  setPositionCollectorsForTests({
    tinyman: collector,
    pact: collector,
    "folks-finance": collector,
    compx: collector,
    dorkfi: collector,
    "myth-finance": collector,
    haystack: collector,
    reti: collector
  });
}
