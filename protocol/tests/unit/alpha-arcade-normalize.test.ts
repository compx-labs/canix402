import assert from "node:assert/strict";
import test from "node:test";

import type { Algodv2, Indexer } from "algosdk";

import {
  ALPHA_ARCADE_STAKING_APP_ID,
  ALPHA_ARCADE_STAKING_OPPORTUNITY_ID,
  ALPHA_ASSET_ID,
  AlphaArcadeAdapterError,
  TRAILING_APR_WINDOW_DAYS,
  USDC_ASSET_ID,
  annualizeTrailingFeeApr,
  fetchAlphaArcadeOpportunities,
  normalizeAlphaArcadeStakingOpportunity,
  setAlphaArcadeAdapterDependenciesForTests
} from "../../src/adapters/index.js";
import { SOURCE_TIMESTAMP_FETCH_PROXY_NOTE } from "../../src/services/source-metadata.js";
import {
  ALPHA_ARCADE_ALPHA_USD_PRICE,
  ALPHA_ARCADE_FIXTURE_FETCHED_AT,
  ALPHA_ARCADE_WINDOW_DAYS,
  alphaArcadeEmptyStake,
  alphaArcadePoolSnapshot
} from "../fixtures/adapters/alpha-arcade.js";
import { assertValidMarketRecord } from "./helpers/assert-market-record.js";

const dummyAlgod = {} as Algodv2;
const dummyIndexer = {} as Indexer;
const USDC_INFLOWS_MICRO = 400_000_000n; // $400 over the window

test.afterEach(() => {
  setAlphaArcadeAdapterDependenciesForTests();
});

test("annualizeTrailingFeeApr scales weekly inflows to APR percent", () => {
  const apr = annualizeTrailingFeeApr({
    usdcInflowsUsd: 10,
    tvlUsd: 1_000,
    windowDays: 7
  });
  assert.ok(apr !== null);
  assert.ok(Math.abs((apr ?? 0) - 52.142857) < 0.001);
  assert.equal(
    annualizeTrailingFeeApr({ usdcInflowsUsd: 10, tvlUsd: 0, windowDays: 7 }),
    null
  );
  assert.equal(
    annualizeTrailingFeeApr({ usdcInflowsUsd: 10, tvlUsd: 1_000, windowDays: 0 }),
    null
  );
});

test("normalizeAlphaArcadeStakingOpportunity builds fee-share staking row", () => {
  const record = normalizeAlphaArcadeStakingOpportunity({
    snapshot: alphaArcadePoolSnapshot(),
    alphaUsdPrice: ALPHA_ARCADE_ALPHA_USD_PRICE,
    usdcInflowsMicro: USDC_INFLOWS_MICRO,
    windowDays: ALPHA_ARCADE_WINDOW_DAYS,
    fetchedAtIso: ALPHA_ARCADE_FIXTURE_FETCHED_AT
  });
  assertValidMarketRecord(record);
  assert.equal(record.protocol, "alpha-arcade");
  assert.equal(record.opportunityType, "staking");
  assert.equal(record.opportunityId, ALPHA_ARCADE_STAKING_OPPORTUNITY_ID);
  assert.equal(record.assetPair, "ALPHA/USDC");
  assert.deepEqual(record.assetIds, [ALPHA_ASSET_ID, USDC_ASSET_ID]);
  assert.equal(record.yieldBasis, "apr");
  assert.equal(record.tvlUsd, 20_000);
  // ($400 / $20_000) * (365 / 7) * 100 ≈ 104.2857%
  assert.ok(Math.abs((record.apr ?? 0) - 104.285714) < 0.001);
  assert.equal(record.apy, record.apr);
  assert.equal(record.fetchedAt, ALPHA_ARCADE_FIXTURE_FETCHED_AT);
  assert.equal(record.sourceTimestamp, ALPHA_ARCADE_FIXTURE_FETCHED_AT);
  assert.match(record.notes ?? "", new RegExp(SOURCE_TIMESTAMP_FETCH_PROXY_NOTE));
  assert.match(record.notes ?? "", new RegExp(`app ${ALPHA_ARCADE_STAKING_APP_ID}`));
  assert.match(record.notes ?? "", new RegExp(`trailing ${TRAILING_APR_WINDOW_DAYS}d`));
});

test("normalizeAlphaArcadeStakingOpportunity omits incomplete TVL, price, or inflow rows", () => {
  const base = {
    snapshot: alphaArcadePoolSnapshot(),
    alphaUsdPrice: ALPHA_ARCADE_ALPHA_USD_PRICE,
    usdcInflowsMicro: USDC_INFLOWS_MICRO,
    windowDays: ALPHA_ARCADE_WINDOW_DAYS,
    fetchedAtIso: ALPHA_ARCADE_FIXTURE_FETCHED_AT
  };
  assert.equal(
    normalizeAlphaArcadeStakingOpportunity({ ...base, snapshot: alphaArcadeEmptyStake }),
    null
  );
  assert.equal(
    normalizeAlphaArcadeStakingOpportunity({ ...base, alphaUsdPrice: null }),
    null
  );
  assert.equal(
    normalizeAlphaArcadeStakingOpportunity({ ...base, usdcInflowsMicro: 0n }),
    null
  );
  assert.equal(
    normalizeAlphaArcadeStakingOpportunity({ ...base, usdcInflowsMicro: null }),
    null
  );
});

test("fetchAlphaArcadeOpportunities maps a mocked pool and inflows into one staking row", async () => {
  setAlphaArcadeAdapterDependenciesForTests({
    createAlgodClient: () => dummyAlgod,
    createIndexerClient: () => dummyIndexer,
    getPoolSnapshot: async () => alphaArcadePoolSnapshot(),
    fetchAlphaUsdPrice: async () => ALPHA_ARCADE_ALPHA_USD_PRICE,
    fetchTrailingUsdcInflowsMicro: async () => USDC_INFLOWS_MICRO
  });

  const records = await fetchAlphaArcadeOpportunities(async () => new Response("{}"));
  assert.equal(records.length, 1);
  assertValidMarketRecord(records[0] ?? null);
  assert.equal(records[0]?.opportunityId, ALPHA_ARCADE_STAKING_OPPORTUNITY_ID);
  assert.ok((records[0]?.apr ?? 0) > 0);
});

test("fetchAlphaArcadeOpportunities returns an empty list without trailing inflows", async () => {
  setAlphaArcadeAdapterDependenciesForTests({
    createAlgodClient: () => dummyAlgod,
    createIndexerClient: () => dummyIndexer,
    getPoolSnapshot: async () => alphaArcadePoolSnapshot(),
    fetchAlphaUsdPrice: async () => ALPHA_ARCADE_ALPHA_USD_PRICE,
    fetchTrailingUsdcInflowsMicro: async () => 0n
  });

  const records = await fetchAlphaArcadeOpportunities(async () => new Response("{}"));
  assert.deepEqual(records, []);
});

test("fetchAlphaArcadeOpportunities wraps snapshot failures as AlphaArcadeAdapterError", async () => {
  setAlphaArcadeAdapterDependenciesForTests({
    createAlgodClient: () => dummyAlgod,
    createIndexerClient: () => dummyIndexer,
    getPoolSnapshot: async () => {
      throw new Error("algod unavailable");
    },
    fetchAlphaUsdPrice: async () => ALPHA_ARCADE_ALPHA_USD_PRICE,
    fetchTrailingUsdcInflowsMicro: async () => USDC_INFLOWS_MICRO
  });

  await assert.rejects(
    () => fetchAlphaArcadeOpportunities(async () => new Response("{}")),
    (error: unknown) => {
      assert.ok(error instanceof AlphaArcadeAdapterError);
      assert.match(error.message, /Alpha Arcade adapter request failed/);
      return true;
    }
  );
});
