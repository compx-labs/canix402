import assert from "node:assert/strict";
import test from "node:test";

import {
  setPolicyDependenciesForTests,
  validatePolicy
} from "../../src/services/policy.js";
import type {
  PolicyDocument,
  PolicyQuoteSubject,
  PolicyValidateRequest
} from "../../src/types/policy-schema.js";

const NOW = new Date("2026-08-28T12:00:00.000Z");
const FRESH = "2026-08-28T11:00:00.000Z";
const STALE = "2026-08-20T12:00:00.000Z";

const BROWNIE_POLICY: PolicyDocument = {
  schemaVersion: "1.0.0",
  maxProtocolWeightBps: 4000,
  minAlgoReserveMicroAlgos: "1000000",
  minTvlUsd: 25_000,
  maxSourceAgeSeconds: 86_400,
  noNewBorrows: true,
  executionReadyOnly: true
};

function retiQuote(overrides: Partial<PolicyQuoteSubject> = {}): PolicyQuoteSubject {
  return {
    shapeKey: "mainnet:reti:v1:stake:algo",
    protocol: "reti",
    opportunityId: "reti-staking-12",
    weightBps: 4000,
    allocatedAmount: "1000000",
    allocatedAssetId: 0,
    tvlUsd: 1_000_000,
    sourceTimestamp: FRESH,
    executionReady: true,
    ...overrides
  };
}

test.afterEach(() => {
  setPolicyDependenciesForTests(undefined);
});

test("pass: diversified Réti stake within Brownie caps", () => {
  setPolicyDependenciesForTests({ now: () => NOW });
  const request: PolicyValidateRequest = {
    policy: BROWNIE_POLICY,
    quotes: [retiQuote()],
    walletAlgoMicroAlgos: "5000000"
  };
  const response = validatePolicy(request);
  assert.equal(response.data.pass, true);
  assert.equal(response.data.reasons.length, 0);
  assert.equal(response.data.signed, false);
  assert.equal(response.data.submitted, false);
  assert.equal(response.meta.executionSubmitted, false);
  assert.equal(response.meta.signed, false);
  assert.equal(response.meta.paymentRequired, true);
});

test("fail-weight: a single protocol above maxProtocolWeightBps", () => {
  setPolicyDependenciesForTests({ now: () => NOW });
  const response = validatePolicy({
    policy: BROWNIE_POLICY,
    quotes: [retiQuote({ weightBps: 10_000 })],
    walletAlgoMicroAlgos: "5000000"
  });
  assert.equal(response.data.pass, false);
  assert.equal(response.data.reasons.some((row) => row.code === "protocol-weight"), true);
  assert.equal(response.data.reasons.find((row) => row.code === "protocol-weight")?.protocol, "reti");
});

test("fail-borrows: noNewBorrows rejects a borrow shape", () => {
  setPolicyDependenciesForTests({ now: () => NOW });
  const response = validatePolicy({
    policy: BROWNIE_POLICY,
    quotes: [
      retiQuote({
        shapeKey: "mainnet:compx:v1:borrow:asa",
        protocol: "compx",
        opportunityId: "compx-lending-1",
        identity: { action: "borrow" }
      })
    ],
    walletAlgoMicroAlgos: "5000000"
  });
  assert.equal(response.data.pass, false);
  assert.equal(response.data.reasons.some((row) => row.code === "new-borrow"), true);
});

test("stale TVL: missing tvlUsd fails closed and old sourceTimestamp fails freshness", () => {
  setPolicyDependenciesForTests({ now: () => NOW });
  const missingTvl = validatePolicy({
    policy: { schemaVersion: "1.0.0", minTvlUsd: 25_000 },
    quotes: [retiQuote({ tvlUsd: undefined })]
  });
  assert.equal(missingTvl.data.pass, false);
  assert.equal(missingTvl.data.reasons.some((row) => row.code === "missing-tvl"), true);

  const stale = validatePolicy({
    policy: { schemaVersion: "1.0.0", maxSourceAgeSeconds: 86_400 },
    quotes: [retiQuote({ sourceTimestamp: STALE })]
  });
  assert.equal(stale.data.pass, false);
  assert.equal(stale.data.reasons.some((row) => row.code === "source-not-fresh"), true);
});

test("compiled plan allocations reuse tvl/freshness/eligibility fields", () => {
  setPolicyDependenciesForTests({ now: () => NOW });
  const response = validatePolicy({
    policy: BROWNIE_POLICY,
    plan: {
      data: {
        allocations: [
          {
            opportunityId: "reti-staking-12",
            protocol: "reti",
            weightBps: 4000,
            allocatedAmount: "1000000",
            allocatedAssetId: 0,
            tvlUsd: 1_000_000,
            sourceTimestamp: FRESH,
            executionReady: true,
            eligibility: { canEnter: true, eligibilityFullyCheckable: true },
            executionShapes: [
              { shapeKey: "mainnet:reti:v1:stake:algo", action: "stake" }
            ]
          }
        ],
        fees: { estimatedNetworkFeeMicroAlgos: "1000" }
      }
    },
    walletAlgoMicroAlgos: "5000000"
  });
  assert.equal(response.data.pass, true);
});

test("reserve floor fails closed without walletAlgoMicroAlgos and below remaining ALGO", () => {
  const missing = validatePolicy({
    policy: { schemaVersion: "1.0.0", minAlgoReserveMicroAlgos: "1000000" },
    quotes: [retiQuote()]
  });
  assert.equal(missing.data.pass, false);
  assert.equal(missing.data.reasons.some((row) => row.code === "missing-reserve"), true);

  const below = validatePolicy({
    policy: { schemaVersion: "1.0.0", minAlgoReserveMicroAlgos: "4000000" },
    quotes: [retiQuote({ allocatedAmount: "2000000", allocatedAssetId: 0 })],
    walletAlgoMicroAlgos: "5000000"
  });
  assert.equal(below.data.pass, false);
  assert.equal(below.data.reasons.some((row) => row.code === "below-reserve"), true);
});

test("empty subject fails closed", () => {
  const response = validatePolicy({
    policy: { schemaVersion: "1.0.0" },
    plan: { data: { allocations: [] } }
  });
  assert.equal(response.data.pass, false);
  assert.equal(response.data.reasons[0]?.code, "empty-subject");
});

test("blocked eligibility and execution-not-ready fail closed when present", () => {
  const blocked = validatePolicy({
    policy: { schemaVersion: "1.0.0" },
    quotes: [
      retiQuote({
        eligibility: { canEnter: false, eligibilityFullyCheckable: true }
      })
    ]
  });
  assert.equal(blocked.data.pass, false);
  assert.equal(blocked.data.reasons.some((row) => row.code === "blocked-eligibility"), true);

  const notReady = validatePolicy({
    policy: { schemaVersion: "1.0.0", executionReadyOnly: true },
    quotes: [retiQuote({ executionReady: false })]
  });
  assert.equal(notReady.data.pass, false);
  assert.equal(notReady.data.reasons.some((row) => row.code === "execution-not-ready"), true);
});
