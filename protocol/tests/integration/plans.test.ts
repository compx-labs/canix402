import assert from "node:assert/strict";
import test from "node:test";

import type { ExecutableQuote } from "../../src/execution/types.js";
import { buildApp } from "../../src/app.js";
import {
  compilePlan,
  setPlanCompilerDependenciesForTests
} from "../../src/services/index.js";
import type { OpportunityMarketRecord } from "../../src/types/opportunity.js";
import type { AccountHoldings } from "../../src/services/account-assets.js";

const VALID_ADDRESS =
  "RS7TLLQRXKBAQDAVTSZC2ZLMVMLNSCL3FOUOESJJZ5XSKFFL56UI6X33CI";
const NOW = new Date("2026-08-16T10:00:00.000Z");

function retiOpportunity(
  overrides: Partial<OpportunityMarketRecord> = {}
): OpportunityMarketRecord {
  return {
    protocol: "reti",
    opportunityType: "staking",
    opportunityId: "reti-staking-12",
    assetPair: "ALGO",
    assetIds: [0],
    apy: 8.5,
    yieldBasis: "apr",
    tvlUsd: 125_000,
    sourceTimestamp: NOW.toISOString(),
    fetchedAt: NOW.toISOString(),
    entryRequirements: {
      minAmount: { assetId: 0, amount: "1000000" },
      eligibilityFullyCheckable: true
    },
    capacity: {
      stakerSlotsRemaining: 20,
      algoRoomMicroAlgos: "50000000000",
      acceptingStake: true
    },
    ...overrides
  };
}

function holdings(algoMicro: bigint): AccountHoldings {
  return {
    heldAssetIds: algoMicro > 0n ? new Set([0]) : new Set(),
    balances: new Map([[0, algoMicro]])
  };
}

function mockQuote(shapeKey: string): ExecutableQuote {
  return {
    shapeKey,
    shapeVersion: "1.0.0",
    identity: {
      network: "mainnet",
      protocol: "reti",
      protocolVersion: "v1",
      action: "stake",
      variant: "algo"
    },
    createdAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 30_000).toISOString(),
    transactions: [
      {
        type: "pay",
        sender: VALID_ADDRESS,
        fee: "1000",
        groupPresent: true,
        payment: {
          receiver: VALID_ADDRESS,
          amount: "1000000"
        }
      }
    ],
    encodedTransactions: ["AAAA"],
    warnings: [],
    metadata: {}
  };
}

function installHappyPathStubs(opportunity = retiOpportunity()): void {
  setPlanCompilerDependenciesForTests({
    now: () => NOW,
    fetchHoldings: async () => holdings(5_000_000n),
    fetchOpportunities: async () => [opportunity],
    compileQuote: async (shapeKey) => mockQuote(shapeKey),
    priceUsdc: "0.25"
  });
}

test.afterEach(() => {
  setPlanCompilerDependenciesForTests(undefined);
});

test("ALGO enter plan returns eligibility, unsigned groups, and quotes[]", async () => {
  installHappyPathStubs();

  const plan = await compilePlan({
    address: VALID_ADDRESS,
    budget: { assetId: 0, amount: "1000000" },
    constraints: {
      noNewBorrows: true,
      executionReadyOnly: true,
      maxAllocations: 1
    },
    opportunityIds: ["reti-staking-12"]
  });

  assert.equal(plan.meta.paymentRequired, true);
  assert.equal(plan.meta.executionSubmitted, false);
  assert.equal(plan.meta.eligibilityEndpoint, "/eligibility");
  assert.equal(plan.meta.quoteTimeAuthoritative, true);
  assert.equal(plan.data.allocations.length, 1);

  const allocation = plan.data.allocations[0]!;
  assert.equal(allocation.opportunityId, "reti-staking-12");
  assert.equal(allocation.protocol, "reti");
  assert.equal(allocation.allocatedAmount, "1000000");
  assert.equal(allocation.eligibility.canEnter, true);
  assert.equal(allocation.eligibility.eligibilityFullyCheckable, true);

  const kinds = allocation.steps.map((step) => step.kind);
  assert.deepEqual(kinds[0], "eligibility");
  assert.ok(kinds.includes("enter"));

  const enter = allocation.steps.find((step) => step.kind === "enter");
  assert.equal(enter?.compileStatus, "compiled");
  assert.equal(enter?.shapeKey, "mainnet:reti:v1:stake:algo");
  assert.ok(enter?.quote);
  assert.equal(enter?.quote?.encodedTransactions.length, 1);
  assert.equal(plan.meta.executionSubmitted, false);
  assert.equal(allocation.quotes.length, 1);
  assert.equal(allocation.quotes[0]?.shapeKey, "mainnet:reti:v1:stake:algo");
  assert.equal(allocation.quotes[0]?.input.userAddress, VALID_ADDRESS);
  assert.equal(plan.data.fees.x402Usdc, "0.25");
  assert.equal(plan.data.fees.estimatedNetworkFeeMicroAlgos, "1000");
  assert.match(plan.data.expectedPositionDelta.summary, /reti-staking-12/);
});

test("eligibility gate blocks ALGO enter when below min amount", async () => {
  installHappyPathStubs(
    retiOpportunity({
      entryRequirements: {
        minAmount: { assetId: 0, amount: "10000000" },
        eligibilityFullyCheckable: true
      }
    })
  );

  const plan = await compilePlan({
    address: VALID_ADDRESS,
    budget: { assetId: 0, amount: "1000000" },
    opportunityIds: ["reti-staking-12"]
  });

  assert.equal(plan.data.allocations.length, 0);
  assert.equal(plan.data.blocked.length, 1);
  assert.equal(plan.data.blocked[0]?.eligibility.canEnter, false);
  assert.ok(plan.data.blocked[0]?.reasons.includes("eligibility-gate"));
  assert.ok(plan.data.blocked[0]?.reasons.includes("below-min-amount"));
  assert.match(plan.data.expectedPositionDelta.summary, /No executable enter/);
});

test("POST /plans returns 200 for a simple ALGO enter with unsigned groups", async () => {
  installHappyPathStubs();
  const app = buildApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: "POST",
      url: "/plans",
      payload: {
        address: VALID_ADDRESS,
        budget: { assetId: 0, amount: "1000000" },
        constraints: { noNewBorrows: true, executionReadyOnly: true },
        opportunityIds: ["reti-staking-12"]
      }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      data: {
        allocations: Array<{
          eligibility: { canEnter: boolean };
          steps: Array<{ kind: string; compileStatus: string; quote?: { encodedTransactions: string[] } }>;
          quotes: Array<{ shapeKey: string }>;
        }>;
      };
      meta: { executionSubmitted: boolean; paymentRequired: boolean };
    };
    assert.equal(body.meta.paymentRequired, true);
    assert.equal(body.meta.executionSubmitted, false);
    assert.equal(body.data.allocations[0]?.eligibility.canEnter, true);
    const enter = body.data.allocations[0]?.steps.find((step) => step.kind === "enter");
    assert.equal(enter?.compileStatus, "compiled");
    assert.ok((enter?.quote?.encodedTransactions.length ?? 0) > 0);
    assert.equal(body.data.allocations[0]?.quotes[0]?.shapeKey, "mainnet:reti:v1:stake:algo");
  } finally {
    await app.close();
  }
});

test("POST /plans rejects an invalid address with 400", async () => {
  const app = buildApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: "POST",
      url: "/plans",
      payload: {
        address: "not-a-real-address",
        budget: { assetId: 0, amount: "1000000" }
      }
    });
    assert.equal(response.statusCode, 400);
    const body = response.json() as { error: { code: string } };
    assert.equal(body.error.code, "VALIDATION_ERROR");
  } finally {
    await app.close();
  }
});

test("POST /plans rejects a zero budget amount", async () => {
  const app = buildApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: "POST",
      url: "/plans",
      payload: {
        address: VALID_ADDRESS,
        budget: { assetId: 0, amount: "0" }
      }
    });
    assert.equal(response.statusCode, 400);
  } finally {
    await app.close();
  }
});
