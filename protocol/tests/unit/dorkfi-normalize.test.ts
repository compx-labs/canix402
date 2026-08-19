import assert from "node:assert/strict";
import test from "node:test";

import { normalizeDorkFiOpportunity } from "../../src/adapters/index.js";
import { USDC_ASSET_ID } from "../../src/execution/shapes/haystack/constants.js";
import {
  FALLBACK_IDENTIFIERS_NOTE,
  SOURCE_TIMESTAMP_FETCH_PROXY_NOTE
} from "../../src/services/source-metadata.js";
import {
  DORKFI_FIXTURE_FETCHED_AT,
  DORKFI_NATIVE_NETWORK,
  dorkfiForeignLending,
  dorkfiLendAlias,
  dorkfiLiquidityAlias,
  dorkfiMissingApy,
  dorkfiMissingAppId,
  dorkfiStaking,
  dorkfiUnknownType,
  dorkfiUsdcLending
} from "../fixtures/adapters/dorkfi-feed.js";
import { assertValidMarketRecord } from "./helpers/assert-market-record.js";

test("normalizeDorkFiOpportunity maps recorded native-chain lending rows", () => {
  const record = normalizeDorkFiOpportunity(dorkfiUsdcLending, DORKFI_FIXTURE_FETCHED_AT);
  assertValidMarketRecord(record);
  assert.equal(record.protocol, "dorkfi");
  assert.equal(record.opportunityType, "lending");
  assert.equal(record.assetPair, "USDC");
  assert.equal(record.apy, 6.06);
  assert.equal(record.yieldBasis, "apy");
  assert.equal(record.tvlUsd, 29846.609471);
  assert.deepEqual(record.assetIds, [USDC_ASSET_ID]);
  assert.equal(
    record.opportunityId,
    `dorkfi:${DORKFI_NATIVE_NETWORK.toLowerCase()}:3333688282:${USDC_ASSET_ID}:lending`
  );
  assert.equal(record.sourceTimestamp, DORKFI_FIXTURE_FETCHED_AT);
  assert.match(record.notes ?? "", new RegExp(SOURCE_TIMESTAMP_FETCH_PROXY_NOTE));
});

test("normalizeDorkFiOpportunity filters non-native network rows", () => {
  assert.equal(
    normalizeDorkFiOpportunity(dorkfiForeignLending, DORKFI_FIXTURE_FETCHED_AT),
    null
  );
});

test("normalizeDorkFiOpportunity maps type aliases and staking rows", () => {
  const lend = normalizeDorkFiOpportunity(dorkfiLendAlias, DORKFI_FIXTURE_FETCHED_AT);
  assertValidMarketRecord(lend);
  assert.equal(lend.opportunityType, "lending");
  assert.equal(lend.assetPair, "ALGO");
  assert.deepEqual(lend.assetIds, [0]);

  const lp = normalizeDorkFiOpportunity(dorkfiLiquidityAlias, DORKFI_FIXTURE_FETCHED_AT);
  assertValidMarketRecord(lp);
  assert.equal(lp.opportunityType, "lp");
  assert.equal(lp.assetPair, "ALGO/USDC");

  const staking = normalizeDorkFiOpportunity(dorkfiStaking, DORKFI_FIXTURE_FETCHED_AT);
  assertValidMarketRecord(staking);
  assert.equal(staking.opportunityType, "staking");
  assert.equal(staking.assetPair, "TINY");
});

test("normalizeDorkFiOpportunity drops invalid APY, type, or incomplete rows", () => {
  assert.equal(normalizeDorkFiOpportunity(dorkfiMissingApy, DORKFI_FIXTURE_FETCHED_AT), null);
  assert.equal(normalizeDorkFiOpportunity(dorkfiUnknownType, DORKFI_FIXTURE_FETCHED_AT), null);
});

test("normalizeDorkFiOpportunity uses fallback identifiers when app id is missing", () => {
  const record = normalizeDorkFiOpportunity(dorkfiMissingAppId, DORKFI_FIXTURE_FETCHED_AT);
  assertValidMarketRecord(record);
  assert.equal(
    record.opportunityId,
    `dorkfi:${DORKFI_NATIVE_NETWORK.toLowerCase()}:unknown-app:${USDC_ASSET_ID}:lending`
  );
  assert.match(record.notes ?? "", new RegExp(FALLBACK_IDENTIFIERS_NOTE));
});
