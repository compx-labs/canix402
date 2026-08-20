import assert from "node:assert/strict";
import test from "node:test";

import type { Algodv2 } from "algosdk";

import {
  MythFinanceAdapterError,
  fetchMythFinanceOpportunities,
  isMythFarmOpportunityId,
  isMythStakingOpportunityId,
  mythFarmOpportunityId,
  mythStakingOpportunityId,
  normalizeMythFarmOpportunity,
  normalizeMythStakingOpportunity,
  parseMythFarmAppId,
  parseMythStakingAppId,
  setMythFinanceSdkDependenciesForTests
} from "../../src/adapters/index.js";
import { CONSENSUS_PAYOUT_FEE_PERCENT } from "../../src/services/consensus-staking-apr.js";
import { SOURCE_TIMESTAMP_FETCH_PROXY_NOTE } from "../../src/services/source-metadata.js";
import {
  MYTH_ALGO_USD_PRICE,
  MYTH_APP_ID,
  MYTH_ASA_ID,
  MYTH_FIXTURE_FETCHED_AT,
  MYTH_LST_ID,
  mythActiveFarm,
  mythConsensusEstimate,
  mythListingSnapshot
} from "../fixtures/adapters/myth-finance.js";
import { assertValidMarketRecord } from "./helpers/assert-market-record.js";

const dummyAlgod = {} as Algodv2;

test.afterEach(() => {
  setMythFinanceSdkDependenciesForTests();
});

test("normalizeMythStakingOpportunity nets consensus APR by fees and adds farm APR", () => {
  const record = normalizeMythStakingOpportunity({
    snapshot: mythListingSnapshot(),
    consensusApr: 5,
    sampleSize: 100,
    algoUsdPrice: MYTH_ALGO_USD_PRICE,
    farm: mythActiveFarm(),
    fetchedAtIso: MYTH_FIXTURE_FETCHED_AT
  });
  assertValidMarketRecord(record);
  assert.equal(record.protocol, "myth-finance");
  assert.equal(record.opportunityType, "staking");
  assert.equal(record.opportunityId, mythStakingOpportunityId(MYTH_APP_ID));
  assert.equal(record.assetPair, "ALGO/MemO→memoALGO");
  assert.deepEqual(record.assetIds, [0, Number(MYTH_ASA_ID), Number(MYTH_LST_ID)]);
  assert.equal(record.yieldBasis, "apy");
  assert.equal(record.apr, 5);
  // 5 * (1 - 0.04) + 5.82 = 10.62
  assert.ok(Math.abs(record.apy - 10.62) < 1e-9);
  assert.ok(Math.abs(record.tvlUsd - 6223) < 1e-6);
  assert.equal(record.fetchedAt, MYTH_FIXTURE_FETCHED_AT);
  assert.equal(record.sourceTimestamp, MYTH_FIXTURE_FETCHED_AT);
  assert.match(record.notes ?? "", new RegExp(SOURCE_TIMESTAMP_FETCH_PROXY_NOTE));
  assert.match(record.notes ?? "", new RegExp(`${CONSENSUS_PAYOUT_FEE_PERCENT}%`));
  assert.match(record.notes ?? "", /Includes active farm incentive 5\.82% APR/);
  assert.match(record.notes ?? "", /Contract is online for consensus/);
});

test("normalizeMythStakingOpportunity uses fallback names when listing labels are missing", () => {
  const record = normalizeMythStakingOpportunity({
    snapshot: mythListingSnapshot({
      listing: { asaUnitName: "", asaName: "", lstName: "" }
    }),
    consensusApr: 5,
    sampleSize: 10,
    algoUsdPrice: MYTH_ALGO_USD_PRICE,
    fetchedAtIso: MYTH_FIXTURE_FETCHED_AT
  });
  assertValidMarketRecord(record);
  assert.equal(record.assetPair, `ALGO/ASA-${MYTH_ASA_ID}→dS-${MYTH_LST_ID}`);
  assert.match(record.notes ?? "", /No active farm incentive/);
});

test("normalizeMythStakingOpportunity drops invalid APR, stake, fees, or identifiers", () => {
  const base = {
    snapshot: mythListingSnapshot(),
    consensusApr: 5,
    sampleSize: 10,
    algoUsdPrice: MYTH_ALGO_USD_PRICE,
    fetchedAtIso: MYTH_FIXTURE_FETCHED_AT
  };
  assert.equal(
    normalizeMythStakingOpportunity({ ...base, consensusApr: Number.NaN }),
    null
  );
  assert.equal(
    normalizeMythStakingOpportunity({
      ...base,
      snapshot: mythListingSnapshot({ listing: { staked: 0n } })
    }),
    null
  );
  assert.equal(
    normalizeMythStakingOpportunity({
      ...base,
      snapshot: mythListingSnapshot({ platformFeeBps: 6_000, noderunnerFeeBps: 4_000 })
    }),
    null
  );
  assert.equal(
    normalizeMythStakingOpportunity({
      ...base,
      snapshot: mythListingSnapshot({ listing: { lstId: 0n } })
    }),
    null
  );
});

test("normalizeMythFarmOpportunity emits passive farm rows only when active", () => {
  const active = normalizeMythFarmOpportunity({
    snapshot: mythListingSnapshot(),
    farm: mythActiveFarm(),
    algoUsdPrice: MYTH_ALGO_USD_PRICE,
    fetchedAtIso: MYTH_FIXTURE_FETCHED_AT
  });
  assertValidMarketRecord(active);
  assert.equal(active.protocol, "myth-finance");
  assert.equal(active.opportunityType, "farm");
  assert.equal(active.opportunityId, mythFarmOpportunityId(MYTH_APP_ID));
  assert.equal(active.assetPair, "memoALGO farm (MemO)");
  assert.deepEqual(active.assetIds, [0, Number(MYTH_ASA_ID), Number(MYTH_LST_ID)]);
  assert.equal(active.yieldBasis, "apr");
  assert.equal(active.apr, 5.82);
  assert.ok(Math.abs(active.apy - 5.82) < 1e-9);
  assert.match(active.notes ?? "", /About 1\.0 hours remaining/);

  assert.equal(
    normalizeMythFarmOpportunity({
      snapshot: mythListingSnapshot(),
      farm: mythActiveFarm({ remainingDurationSec: 0n }),
      algoUsdPrice: MYTH_ALGO_USD_PRICE,
      fetchedAtIso: MYTH_FIXTURE_FETCHED_AT
    }),
    null
  );
  assert.equal(
    normalizeMythFarmOpportunity({
      snapshot: mythListingSnapshot(),
      farm: mythActiveFarm({ farmAprBps: 0n }),
      algoUsdPrice: MYTH_ALGO_USD_PRICE,
      fetchedAtIso: MYTH_FIXTURE_FETCHED_AT
    }),
    null
  );
  assert.equal(
    normalizeMythFarmOpportunity({
      snapshot: mythListingSnapshot(),
      algoUsdPrice: MYTH_ALGO_USD_PRICE,
      fetchedAtIso: MYTH_FIXTURE_FETCHED_AT
    }),
    null
  );
});

test("parseMythStakingAppId and parseMythFarmAppId reject invalid prefixes", () => {
  assert.equal(parseMythStakingAppId(mythStakingOpportunityId(MYTH_APP_ID)), Number(MYTH_APP_ID));
  assert.equal(parseMythFarmAppId(mythFarmOpportunityId(MYTH_APP_ID)), Number(MYTH_APP_ID));
  assert.equal(isMythStakingOpportunityId("myth-staking-0"), false);
  assert.equal(isMythFarmOpportunityId("myth-farm-abc"), false);
  assert.equal(parseMythStakingAppId("tinyman-unknown:lp"), null);
});

test("fetchMythFinanceOpportunities maps mocked SDK listings into staking and farm rows", async () => {
  const appId = MYTH_APP_ID;
  setMythFinanceSdkDependenciesForTests({
    createAlgodClient: () => dummyAlgod,
    createAlgorandClient: () => ({}) as never, // pragma: allowlist secret
    estimateConsensusApr: async () => mythConsensusEstimate(),
    fetchAlgoUsdPrice: async () => MYTH_ALGO_USD_PRICE,
    getAvailableContractIds: async () => [appId],
    getListingAndFees: async () => mythListingSnapshot(),
    getFarmsAndApr: async () => new Map([[appId, mythActiveFarm()]])
  });

  const records = await fetchMythFinanceOpportunities(async () => new Response("{}"));
  assert.equal(records.length, 2);
  assertValidMarketRecord(records[0] ?? null);
  assertValidMarketRecord(records[1] ?? null);
  assert.equal(records[0]?.opportunityType, "staking");
  assert.equal(records[1]?.opportunityType, "farm");
  assert.ok(Math.abs((records[0]?.apy ?? 0) - 10.62) < 1e-9);
});

test("fetchMythFinanceOpportunities skips failed listings and continues without farms", async () => {
  setMythFinanceSdkDependenciesForTests({
    createAlgodClient: () => dummyAlgod,
    createAlgorandClient: () => ({}) as never, // pragma: allowlist secret
    estimateConsensusApr: async () => mythConsensusEstimate(),
    fetchAlgoUsdPrice: async () => MYTH_ALGO_USD_PRICE,
    getAvailableContractIds: async () => [1n, MYTH_APP_ID],
    getListingAndFees: async (_config, appId) => {
      if (appId === 1n) {
        throw new Error("listing unavailable");
      }
      return mythListingSnapshot();
    },
    getFarmsAndApr: async () => {
      throw new Error("farm sdk unavailable");
    }
  });

  const records = await fetchMythFinanceOpportunities(async () => new Response("{}"));
  assert.equal(records.length, 1);
  assertValidMarketRecord(records[0] ?? null);
  assert.equal(records[0]?.opportunityType, "staking");
  assert.ok(Math.abs((records[0]?.apy ?? 0) - 4.8) < 1e-9);
});

test("fetchMythFinanceOpportunities throws when ALGO USD price is missing", async () => {
  setMythFinanceSdkDependenciesForTests({
    createAlgodClient: () => dummyAlgod,
    createAlgorandClient: () => ({}) as never, // pragma: allowlist secret
    estimateConsensusApr: async () => mythConsensusEstimate(),
    fetchAlgoUsdPrice: async () => null,
    getAvailableContractIds: async () => [MYTH_APP_ID],
    getListingAndFees: async () => mythListingSnapshot(),
    getFarmsAndApr: async () => new Map()
  });

  await assert.rejects(
    () => fetchMythFinanceOpportunities(async () => new Response("{}")),
    (error: unknown) => {
      assert.ok(error instanceof MythFinanceAdapterError);
      assert.match(error.message, /ALGO USD price/);
      return true;
    }
  );
});
