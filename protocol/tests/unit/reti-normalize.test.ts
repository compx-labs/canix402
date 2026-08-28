import assert from "node:assert/strict";
import test from "node:test";

import type { Algodv2 } from "algosdk";

import {
  RetiAdapterError,
  buildCapacity,
  buildEntryRequirements,
  fetchRetiOpportunities,
  isRetiStakingOpportunityId,
  normalizeRetiStakingOpportunity,
  parseRetiValidatorId,
  retiStakingOpportunityId,
  setRetiAdapterDependenciesForTests
} from "../../src/adapters/index.js";
import {
  RETI_GATING_TYPE_ASSET_ID,
  RETI_GATING_TYPE_ASSETS_CREATED_BY,
  RETI_GATING_TYPE_CREATED_BY_NFD_ADDRESSES,
  RETI_GATING_TYPE_SEGMENT_OF_NFD,
  RETI_MAX_STAKERS_PER_POOL,
  RETI_PERCENT_TO_VALIDATOR_SCALE
} from "../../src/reti/constants.js";
import { USDC_ASSET_ID } from "../../src/execution/shapes/haystack/constants.js";
import { SOURCE_TIMESTAMP_FETCH_PROXY_NOTE } from "../../src/services/source-metadata.js";
import {
  RETI_ALGO_USD_PRICE,
  RETI_CREATOR_ADDRESS,
  RETI_FIXTURE_FETCHED_AT,
  retiConsensusEstimate,
  retiPool,
  retiValidatorConfig,
  retiValidatorSnapshot,
  retiValidatorState
} from "../fixtures/adapters/reti.js";
import { assertValidMarketRecord } from "./helpers/assert-market-record.js";

const dummyAlgod = {} as Algodv2;

test.afterEach(() => {
  setRetiAdapterDependenciesForTests();
});

test("normalizeRetiStakingOpportunity nets commission from consensus APR", () => {
  const record = normalizeRetiStakingOpportunity({
    snapshot: retiValidatorSnapshot(),
    consensusApr: 10,
    sampleSize: 32,
    algoUsdPrice: RETI_ALGO_USD_PRICE,
    fetchedAtIso: RETI_FIXTURE_FETCHED_AT
  });
  assertValidMarketRecord(record);
  assert.equal(record.protocol, "reti");
  assert.equal(record.opportunityType, "staking");
  assert.equal(record.opportunityId, retiStakingOpportunityId(7));
  assert.equal(record.assetPair, "ALGO");
  assert.deepEqual(record.assetIds, [0]);
  assert.equal(record.yieldBasis, "apr");
  assert.equal(record.apy, 9);
  assert.equal(record.apr, 9);
  assert.equal(record.tvlUsd, 400);
  assert.equal(record.entryRequirements?.minAmount?.amount, "1000000000");
  assert.equal(record.entryRequirements?.eligibilityFullyCheckable, true);
  assert.equal(record.capacity?.acceptingStake, true);
  assert.equal(record.fetchedAt, RETI_FIXTURE_FETCHED_AT);
  assert.equal(record.sourceTimestamp, RETI_FIXTURE_FETCHED_AT);
  assert.match(record.notes ?? "", new RegExp(SOURCE_TIMESTAMP_FETCH_PROXY_NOTE));
  assert.match(record.notes ?? "", /1000 bps validator commission/);
});

test("normalizeRetiStakingOpportunity drops invalid APR, empty validators, or 100% commission", () => {
  const base = {
    snapshot: retiValidatorSnapshot(),
    consensusApr: 10,
    sampleSize: 32,
    algoUsdPrice: RETI_ALGO_USD_PRICE,
    fetchedAtIso: RETI_FIXTURE_FETCHED_AT
  };
  assert.equal(
    normalizeRetiStakingOpportunity({ ...base, consensusApr: Number.NaN }),
    null
  );
  assert.equal(
    normalizeRetiStakingOpportunity({
      ...base,
      snapshot: retiValidatorSnapshot({
        state: retiValidatorState({ totalAlgoStaked: 0n, numPools: 0 }),
        pools: []
      })
    }),
    null
  );
  assert.equal(
    normalizeRetiStakingOpportunity({
      ...base,
      snapshot: retiValidatorSnapshot({
        config: retiValidatorConfig({
          percentToValidator: RETI_PERCENT_TO_VALIDATOR_SCALE
        })
      })
    }),
    null
  );
});

test("buildEntryRequirements publishes min stake and ASA gates", () => {
  const requirements = buildEntryRequirements(
    retiValidatorConfig({
      entryGatingType: RETI_GATING_TYPE_ASSET_ID,
      entryGatingAssets: [BigInt(USDC_ASSET_ID), 0n, 0n, 0n],
      gatingAssetMinBalance: 1n
    })
  );
  assert.equal(requirements.minAmount?.amount, "1000000000");
  assert.equal(requirements.gateMatch, "any");
  assert.equal(requirements.eligibilityFullyCheckable, true);
  assert.deepEqual(requirements.gates, [
    { kind: "asa", assetId: USDC_ASSET_ID, minBalance: "1" }
  ]);
});

test("buildEntryRequirements marks creator and NFD gates as not fully checkable", () => {
  const creator = buildEntryRequirements(
    retiValidatorConfig({
      entryGatingType: RETI_GATING_TYPE_ASSETS_CREATED_BY,
      entryGatingAddress: RETI_CREATOR_ADDRESS,
      gatingAssetMinBalance: 10n
    })
  );
  assert.equal(creator.eligibilityFullyCheckable, false);
  assert.deepEqual(creator.gates, [
    { kind: "asa-creator", creator: RETI_CREATOR_ADDRESS, minBalance: "10" }
  ]);

  const nfdLinked = buildEntryRequirements(
    retiValidatorConfig({
      entryGatingType: RETI_GATING_TYPE_CREATED_BY_NFD_ADDRESSES,
      entryGatingAssets: [123456n, 0n, 0n, 0n]
    })
  );
  assert.equal(nfdLinked.eligibilityFullyCheckable, false);
  assert.deepEqual(nfdLinked.gates, [{ kind: "nfd-linked-creators", nfd: "123456" }]);

  const nfdRoot = buildEntryRequirements(
    retiValidatorConfig({
      entryGatingType: RETI_GATING_TYPE_SEGMENT_OF_NFD,
      entryGatingAssets: [99n, 0n, 0n, 0n]
    })
  );
  assert.equal(nfdRoot.eligibilityFullyCheckable, false);
  assert.deepEqual(nfdRoot.gates, [{ kind: "nfd-root-segment", nfdRoot: "99" }]);
});

test("buildCapacity rolls up slots and ALGO room and closes sunset validators", () => {
  const open = buildCapacity({
    pools: [
      retiPool({ poolAppId: 10n, totalStakers: 190, totalAlgoStaked: 9_000_000n }),
      retiPool({ poolAppId: 11n, totalStakers: 200, totalAlgoStaked: 5_000_000n }),
      retiPool({ poolAppId: 0n, totalStakers: 0, totalAlgoStaked: 0n })
    ],
    maxStakePerPool: 10_000_000n,
    sunsettingOn: 0n,
    currentRound: 100n,
    numPools: 2
  });
  assert.equal(open.stakerSlotsRemaining, RETI_MAX_STAKERS_PER_POOL - 190);
  assert.equal(open.algoRoomMicroAlgos, "6000000");
  assert.equal(open.acceptingStake, true);

  const sunset = buildCapacity({
    pools: [retiPool({ totalStakers: 1, totalAlgoStaked: 1_000_000n })],
    maxStakePerPool: 10_000_000n,
    sunsettingOn: 50n,
    currentRound: 50n,
    numPools: 1
  });
  assert.equal(sunset.acceptingStake, false);
});

test("parseRetiValidatorId accepts prefixed validator ids", () => {
  assert.equal(parseRetiValidatorId(retiStakingOpportunityId(12)), 12);
  assert.equal(isRetiStakingOpportunityId("reti-staking-1"), true);
  assert.equal(parseRetiValidatorId("reti-staking-0"), null);
  assert.equal(isRetiStakingOpportunityId("myth-staking-1"), false);
});

test("fetchRetiOpportunities maps mocked validator snapshots into staking rows", async () => {
  setRetiAdapterDependenciesForTests({
    createAlgodClient: () => dummyAlgod,
    estimateConsensusApr: async () => retiConsensusEstimate(),
    fetchAlgoUsdPrice: async () => RETI_ALGO_USD_PRICE,
    getNumValidators: async () => 2,
    getValidatorSnapshot: async (_algod, validatorId) => {
      if (validatorId === 1) {
        throw new Error("validator 1 unavailable");
      }
      return retiValidatorSnapshot({ validatorId });
    }
  });

  const records = await fetchRetiOpportunities(async () => new Response("{}"));
  assert.equal(records.length, 1);
  assertValidMarketRecord(records[0] ?? null);
  assert.equal(records[0]?.opportunityId, "reti-staking-2");
  assert.equal(records[0]?.apy, 9);
});

test("fetchRetiOpportunities returns an empty list when the registry reports no validators", async () => {
  setRetiAdapterDependenciesForTests({
    createAlgodClient: () => dummyAlgod,
    estimateConsensusApr: async () => retiConsensusEstimate(),
    fetchAlgoUsdPrice: async () => RETI_ALGO_USD_PRICE,
    getNumValidators: async () => 0,
    getValidatorSnapshot: async () => retiValidatorSnapshot()
  });

  const records = await fetchRetiOpportunities(async () => new Response("{}"));
  assert.deepEqual(records, []);
});

test("fetchRetiOpportunities throws when ALGO USD price is missing", async () => {
  setRetiAdapterDependenciesForTests({
    createAlgodClient: () => dummyAlgod,
    estimateConsensusApr: async () => retiConsensusEstimate(),
    fetchAlgoUsdPrice: async () => null,
    getNumValidators: async () => 1,
    getValidatorSnapshot: async () => retiValidatorSnapshot()
  });

  await assert.rejects(
    () => fetchRetiOpportunities(async () => new Response("{}")),
    (error: unknown) => {
      assert.ok(error instanceof RetiAdapterError);
      assert.match(error.message, /ALGO USD price/);
      return true;
    }
  );
});
