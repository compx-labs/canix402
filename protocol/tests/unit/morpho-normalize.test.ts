import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchMorphoOpportunities,
  morphoVaultOpportunityId,
  normalizeMorphoVault,
  setMorphoAdapterDependenciesForTests
} from "../../src/adapters/index.js";
import {
  MORPHO_FIXTURE_FETCHED_AT,
  morphoMoonwellEurc,
  morphoNativeEthVault,
  morphoUnlistedVault,
  morphoWrongChainVault,
  morphoYearnUsdc,
  morphoZeroTvlVault
} from "../fixtures/adapters/morpho-vaults.js";
import { assertValidMarketRecord } from "./helpers/assert-market-record.js";

test.afterEach(() => {
  setMorphoAdapterDependenciesForTests(undefined);
});

test("normalizeMorphoVault maps recorded listed Base vaults", () => {
  const record = normalizeMorphoVault(morphoYearnUsdc, MORPHO_FIXTURE_FETCHED_AT);
  assertValidMarketRecord(record);
  assert.equal(record.protocol, "morpho");
  assert.equal(record.chain, "base");
  assert.equal(record.opportunityType, "lending");
  assert.equal(record.assetPair, "USDC");
  assert.equal(record.yieldBasis, "apy");
  assert.equal(record.apy, 0.046648028284430536 * 100);
  assert.equal(record.apr, 0.05196364919627212 * 100);
  assert.equal(record.tvlUsd, 2003777.3610978741);
  assert.deepEqual(record.assetAddresses, [
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
  ]);
  assert.equal(record.assetIds, undefined);
  assert.equal(
    record.opportunityId,
    morphoVaultOpportunityId("0xef417a2512C5a41f69AE4e021648b69a7CdE5D03")
  );
  assert.equal(record.poolId, "0xef417a2512c5a41f69ae4e021648b69a7cde5d03");
  assert.match(record.notes ?? "", /Yearn OG USDC/);
  assert.match(record.notes ?? "", /curator fee 10%/);
});

test("normalizeMorphoVault maps EURC vault netApy and 15% fee", () => {
  const record = normalizeMorphoVault(morphoMoonwellEurc, MORPHO_FIXTURE_FETCHED_AT);
  assertValidMarketRecord(record);
  assert.equal(record.assetPair, "EURC");
  assert.equal(record.apy, 0.017867453056898217 * 100);
  assert.match(record.notes ?? "", /curator fee 15%/);
});

test("normalizeMorphoVault drops unlisted, zero TVL, native ETH, and non-Base rows", () => {
  assert.equal(normalizeMorphoVault(morphoUnlistedVault, MORPHO_FIXTURE_FETCHED_AT), null);
  assert.equal(normalizeMorphoVault(morphoZeroTvlVault, MORPHO_FIXTURE_FETCHED_AT), null);
  assert.equal(normalizeMorphoVault(morphoNativeEthVault, MORPHO_FIXTURE_FETCHED_AT), null);
  assert.equal(normalizeMorphoVault(morphoWrongChainVault, MORPHO_FIXTURE_FETCHED_AT), null);
});

test("fetchMorphoOpportunities uses recorded GraphQL pages and skips live RPC", async () => {
  setMorphoAdapterDependenciesForTests({
    graphqlUrl: "https://api.morpho.org/graphql",
    onlyListed: true,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          data: {
            vaults: {
              items: [morphoYearnUsdc, morphoUnlistedVault, morphoZeroTvlVault]
            }
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
  });

  const rows = await fetchMorphoOpportunities();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.protocol, "morpho");
  assert.equal(rows[0]?.chain, "base");
  assert.equal(rows[0]?.assetPair, "USDC");
});

test("fetchMorphoOpportunities skips the live GraphQL catalog in test runtimes without an override", async () => {
  const previousFlag = process.env.CANIX402_OFFLINE_CATALOG;
  const previousUrl = process.env.MORPHO_GRAPHQL_URL;
  process.env.CANIX402_OFFLINE_CATALOG = "1";
  delete process.env.MORPHO_GRAPHQL_URL;
  try {
    await assert.rejects(
      () => fetchMorphoOpportunities(),
      (error: unknown) => {
        assert.equal((error as Error).name, "MorphoAdapterError");
        assert.match(
          (error as Error).message,
          /live Morpho catalog is disabled in CI\/tests/
        );
        return true;
      }
    );
  } finally {
    if (previousFlag === undefined) {
      delete process.env.CANIX402_OFFLINE_CATALOG;
    } else {
      process.env.CANIX402_OFFLINE_CATALOG = previousFlag;
    }
    if (previousUrl === undefined) {
      delete process.env.MORPHO_GRAPHQL_URL;
    } else {
      process.env.MORPHO_GRAPHQL_URL = previousUrl;
    }
  }
});

test("fetchMorphoOpportunities wraps GraphQL failures as MorphoAdapterError", async () => {
  setMorphoAdapterDependenciesForTests({
    fetchImpl: async () => {
      throw new Error("network down");
    }
  });
  await assert.rejects(
    () => fetchMorphoOpportunities(),
    (error: unknown) => {
      assert.equal((error as Error).name, "MorphoAdapterError");
      return true;
    }
  );
});
