import assert from "node:assert/strict";
import test from "node:test";

import {
  cacheMetaForResponse,
  summarizeCacheMeta
} from "../../src/services/aggregate-opportunities.js";
import {
  CANIX_CACHE_KEY_PREFIX,
  getOpportunitiesCacheTtlSec,
  isCacheEnvelope,
  isOpportunityCacheEnabled,
  opportunityCacheKey,
  resetRedisCacheForTests
} from "../../src/services/redis-cache.js";

test("opportunity cache keys use canix402 prefix and dedicated protocol path", () => {
  assert.equal(CANIX_CACHE_KEY_PREFIX, "canix402:");
  assert.equal(
    opportunityCacheKey("mainnet", "tinyman"),
    "canix402:opportunities:protocol:mainnet:tinyman"
  );
  assert.equal(
    opportunityCacheKey("mainnet", "reti"),
    "canix402:opportunities:protocol:mainnet:reti"
  );
});

test("opportunity cache is disabled without REDIS_URL", () => {
  resetRedisCacheForTests();
  assert.equal(isOpportunityCacheEnabled({}), false);
  assert.equal(isOpportunityCacheEnabled({ REDIS_URL: "" }), false);
  assert.equal(
    isOpportunityCacheEnabled({
      REDIS_URL: "redis://localhost:6379/6",
      OPPORTUNITIES_CACHE_DISABLED: "1"
    }),
    false
  );
  assert.equal(
    isOpportunityCacheEnabled({ REDIS_URL: "redis://localhost:6379/6" }),
    true
  );
});

test("opportunity cache TTL defaults to 180s and rejects invalid values", () => {
  assert.equal(getOpportunitiesCacheTtlSec({}), 180);
  assert.equal(getOpportunitiesCacheTtlSec({ OPPORTUNITIES_CACHE_TTL_SEC: "30" }), 30);
  assert.equal(getOpportunitiesCacheTtlSec({ OPPORTUNITIES_CACHE_TTL_SEC: "0" }), 180);
  assert.equal(getOpportunitiesCacheTtlSec({ OPPORTUNITIES_CACHE_TTL_SEC: "nope" }), 180);
});

test("cache envelope detection requires cachedAt + data", () => {
  assert.equal(isCacheEnvelope({ cachedAt: "2026-07-30T12:00:00.000Z", data: [] }), true);
  assert.equal(isCacheEnvelope([]), false);
  assert.equal(isCacheEnvelope({ data: [] }), false);
  assert.equal(isCacheEnvelope({ cachedAt: 1, data: [] }), false);
});

test("summarizeCacheMeta reports all-hit and oldest cachedAt", () => {
  const previous = process.env.REDIS_URL;
  const previousDisabled = process.env.OPPORTUNITIES_CACHE_DISABLED;
  process.env.REDIS_URL = "redis://localhost:6379/6";
  delete process.env.OPPORTUNITIES_CACHE_DISABLED;
  resetRedisCacheForTests();

  try {
    const summary = summarizeCacheMeta([
      {
        data: [],
        cacheHit: true,
        cachedAt: "2026-07-30T12:00:00.000Z"
      },
      {
        data: [],
        cacheHit: true,
        cachedAt: "2026-07-30T11:59:00.000Z"
      }
    ]);
    assert.equal(summary.cacheEnabled, true);
    assert.equal(summary.cacheHit, true);
    assert.equal(summary.cachedAt, "2026-07-30T11:59:00.000Z");
    assert.equal(summary.cacheTtlSec, getOpportunitiesCacheTtlSec());

    const mixed = summarizeCacheMeta([
      {
        data: [],
        cacheHit: true,
        cachedAt: "2026-07-30T12:00:00.000Z"
      },
      {
        data: [],
        cacheHit: false,
        cachedAt: "2026-07-30T12:00:30.000Z"
      }
    ]);
    assert.equal(mixed.cacheHit, false);
    assert.equal(mixed.cachedAt, "2026-07-30T12:00:00.000Z");

    const responseMeta = cacheMetaForResponse(summary);
    assert.equal(responseMeta.cacheHit, true);
    assert.equal(typeof responseMeta.cacheAgeMs, "number");
    assert.ok((responseMeta.cacheAgeMs as number) >= 0);
  } finally {
    if (previous === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = previous;
    }
    if (previousDisabled === undefined) {
      delete process.env.OPPORTUNITIES_CACHE_DISABLED;
    } else {
      process.env.OPPORTUNITIES_CACHE_DISABLED = previousDisabled;
    }
    resetRedisCacheForTests();
  }
});
