import assert from "node:assert/strict";
import test from "node:test";

import {
  aerodromeFarmOpportunityId,
  fetchAerodromeOpportunities,
  normalizeAerodromePool,
  setAerodromeAdapterDependenciesForTests
} from "../../src/adapters/index.js";
import { decodeLpSugarAll } from "../../src/adapters/aerodrome-sugar.js";
import { AERODROME_AERO } from "../../src/adapters/aerodrome.js";
import {
  AERO_GAUGE,
  AERO_POOL,
  AERO_TOKEN0,
  AERO_TOKEN1,
  AERODROME_FIXTURE_FETCHED_AT,
  SUGAR_VOLATILE_PAGE_HEX,
  aerodromePrices,
  volatilePool
} from "../fixtures/adapters/aerodrome-pools.js";
import { assertValidMarketRecord } from "./helpers/assert-market-record.js";

const MIN_TVL = 1_000;

test.afterEach(() => {
  setAerodromeAdapterDependenciesForTests(undefined);
});

test("decodeLpSugarAll reads a volatile pool page", () => {
  const [pool] = decodeLpSugarAll(SUGAR_VOLATILE_PAGE_HEX);
  assert.ok(pool);
  assert.equal(pool.lp, AERO_POOL);
  assert.equal(pool.symbol, "vAMM-WETH/USDC");
  assert.equal(pool.decimals, 18);
  assert.equal(pool.type, -1);
  assert.equal(pool.token0, AERO_TOKEN0);
  assert.equal(pool.reserve0, 5n * 10n ** 18n);
  assert.equal(pool.staked0, 4n * 10n ** 18n);
  assert.equal(pool.token1, AERO_TOKEN1);
  assert.equal(pool.staked1, 1_500n * 10n ** 6n);
  assert.equal(pool.gauge, AERO_GAUGE);
  assert.equal(pool.gaugeAlive, true);
  assert.equal(pool.emissions, 10n ** 15n);
  assert.equal(pool.emissionsToken, AERODROME_AERO);
});

test("normalizeAerodromePool maps a volatile gauge pool onto emissions APY", () => {
  const record = normalizeAerodromePool(
    volatilePool(),
    aerodromePrices,
    AERODROME_FIXTURE_FETCHED_AT,
    { minTvlUsd: MIN_TVL }
  );
  assert.ok(record);
  assertValidMarketRecord(record);
  assert.equal(record.protocol, "aerodrome");
  assert.equal(record.chain, "base");
  assert.equal(record.opportunityType, "farm");
  assert.equal(record.assetPair, "WETH/USDC");
  assert.equal(record.yieldBasis, "apy");
  assert.equal(record.assetIds, undefined);
  assert.deepEqual(record.assetAddresses, [AERO_TOKEN0, AERO_TOKEN1]);
  assert.equal(record.poolId, AERO_POOL);
  assert.equal(record.opportunityId, aerodromeFarmOpportunityId(AERO_POOL));
  assert.equal(record.tvlUsd, 12_000);
  const emissionsUsdPerYear = 31_536;
  const stakedTvlUsd = 9_500;
  assert.equal(record.apy, (emissionsUsdPerYear / stakedTvlUsd) * 100);
  assert.match(record.notes ?? "", /volatile/);
  assert.match(record.notes ?? "", /trading fees accrue to voters/);
  assert.equal(record.borrowApr, undefined);
});

test("normalizeAerodromePool keeps a stable pool and drops everything else", () => {
  const stable = normalizeAerodromePool(
    volatilePool({ type: 0, symbol: "sAMM-WETH/USDC" }),
    aerodromePrices,
    AERODROME_FIXTURE_FETCHED_AT,
    { minTvlUsd: MIN_TVL }
  );
  assert.equal(stable?.notes?.includes("stable"), true);

  const native = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  for (const lp of [
    volatilePool({ type: 100 }),
    volatilePool({ gaugeAlive: false }),
    volatilePool({ emissions: 0n }),
    volatilePool({ token0: native }),
    volatilePool({ factory: "0x9999999999999999999999999999999999999999" }),
    volatilePool({ staked0: 0n, staked1: 0n })
  ]) {
    assert.equal(
      normalizeAerodromePool(lp, aerodromePrices, AERODROME_FIXTURE_FETCHED_AT, {
        minTvlUsd: MIN_TVL
      }),
      null
    );
  }

  assert.equal(
    normalizeAerodromePool(volatilePool(), aerodromePrices, AERODROME_FIXTURE_FETCHED_AT),
    null
  );
  const missingAero = new Map(aerodromePrices);
  missingAero.delete(AERODROME_AERO);
  assert.equal(
    normalizeAerodromePool(volatilePool(), missingAero, AERODROME_FIXTURE_FETCHED_AT, {
      minTvlUsd: MIN_TVL
    }),
    null
  );
});

test("fetchAerodromeOpportunities keeps listed basic pools and caches the page", async () => {
  let reads = 0;
  setAerodromeAdapterDependenciesForTests({
    minTvlUsd: MIN_TVL,
    catalogTtlMs: 60_000,
    nowMs: () => Date.parse(AERODROME_FIXTURE_FETCHED_AT),
    listPools: async () => {
      reads += 1;
      return [volatilePool(), volatilePool({ lp: "0x8888888888888888888888888888888888888888", type: 50 })];
    },
    fetchPrices: async () => aerodromePrices
  });

  const first = await fetchAerodromeOpportunities();
  const second = await fetchAerodromeOpportunities();
  assert.equal(first.length, 1);
  assert.equal(first[0]?.assetPair, "WETH/USDC");
  assert.equal(second.length, 1);
  assert.equal(reads, 1);
});

test("an expired Aerodrome catalog stays available when the refresh fails", async () => {
  let now = Date.parse(AERODROME_FIXTURE_FETCHED_AT);
  let fail = false;
  let reads = 0;
  setAerodromeAdapterDependenciesForTests({
    minTvlUsd: MIN_TVL,
    catalogTtlMs: 1_000,
    nowMs: () => now,
    listPools: async () => {
      reads += 1;
      if (fail) {
        throw new Error("Base RPC returned non-2xx status: 429.");
      }
      return [volatilePool()];
    },
    fetchPrices: async () => aerodromePrices
  });

  const first = await fetchAerodromeOpportunities();
  fail = true;
  now += 1_000;
  const second = await fetchAerodromeOpportunities();
  await new Promise((resolve) => setImmediate(resolve));
  now += 1_000;
  const third = await fetchAerodromeOpportunities();

  assert.equal(first.length, 1);
  assert.equal(second[0]?.opportunityId, first[0]?.opportunityId);
  assert.equal(third[0]?.opportunityId, first[0]?.opportunityId);
  assert.equal(reads, 2);
});
