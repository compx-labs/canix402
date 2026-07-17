import assert from "node:assert/strict";
import test from "node:test";

import {
  CONSENSUS_BONUS_BASE_MICRO_ALGOS,
  computeConsensusApr,
  computeDecayedBonusMicroAlgos,
  estimateConsensusStakingApr,
  setConsensusStakingAprDependenciesForTests
} from "../../src/services/consensus-staking-apr.js";

test("computeDecayedBonusMicroAlgos returns base before first decay interval", () => {
  assert.equal(computeDecayedBonusMicroAlgos(0), CONSENSUS_BONUS_BASE_MICRO_ALGOS);
  assert.equal(computeDecayedBonusMicroAlgos(999_999), CONSENSUS_BONUS_BASE_MICRO_ALGOS);
});

test("computeDecayedBonusMicroAlgos decays 1% per million rounds", () => {
  const afterOne = computeDecayedBonusMicroAlgos(1_000_000);
  assert.equal(afterOne, BigInt(Math.round(Number(CONSENSUS_BONUS_BASE_MICRO_ALGOS) * 0.99)));

  const afterTwo = computeDecayedBonusMicroAlgos(2_000_000);
  assert.equal(
    afterTwo,
    BigInt(Math.round(Number(CONSENSUS_BONUS_BASE_MICRO_ALGOS) * 0.99 ** 2))
  );
});

test("computeConsensusApr matches (blockReward * blocksPerYear / onlineStake) * 100", () => {
  const apr = computeConsensusApr({
    bonusMicroAlgos: 10_000_000n,
    avgFeesCollected: 2_000_000n,
    onlineStake: 1_000_000_000_000_000n,
    blocksPerYear: 10_000_000,
    payoutFeePercent: 50
  });
  // blockReward = 10e6 + 0.5 * 2e6 = 11e6
  // apr = 11e6 * 10e6 / 1e15 * 100 = 11
  assert.equal(apr, 11);
});

test("estimateConsensusStakingApr averages sampled block rewards", async () => {
  setConsensusStakingAprDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    getSupply: async () => ({
      currentRound: 100,
      onlineStake: 1_000_000_000_000_000n,
      onlineMoney: 1_000_000_000_000_000n
    }),
    getStatusRound: async () => 100,
    getBlockRewardFields: async (_algod, round) => ({
      bonus: 10_000_000n,
      feesCollected: round % 2 === 0 ? 2_000_000n : 0n
    }),
    blockSampleSize: 4,
    blocksPerYear: 10_000_000,
    payoutFeePercent: 50
  });

  try {
    const estimate = await estimateConsensusStakingApr();
    // avg fees = (2e6 + 0 + 2e6 + 0) / 4 = 1e6
    // blockReward = 10e6 + 0.5e6 = 10.5e6
    // apr = 10.5e6 * 10e6 / 1e15 * 100 = 10.5
    assert.equal(estimate.sampleSize, 4);
    assert.equal(estimate.avgFeesCollected, 1_000_000n);
    assert.equal(estimate.bonusMicroAlgos, 10_000_000n);
    assert.equal(estimate.apr, 10.5);
  } finally {
    setConsensusStakingAprDependenciesForTests(undefined);
  }
});
