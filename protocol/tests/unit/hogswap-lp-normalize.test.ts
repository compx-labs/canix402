import assert from "node:assert/strict";
import test from "node:test";

import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import {
  fetchHogswapAnalyticsPrices,
  fetchHogswapLpCatalog,
  mapHogswapDexToProtocol,
  parseHogswapLpValuation,
  resetHogswapClientCacheForTests,
  setHogswapClientDependenciesForTests
} from "../../src/services/hogswap-client.js";
import { normalizeHogswapLpPosition } from "../../src/services/hogswap-lp-positions.js";
import { PositionRecordSchema } from "../../src/types/position-schema.js";
import {
  hogswapAlgofiLpValuation,
  hogswapAnalyticsPricesFixture,
  hogswapHumbleLpValuation,
  hogswapNullSupplyLpValuation,
  hogswapPoolsPage1,
  hogswapPoolsPage2,
  hogswapStammLpValuation,
  hogswapStammPoolsFixture,
  HOGSWAP_FIXTURE_ALGOFI_LP_ASSET_ID,
  HOGSWAP_FIXTURE_HUMBLE_LP_ASSET_ID,
  HOGSWAP_FIXTURE_PACT_LP_ASSET_ID,
  HOGSWAP_FIXTURE_STAMM_LP_ASSET_ID,
  HOGSWAP_FIXTURE_TINYMAN_LP_ASSET_ID
} from "../fixtures/hogswap/lp-valuation.js";

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
if (!FormatRegistry.Has("date-time")) {
  FormatRegistry.Set("date-time", (value) => ISO_DATE_TIME.test(value));
}

test.afterEach(() => {
  setHogswapClientDependenciesForTests(undefined);
  resetHogswapClientCacheForTests();
});

test("mapHogswapDexToProtocol maps STAMM/AlgoFi/Humble and ignores overlap venues", () => {
  assert.equal(mapHogswapDexToProtocol("STAMM"), "stamm");
  assert.equal(mapHogswapDexToProtocol("AlgoFi CP"), "algofi");
  assert.equal(mapHogswapDexToProtocol("Humble"), "humble");
  assert.equal(mapHogswapDexToProtocol("Tinyman v2"), null);
  assert.equal(mapHogswapDexToProtocol("Pact CP"), null);
});

test("normalizeHogswapLpPosition maps recorded STAMM /lp payload into lp schema", () => {
  const valuation = parseHogswapLpValuation(hogswapStammLpValuation);
  const record = normalizeHogswapLpPosition(
    "stamm",
    1_000_000n,
    {
      lpAssetId: HOGSWAP_FIXTURE_STAMM_LP_ASSET_ID,
      poolId: 3544790053,
      dexName: "STAMM",
      tierIndex: 1,
      assetA: 0,
      assetB: 3178895177,
      lpDecimals: 6
    },
    valuation
  );
  assert.ok(record);
  assert.equal(record.protocol, "stamm");
  assert.equal(record.positionType, "lp");
  assert.equal(record.positionId, `stamm:lp:${HOGSWAP_FIXTURE_STAMM_LP_ASSET_ID}`);
  assert.equal(record.opportunityId, "3544790053:lp:1");
  assert.equal(record.assetId, HOGSWAP_FIXTURE_STAMM_LP_ASSET_ID);
  assert.equal(record.assetSymbol, "ALGO/ASSET-3178895177 LP");
  assert.equal(record.amountRaw, "1000000");
  assert.equal(record.amount, "1");
  assert.equal(record.usdValue, 0.303238);
  assert.deepEqual(record.assetIds, [0, 3178895177]);
  assert.equal(record.inputHints?.tierIndex, 1);
  assert.equal(record.inputHints?.assetAId, 0);
  assert.equal(record.inputHints?.assetBId, 3178895177);
  assert.equal(record.inputHints?.poolAppId, 3544790053);
  assert.match(record.notes ?? "", /Redeemable \(proportional\): 1671162 base units of asset 0/);
  assert.match(record.notes ?? "", /DEX=STAMM/);
  const publicRecord = {
    ...record,
    compatibleExitShapeKeys: [],
    compatibleManageShapeKeys: []
  };
  const errors = [...Value.Errors(PositionRecordSchema, publicRecord)];
  assert.equal(errors.length, 0, errors.map((error) => error.message).join("; "));
});

test("normalizeHogswapLpPosition keeps null USD and redeemable when supply/price are null", () => {
  const valuation = parseHogswapLpValuation(hogswapNullSupplyLpValuation);
  assert.equal(valuation.lpSupply, null);
  assert.equal(valuation.valueUsdMicro, null);
  const record = normalizeHogswapLpPosition(
    "stamm",
    1_000_000n,
    {
      lpAssetId: hogswapNullSupplyLpValuation.asset_id,
      poolId: 3544790053,
      dexName: "STAMM",
      tierIndex: 0,
      assetA: 0,
      assetB: 3178895177,
      lpDecimals: 6
    },
    valuation
  );
  assert.ok(record);
  assert.equal(record.usdValue, null);
  assert.match(record.notes ?? "", /Redeemable underlyings unavailable/);
});

test("normalizeHogswapLpPosition maps AlgoFi and Humble DEX rows without a STAMM tier", () => {
  const algofi = normalizeHogswapLpPosition(
    "algofi",
    1_000_000n,
    {
      lpAssetId: HOGSWAP_FIXTURE_ALGOFI_LP_ASSET_ID,
      poolId: 605929989,
      dexName: "AlgoFi CP",
      tierIndex: null,
      assetA: 0,
      assetB: 312769,
      lpDecimals: 6
    },
    parseHogswapLpValuation(hogswapAlgofiLpValuation)
  );
  assert.ok(algofi);
  assert.equal(algofi.protocol, "algofi");
  assert.equal(algofi.opportunityId, "605929989:lp");
  assert.equal(algofi.inputHints?.tierIndex, undefined);
  assert.equal(algofi.usdValue, 1.058638);

  const humble = normalizeHogswapLpPosition(
    "humble",
    2_000_000n,
    {
      lpAssetId: HOGSWAP_FIXTURE_HUMBLE_LP_ASSET_ID,
      poolId: 1090000000,
      dexName: "Humble",
      tierIndex: null,
      assetA: 0,
      assetB: 312769,
      lpDecimals: 6
    },
    parseHogswapLpValuation(hogswapHumbleLpValuation)
  );
  assert.ok(humble);
  assert.equal(humble.protocol, "humble");
  assert.equal(humble.usdValue, 1);
  assert.equal(humble.amount, "2");
});

test("fetchHogswapLpCatalog merges STAMM tier_breakdown with paginated /pools lp_asset_id", async () => {
  const urls: string[] = [];
  setHogswapClientDependenciesForTests({
    now: () => 1_000,
    fetch: async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith("/stamm/pools")) {
        return jsonResponse(hogswapStammPoolsFixture);
      }
      if (url.includes("/pools?") && url.includes("cursor=page2")) {
        return jsonResponse(hogswapPoolsPage2);
      }
      if (url.includes("/pools?")) {
        return jsonResponse(hogswapPoolsPage1);
      }
      throw new Error(`unexpected URL ${url}`);
    }
  });

  const catalog = await fetchHogswapLpCatalog();
  assert.equal(catalog.get(HOGSWAP_FIXTURE_STAMM_LP_ASSET_ID)?.protocol, "stamm");
  assert.equal(catalog.get(HOGSWAP_FIXTURE_STAMM_LP_ASSET_ID)?.tierIndex, 1);
  assert.equal(catalog.get(HOGSWAP_FIXTURE_ALGOFI_LP_ASSET_ID)?.protocol, "algofi");
  assert.equal(catalog.get(HOGSWAP_FIXTURE_HUMBLE_LP_ASSET_ID)?.protocol, "humble");
  assert.equal(catalog.get(HOGSWAP_FIXTURE_TINYMAN_LP_ASSET_ID)?.dedicatedCollector, true);
  assert.equal(catalog.get(HOGSWAP_FIXTURE_PACT_LP_ASSET_ID)?.dedicatedCollector, true);
  assert.ok(urls.some((url) => url.includes("/stamm/pools")));
  assert.ok(urls.some((url) => url.includes("/pools?") && url.includes("cursor=page2")));

  // Cached catalog should not refetch.
  urls.length = 0;
  const cached = await fetchHogswapLpCatalog();
  assert.equal(cached.size, catalog.size);
  assert.deepEqual(urls, []);
});

test("fetchHogswapAnalyticsPrices filters leftover ids from the recorded bulk map", async () => {
  setHogswapClientDependenciesForTests({
    fetch: async (input) => {
      assert.match(String(input), /\/analytics\/prices$/);
      return jsonResponse(hogswapAnalyticsPricesFixture);
    }
  });
  const priced = await fetchHogswapAnalyticsPrices([0, 99]);
  assert.equal(priced.algoUsd, 0.09);
  assert.equal(priced.prices.get(0)?.priceUsd, 0.09);
  assert.equal(priced.prices.has(99), false);
  assert.equal(priced.prices.has(3178895177), false);
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
