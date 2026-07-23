import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCapacity,
  buildEntryRequirements,
  normalizeRetiStakingOpportunity,
  type RetiValidatorSnapshot
} from "../../src/adapters/reti.js";
import type { RetiValidatorConfig } from "../../src/reti/abi.js";
import {
  RETI_GATING_TYPE_ASSET_ID,
  RETI_GATING_TYPE_CREATED_BY_NFD_ADDRESSES,
  RETI_GATING_TYPE_NONE,
  RETI_ZERO_ADDRESS
} from "../../src/reti/constants.js";
import {
  matchesPersonalizedOpportunity
} from "../../src/services/personalized-opportunities.js";
import type { OpportunityMarketRecord } from "../../src/types/opportunity.js";

function baseConfig(
  overrides: Partial<RetiValidatorConfig> = {}
): RetiValidatorConfig {
  return {
    id: 1n,
    owner: RETI_ZERO_ADDRESS,
    manager: RETI_ZERO_ADDRESS,
    nfdForInfo: 0n,
    entryGatingType: RETI_GATING_TYPE_NONE,
    entryGatingAddress: RETI_ZERO_ADDRESS,
    entryGatingAssets: [0n, 0n, 0n, 0n],
    gatingAssetMinBalance: 0n,
    rewardTokenId: 0n,
    rewardPerPayout: 0n,
    epochRoundLength: 1000,
    percentToValidator: 50_000, // 5%
    validatorCommissionAddress: RETI_ZERO_ADDRESS,
    minEntryStake: 1_000_000_000n, // 1000 ALGO
    maxAlgoPerPool: 70_000_000_000_000n,
    poolsPerNode: 3,
    sunsettingOn: 0n,
    sunsettingTo: 0n,
    ...overrides
  };
}

test("buildEntryRequirements publishes min stake and ASA gates", () => {
  const requirements = buildEntryRequirements(
    baseConfig({
      entryGatingType: RETI_GATING_TYPE_ASSET_ID,
      entryGatingAssets: [31566704n, 0n, 0n, 0n],
      gatingAssetMinBalance: 1n
    })
  );
  assert.equal(requirements.minAmount?.amount, "1000000000");
  assert.equal(requirements.gateMatch, "any");
  assert.equal(requirements.eligibilityFullyCheckable, true);
  assert.deepEqual(requirements.gates, [
    { kind: "asa", assetId: 31566704, minBalance: "1" }
  ]);
});

test("buildEntryRequirements marks NFD gates as not fully checkable", () => {
  const requirements = buildEntryRequirements(
    baseConfig({
      entryGatingType: RETI_GATING_TYPE_CREATED_BY_NFD_ADDRESSES,
      entryGatingAssets: [123456n, 0n, 0n, 0n]
    })
  );
  assert.equal(requirements.eligibilityFullyCheckable, false);
  assert.deepEqual(requirements.gates, [
    { kind: "nfd-linked-creators", nfd: "123456" }
  ]);
});

test("buildCapacity rolls up slots and ALGO room", () => {
  const capacity = buildCapacity({
    pools: [
      { poolAppId: 10n, totalStakers: 190, totalAlgoStaked: 9_000_000n },
      { poolAppId: 11n, totalStakers: 200, totalAlgoStaked: 5_000_000n }
    ],
    maxStakePerPool: 10_000_000n,
    sunsettingOn: 0n,
    currentRound: 100n,
    numPools: 2
  });
  assert.equal(capacity.stakerSlotsRemaining, 10);
  assert.equal(capacity.algoRoomMicroAlgos, "6000000");
  assert.equal(capacity.acceptingStake, true);
});

test("normalizeRetiStakingOpportunity nets commission from consensus APR", () => {
  const snapshot: RetiValidatorSnapshot = {
    validatorId: 7,
    config: baseConfig({ percentToValidator: 100_000 }), // 10%
    state: {
      numPools: 1,
      totalStakers: 5n,
      totalAlgoStaked: 2_000_000_000n,
      rewardTokenHeldBack: 0n
    },
    pools: [{ poolAppId: 99n, totalStakers: 5, totalAlgoStaked: 2_000_000_000n }],
    maxStakePerPool: 70_000_000_000_000n,
    currentRound: 1n
  };

  const opportunity = normalizeRetiStakingOpportunity({
    snapshot,
    consensusApr: 10,
    sampleSize: 32,
    algoUsdPrice: 0.2,
    fetchedAtIso: "2026-07-23T00:00:00.000Z"
  });

  assert.ok(opportunity);
  assert.equal(opportunity!.opportunityId, "reti-staking-7");
  assert.equal(opportunity!.protocol, "reti");
  assert.equal(opportunity!.apy, 9); // 10% * (1 - 0.1)
  assert.equal(opportunity!.tvlUsd, 400); // 2000 ALGO * 0.2
  assert.equal(opportunity!.entryRequirements?.minAmount?.amount, "1000000000");
});

test("personalized matching enforces minAmount and ASA gates", () => {
  const opportunity: OpportunityMarketRecord = {
    protocol: "reti",
    opportunityType: "staking",
    opportunityId: "reti-staking-1",
    assetPair: "ALGO",
    assetIds: [0],
    apy: 8,
    yieldBasis: "apr",
    tvlUsd: 1000,
    sourceTimestamp: "2026-07-23T00:00:00.000Z",
    fetchedAt: "2026-07-23T00:00:00.000Z",
    entryRequirements: {
      minAmount: { assetId: 0, amount: "1000000" },
      gates: [{ kind: "asa", assetId: 31566704, minBalance: "1" }],
      gateMatch: "any",
      eligibilityFullyCheckable: true
    },
    capacity: {
      stakerSlotsRemaining: 10,
      algoRoomMicroAlgos: "1000000",
      acceptingStake: true
    }
  };

  assert.equal(
    matchesPersonalizedOpportunity(opportunity, {
      heldAssetIds: new Set([0, 31566704]),
      balances: new Map([
        [0, 500_000n],
        [31566704, 1n]
      ])
    }),
    false,
    "below min ALGO"
  );

  assert.equal(
    matchesPersonalizedOpportunity(opportunity, {
      heldAssetIds: new Set([0]),
      balances: new Map([[0, 2_000_000n]])
    }),
    false,
    "missing gate ASA"
  );

  assert.equal(
    matchesPersonalizedOpportunity(opportunity, {
      heldAssetIds: new Set([0, 31566704]),
      balances: new Map([
        [0, 2_000_000n],
        [31566704, 1n]
      ])
    }),
    true
  );
});

test("personalized matching excludes NFD-only gates", () => {
  const opportunity: OpportunityMarketRecord = {
    protocol: "reti",
    opportunityType: "staking",
    opportunityId: "reti-staking-2",
    assetPair: "ALGO",
    assetIds: [0],
    apy: 8,
    yieldBasis: "apr",
    tvlUsd: 1000,
    sourceTimestamp: "2026-07-23T00:00:00.000Z",
    fetchedAt: "2026-07-23T00:00:00.000Z",
    entryRequirements: {
      minAmount: { assetId: 0, amount: "1" },
      gates: [{ kind: "nfd-root-segment", nfdRoot: "99" }],
      gateMatch: "any",
      eligibilityFullyCheckable: false
    },
    capacity: {
      stakerSlotsRemaining: 5,
      algoRoomMicroAlgos: "1000",
      acceptingStake: true
    }
  };

  assert.equal(
    matchesPersonalizedOpportunity(opportunity, {
      heldAssetIds: new Set([0]),
      balances: new Map([[0, 10n]])
    }),
    false
  );
});
