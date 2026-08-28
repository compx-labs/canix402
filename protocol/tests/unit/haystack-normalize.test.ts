import assert from "node:assert/strict";
import test from "node:test";

import type { Algodv2 } from "algosdk";

import {
  HAYSTACK_STAKING_APP_ID,
  HAYSTACK_STAKING_OPPORTUNITY_ID,
  HAY_ASSET_ID,
  HaystackAdapterError,
  USDC_ASSET_ID,
  fetchHaystackOpportunities,
  fixedPointAprToPercentage,
  normalizeHaystackStakingOpportunity,
  setHaystackAdapterDependenciesForTests
} from "../../src/adapters/index.js";
import { SOURCE_TIMESTAMP_FETCH_PROXY_NOTE } from "../../src/services/source-metadata.js";
import {
  HAYSTACK_FIXTURE_FETCHED_AT,
  HAYSTACK_HAY_USD_PRICE,
  haystackEmptyStake,
  haystackPausedPool,
  haystackPoolSnapshot
} from "../fixtures/adapters/haystack.js";
import { assertValidMarketRecord } from "./helpers/assert-market-record.js";

const dummyAlgod = {} as Algodv2;

test.afterEach(() => {
  setHaystackAdapterDependenciesForTests();
});

test("fixedPointAprToPercentage treats 1e6 as 1%", () => {
  assert.equal(fixedPointAprToPercentage(1_000_000n), 1);
  assert.ok(Math.abs((fixedPointAprToPercentage(83540n) ?? 0) - 0.08354) < 0.0001);
  assert.equal(fixedPointAprToPercentage(-1n), null);
});

test("normalizeHaystackStakingOpportunity combines EMA APR components", () => {
  const record = normalizeHaystackStakingOpportunity({
    snapshot: haystackPoolSnapshot(),
    hayUsdPrice: HAYSTACK_HAY_USD_PRICE,
    fetchedAtIso: HAYSTACK_FIXTURE_FETCHED_AT
  });
  assertValidMarketRecord(record);
  assert.equal(record.protocol, "haystack");
  assert.equal(record.opportunityType, "staking");
  assert.equal(record.opportunityId, HAYSTACK_STAKING_OPPORTUNITY_ID);
  assert.equal(record.assetPair, "HAY/USDC+HAY");
  assert.deepEqual(record.assetIds, [HAY_ASSET_ID, USDC_ASSET_ID]);
  assert.equal(record.yieldBasis, "apr");
  assert.equal(record.apr, 2.05);
  assert.equal(record.apy, 2.05);
  assert.equal(record.tvlUsd, 20_000);
  assert.equal(record.fetchedAt, HAYSTACK_FIXTURE_FETCHED_AT);
  assert.equal(record.sourceTimestamp, HAYSTACK_FIXTURE_FETCHED_AT);
  assert.match(record.notes ?? "", new RegExp(SOURCE_TIMESTAMP_FETCH_PROXY_NOTE));
  assert.match(record.notes ?? "", new RegExp(`app ${HAYSTACK_STAKING_APP_ID}`));
  assert.match(record.notes ?? "", /emaAPRUsdc \(2\.00%\)/);
  assert.match(record.notes ?? "", /emaAPRHay \(0\.05%\)/);
});

test("normalizeHaystackStakingOpportunity drops paused, empty, or unpriced pools", () => {
  assert.equal(
    normalizeHaystackStakingOpportunity({
      snapshot: haystackPausedPool,
      hayUsdPrice: HAYSTACK_HAY_USD_PRICE,
      fetchedAtIso: HAYSTACK_FIXTURE_FETCHED_AT
    }),
    null
  );
  assert.equal(
    normalizeHaystackStakingOpportunity({
      snapshot: haystackEmptyStake,
      hayUsdPrice: HAYSTACK_HAY_USD_PRICE,
      fetchedAtIso: HAYSTACK_FIXTURE_FETCHED_AT
    }),
    null
  );
  assert.equal(
    normalizeHaystackStakingOpportunity({
      snapshot: haystackPoolSnapshot(),
      hayUsdPrice: null,
      fetchedAtIso: HAYSTACK_FIXTURE_FETCHED_AT
    }),
    null
  );
  assert.equal(
    normalizeHaystackStakingOpportunity({
      snapshot: haystackPoolSnapshot(),
      hayUsdPrice: 0,
      fetchedAtIso: HAYSTACK_FIXTURE_FETCHED_AT
    }),
    null
  );
});

test("fetchHaystackOpportunities maps a mocked pool snapshot into one staking row", async () => {
  setHaystackAdapterDependenciesForTests({
    createAlgodClient: () => dummyAlgod,
    getPoolSnapshot: async () => haystackPoolSnapshot(),
    fetchHayUsdPrice: async () => HAYSTACK_HAY_USD_PRICE
  });

  const records = await fetchHaystackOpportunities(async () => new Response("{}"));
  assert.equal(records.length, 1);
  assertValidMarketRecord(records[0] ?? null);
  assert.equal(records[0]?.opportunityId, HAYSTACK_STAKING_OPPORTUNITY_ID);
  assert.equal(records[0]?.apr, 2.05);
});

test("fetchHaystackOpportunities returns an empty list when the pool is paused", async () => {
  setHaystackAdapterDependenciesForTests({
    createAlgodClient: () => dummyAlgod,
    getPoolSnapshot: async () => haystackPausedPool,
    fetchHayUsdPrice: async () => HAYSTACK_HAY_USD_PRICE
  });

  const records = await fetchHaystackOpportunities(async () => new Response("{}"));
  assert.deepEqual(records, []);
});

test("fetchHaystackOpportunities wraps snapshot failures as HaystackAdapterError", async () => {
  setHaystackAdapterDependenciesForTests({
    createAlgodClient: () => dummyAlgod,
    getPoolSnapshot: async () => {
      throw new Error("algod unavailable");
    },
    fetchHayUsdPrice: async () => HAYSTACK_HAY_USD_PRICE
  });

  await assert.rejects(
    () => fetchHaystackOpportunities(async () => new Response("{}")),
    (error: unknown) => {
      assert.ok(error instanceof HaystackAdapterError);
      assert.match(error.message, /Haystack adapter request failed/);
      return true;
    }
  );
});
