import assert from "node:assert/strict";
import test from "node:test";

import {
  CANIX_CACHE_KEY_PREFIX,
  getOpportunitiesCacheTtlSec,
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

test("opportunity cache TTL falls back to default and rejects invalid values", () => {
  assert.equal(getOpportunitiesCacheTtlSec({}), 45);
  assert.equal(getOpportunitiesCacheTtlSec({ OPPORTUNITIES_CACHE_TTL_SEC: "30" }), 30);
  assert.equal(getOpportunitiesCacheTtlSec({ OPPORTUNITIES_CACHE_TTL_SEC: "0" }), 45);
  assert.equal(getOpportunitiesCacheTtlSec({ OPPORTUNITIES_CACHE_TTL_SEC: "nope" }), 45);
});
