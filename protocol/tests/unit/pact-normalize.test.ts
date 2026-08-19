import assert from "node:assert/strict";
import test from "node:test";

import { normalizePactFarm, normalizePactPool } from "../../src/adapters/index.js";
import { USDC_ASSET_ID } from "../../src/execution/shapes/haystack/constants.js";
import { SOURCE_TIMESTAMP_FETCH_PROXY_NOTE } from "../../src/services/source-metadata.js";
import {
  PACT_FIXTURE_FETCHED_AT,
  pactAlgoUsdcLp,
  pactApr7dOnly,
  pactAverageAprOnlyFarm,
  pactFarmTvlFallback,
  pactJoinedFarm,
  pactMissingApy,
  pactMissingIdentifiers,
  pactMissingTvl,
  pactNoIncentivesFarm
} from "../fixtures/adapters/pact-pools.js";
import { assertValidMarketRecord } from "./helpers/assert-market-record.js";

test("normalizePactPool maps recorded 7d APR fractions into percentage points", () => {
  const record = normalizePactPool(pactAlgoUsdcLp, PACT_FIXTURE_FETCHED_AT);
  assertValidMarketRecord(record);
  assert.equal(record.protocol, "pact");
  assert.equal(record.opportunityType, "lp");
  assert.equal(record.opportunityId, "1072843805:lp");
  assert.equal(record.apy, 8.75);
  assert.equal(record.yieldBasis, "apr");
  assert.equal(record.tvlUsd, 950000);
  assert.equal(record.apr, 6.2);
  assert.equal(record.assetPair, "ALGO/USDC");
  assert.deepEqual(record.assetIds, [0, USDC_ASSET_ID]);
  assert.equal(record.sourceTimestamp, PACT_FIXTURE_FETCHED_AT);
  assert.match(record.notes ?? "", new RegExp(SOURCE_TIMESTAMP_FETCH_PROXY_NOTE));
});

test("normalizePactPool falls back to apr_7d and numeric pool id", () => {
  const record = normalizePactPool(pactApr7dOnly, PACT_FIXTURE_FETCHED_AT);
  assertValidMarketRecord(record);
  assert.equal(record.opportunityId, "999:lp");
  assert.equal(record.apy, 5);
  assert.equal(record.apr, 5);
});

test("normalizePactPool drops invalid APY or TVL rows", () => {
  assert.equal(normalizePactPool(pactMissingApy), null);
  assert.equal(normalizePactPool(pactMissingTvl), null);
});

test("normalizePactPool uses fallback identifiers when ids and pair are missing", () => {
  const record = normalizePactPool(pactMissingIdentifiers, PACT_FIXTURE_FETCHED_AT);
  assertValidMarketRecord(record);
  assert.equal(record.opportunityId, "pact-unknown:lp");
  assert.equal(record.assetPair, "unknown/unknown");
  assert.match(record.notes ?? "", /fallback identifiers/);
});

test("normalizePactFarm joins farm on_chain_id to the pool app and keeps poolAppId", () => {
  const record = normalizePactFarm(pactAlgoUsdcLp, pactJoinedFarm, PACT_FIXTURE_FETCHED_AT);
  assertValidMarketRecord(record);
  assert.equal(record.protocol, "pact");
  assert.equal(record.opportunityType, "farm");
  assert.equal(record.opportunityId, "3625283323:farm");
  assert.equal(record.poolAppId, 1072843805);
  assert.notEqual(record.poolAppId, Number(record.opportunityId.split(":")[0]));
  assert.equal(record.yieldBasis, "apr");
  assert.ok(Math.abs(record.apy - 14) < Number.EPSILON * 10);
  assert.equal(record.apr, 12);
  assert.equal(record.tvlUsd, 950000);
  assert.equal(record.assetPair, "ALGO/USDC");
  assert.deepEqual(record.assetIds, [0, USDC_ASSET_ID]);
});

test("normalizePactFarm emits when only average_apr indicates incentives", () => {
  const record = normalizePactFarm(pactAlgoUsdcLp, pactAverageAprOnlyFarm, PACT_FIXTURE_FETCHED_AT);
  assertValidMarketRecord(record);
  assert.equal(record.apy, 8);
  assert.equal(record.apr, 0);
});

test("normalizePactFarm drops farms without incentive APR", () => {
  assert.equal(
    normalizePactFarm(pactAlgoUsdcLp, pactNoIncentivesFarm, PACT_FIXTURE_FETCHED_AT),
    null
  );
});

test("normalizePactFarm falls back to farm TVL when the pool TVL is missing", () => {
  const record = normalizePactFarm(
    { on_chain_id: 888 },
    pactFarmTvlFallback,
    PACT_FIXTURE_FETCHED_AT
  );
  assertValidMarketRecord(record);
  assert.equal(record.tvlUsd, 42000);
  assert.equal(record.poolAppId, 888);
});
