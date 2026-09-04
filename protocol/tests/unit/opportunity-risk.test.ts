import assert from "node:assert/strict";
import test from "node:test";

import {
  compareOpportunitiesByRiskThenYield,
  confidenceFromAgeMs,
  finalizeOpportunityRisk,
  indexHealthFactorsFromPositions,
  resolveWalletHealthFactor,
  RISK_CONFIDENCE_HIGH_MAX_AGE_MS,
  RISK_CONFIDENCE_MEDIUM_MAX_AGE_MS,
  riskConstraintPenalty,
  tinymanVolatilityRisk,
  TINYMAN_STABLE_IL_HINT,
  utilizationFromBalances
} from "../../src/services/opportunity-risk.js";
import { rankOpportunities } from "../../src/services/opportunity-ranking.js";
import type { OpportunityMarketRecord } from "../../src/types/opportunity.js";

const NOW = new Date("2026-09-03T12:00:00.000Z");

function opportunity(
  overrides: Partial<OpportunityMarketRecord> & Pick<OpportunityMarketRecord, "opportunityId">
): OpportunityMarketRecord {
  return {
    protocol: "tinyman",
    opportunityType: "lp",
    assetPair: "ALGO/USDC",
    apy: 10,
    yieldBasis: "apy",
    tvlUsd: 1_000,
    sourceTimestamp: NOW.toISOString(),
    fetchedAt: NOW.toISOString(),
    ...overrides
  };
}

test("confidenceFromAgeMs maps cache/snapshot age onto high/medium/low", () => {
  assert.equal(confidenceFromAgeMs(0), "high");
  assert.equal(confidenceFromAgeMs(RISK_CONFIDENCE_HIGH_MAX_AGE_MS), "high");
  assert.equal(confidenceFromAgeMs(RISK_CONFIDENCE_HIGH_MAX_AGE_MS + 1), "medium");
  assert.equal(confidenceFromAgeMs(RISK_CONFIDENCE_MEDIUM_MAX_AGE_MS), "medium");
  assert.equal(confidenceFromAgeMs(RISK_CONFIDENCE_MEDIUM_MAX_AGE_MS + 1), "low");
  assert.equal(confidenceFromAgeMs(undefined), "unknown");
});

test("finalizeOpportunityRisk fills confidence from fetchedAt and copies borrowApr", () => {
  const record = opportunity({
    opportunityId: "fresh",
    borrowApr: 9.25,
    fetchedAt: new Date(NOW.getTime() - 30_000).toISOString(),
    sourceTimestamp: new Date(NOW.getTime() - 120_000).toISOString()
  });
  const risk = finalizeOpportunityRisk(record, { now: NOW });
  assert.equal(risk.confidence, "high");
  assert.equal(risk.borrowApr, 9.25);
  assert.equal(risk.sourceAgeSeconds, 120);
});

test("tinymanVolatilityRisk uses is_stable without inventing IL percents", () => {
  assert.deepEqual(tinymanVolatilityRisk(true), {
    volatilityBucket: "stable",
    ilHint: TINYMAN_STABLE_IL_HINT
  });
  assert.deepEqual(tinymanVolatilityRisk(false), { volatilityBucket: "unknown" });
  assert.equal(tinymanVolatilityRisk(undefined), undefined);
});

test("utilizationFromBalances omits unknown rather than inventing", () => {
  assert.equal(utilizationFromBalances(0n, 0n), undefined);
  assert.equal(utilizationFromBalances(50n, 100n), 50);
  assert.equal(utilizationFromBalances(1n, 3n), 33.33);
});

test("wallet health factor prefers opportunityId then lending protocol snapshot", () => {
  const index = indexHealthFactorsFromPositions([
    {
      protocol: "compx",
      opportunityId: "compx-lending-1",
      healthFactor: 1.8
    },
    {
      protocol: "dorkfi",
      opportunityId: null,
      healthFactor: 2.4
    }
  ]);
  assert.equal(
    resolveWalletHealthFactor(
      {
        opportunityId: "compx-lending-1",
        protocol: "compx",
        opportunityType: "lending"
      },
      index
    ),
    1.8
  );
  assert.equal(
    resolveWalletHealthFactor(
      {
        opportunityId: "dorkfi:lending:other",
        protocol: "dorkfi",
        opportunityType: "lending"
      },
      index
    ),
    2.4
  );
  assert.equal(
    resolveWalletHealthFactor(
      {
        opportunityId: "tinyman-1",
        protocol: "tinyman",
        opportunityType: "lp"
      },
      index
    ),
    undefined
  );
});

test("rankOpportunities prefers risk constraints over raw APY", () => {
  const highApyHighUtil = opportunity({
    opportunityId: "hot-util",
    protocol: "compx",
    opportunityType: "lending",
    apy: 40,
    risk: { utilization: 96 }
  });
  const lowerApySafer = opportunity({
    opportunityId: "safer",
    protocol: "compx",
    opportunityType: "lending",
    apy: 8,
    risk: { utilization: 20 }
  });
  const ranked = rankOpportunities([highApyHighUtil, lowerApySafer], NOW);
  assert.deepEqual(
    ranked.map((row) => row.opportunityId),
    ["safer", "hot-util"]
  );
  assert.ok(
    riskConstraintPenalty(finalizeOpportunityRisk(highApyHighUtil, { now: NOW })) >
      riskConstraintPenalty(finalizeOpportunityRisk(lowerApySafer, { now: NOW }))
  );
});

test("rankOpportunities prefers healthy wallet HF over higher APY", () => {
  const riskyHf = opportunity({
    opportunityId: "low-hf",
    protocol: "folks-finance",
    opportunityType: "lending",
    apy: 20,
    risk: { healthFactor: 0.9 }
  });
  const healthy = opportunity({
    opportunityId: "healthy-hf",
    protocol: "folks-finance",
    opportunityType: "lending",
    apy: 6,
    risk: { healthFactor: 2.5 }
  });
  const ranked = rankOpportunities([riskyHf, healthy], NOW);
  assert.equal(ranked[0]?.opportunityId, "healthy-hf");
});

test("compareOpportunitiesByRiskThenYield keeps APY order when risk is equal", () => {
  const delta = compareOpportunitiesByRiskThenYield(
    opportunity({ opportunityId: "a", apy: 3, tvlUsd: 10 }),
    opportunity({ opportunityId: "b", apy: 9, tvlUsd: 1 }),
    NOW
  );
  assert.ok(delta > 0);
});
