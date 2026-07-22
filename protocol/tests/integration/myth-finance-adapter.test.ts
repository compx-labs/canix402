import assert from "node:assert/strict";
import test from "node:test";

import {
  mythFarmOpportunityId,
  mythStakingOpportunityId,
  normalizeMythFarmOpportunity,
  normalizeMythStakingOpportunity
} from "../../src/adapters/mythFinance.js";

const SNAPSHOT = {
  appId: 3028076093n,
  listing: {
    round: 1n,
    appId: 3028076093n,
    rate: 4_171_200_652n,
    algoBalance: 31_214_992_853n,
    asaBalance: 12_978_690_830n,
    staked: 31_115_000_000n,
    lstId: 3028084000n,
    lstName: "memoALGO",
    asaId: 885835936n,
    asaName: "MembersOnly Token",
    asaUnitName: "MemO",
    asaDecimals: 3,
    needSwap: false,
    incentiveEligible: true,
    isOnline: true,
    upgrading: false,
    userProtestingStake: 0n
  },
  platformFeeBps: 0,
  noderunnerFeeBps: 400
};

test("normalizeMythStakingOpportunity nets consensus APR by fees and adds farm APR", () => {
  const record = normalizeMythStakingOpportunity({
    snapshot: SNAPSHOT,
    consensusApr: 5,
    sampleSize: 100,
    algoUsdPrice: 0.2,
    farm: {
      appId: 3028076093n,
      appEscrow: "ESCROW",
      farmAprBps: 582n,
      baseAprBps: 477n,
      remainingDurationSec: 3_600n,
      farmAsset: 885835936n
    } as never,
    fetchedAtIso: "2026-07-22T00:00:00.000Z"
  });

  assert.ok(record);
  assert.equal(record?.protocol, "myth-finance");
  assert.equal(record?.opportunityType, "staking");
  assert.equal(record?.opportunityId, mythStakingOpportunityId(3028076093));
  assert.deepEqual(record?.assetIds, [0, 885835936, 3028084000]);
  assert.equal(record?.yieldBasis, "apy");
  assert.equal(record?.apr, 5);
  // 5 * (1 - 0.04) + 5.82 = 4.8 + 5.82
  assert.ok(record && Math.abs(record.apy - 10.62) < 1e-9);
  assert.ok(record && Math.abs(record.tvlUsd - 6223) < 1e-6);
});

test("normalizeMythStakingOpportunity drops non-positive TVL", () => {
  const record = normalizeMythStakingOpportunity({
    snapshot: {
      ...SNAPSHOT,
      listing: { ...SNAPSHOT.listing, staked: 0n }
    },
    consensusApr: 5,
    sampleSize: 10,
    algoUsdPrice: 0.2,
    fetchedAtIso: "2026-07-22T00:00:00.000Z"
  });
  assert.equal(record, null);
});

test("normalizeMythFarmOpportunity emits passive farm rows only when active", () => {
  const active = normalizeMythFarmOpportunity({
    snapshot: SNAPSHOT,
    farm: {
      appId: 3028076093n,
      appEscrow: "ESCROW",
      farmAprBps: 582n,
      baseAprBps: 477n,
      remainingDurationSec: 3_600n,
      farmAsset: 885835936n
    } as never,
    algoUsdPrice: 0.2,
    fetchedAtIso: "2026-07-22T00:00:00.000Z"
  });
  assert.ok(active);
  assert.equal(active?.opportunityId, mythFarmOpportunityId(3028076093));
  assert.equal(active?.opportunityType, "farm");
  assert.equal(active?.yieldBasis, "apr");
  assert.ok(active && Math.abs(active.apy - 5.82) < 1e-9);

  const inactive = normalizeMythFarmOpportunity({
    snapshot: SNAPSHOT,
    farm: {
      appId: 3028076093n,
      appEscrow: "ESCROW",
      farmAprBps: 582n,
      baseAprBps: 477n,
      remainingDurationSec: 0n,
      farmAsset: 885835936n
    } as never,
    algoUsdPrice: 0.2,
    fetchedAtIso: "2026-07-22T00:00:00.000Z"
  });
  assert.equal(inactive, null);
});
