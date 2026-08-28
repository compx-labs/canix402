import assert from "node:assert/strict";
import test from "node:test";

import { USDC_ASSET_ID } from "../../src/execution/shapes/haystack/constants.js";
import type { ExecutableQuote } from "../../src/execution/types.js";
import { buildApp } from "../../src/app.js";
import {
  compileRebalance,
  setRebalanceCompilerDependenciesForTests
} from "../../src/services/index.js";
import type { AccountHoldings } from "../../src/services/account-assets.js";
import type { OpportunityMarketRecord } from "../../src/types/opportunity.js";
import type { PositionRecordV1 } from "../../src/types/position.js";
import type { ClaimableRewardRecord } from "../../src/types/claimable.js";

const VALID_ADDRESS =
  "RS7TLLQRXKBAQDAVTSZC2ZLMVMLNSCL3FOUOESJJZ5XSKFFL56UI6X33CI";
const NOW = new Date("2026-08-20T10:00:00.000Z");

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
      action: shapeKey.includes("unstake") ? "unstake" : "stake",
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

function stakedPosition(): PositionRecordV1 {
  return {
    protocol: "reti",
    positionType: "staked",
    positionId: "reti:staked:12",
    opportunityId: "reti-staking-12",
    assetId: 0,
    assetSymbol: "ALGO",
    amountRaw: "7000000",
    amount: "7",
    usdValue: 70,
    compatibleExitShapeKeys: ["mainnet:reti:v1:unstake:algo"],
    compatibleManageShapeKeys: [],
    inputHints: { validatorId: 12, poolAppId: 1, assetId: 0 }
  };
}

test.afterEach(() => {
  setRebalanceCompilerDependenciesForTests(undefined);
});

test("harvest-idle compiles unsigned claim then enter groups without merging", async () => {
  const claimable: ClaimableRewardRecord[] = [
    {
      protocol: "haystack",
      positionId: "haystack:reward:usdc",
      opportunityId: "haystack-staking-hay",
      positionType: "reward",
      assetId: USDC_ASSET_ID,
      assetSymbol: "USDC",
      amountRaw: "1500000",
      amount: "1.5",
      usdValue: 1.5,
      claimKey: "haystack:claim:addr",
      compatibleClaimShapeKeys: ["mainnet:haystack:v1:claim:rewards"],
      quote: {
        shapeKey: "mainnet:haystack:v1:claim:rewards",
        input: { userAddress: VALID_ADDRESS }
      },
      estimatedNetworkFeeMicroAlgos: "2000",
      estimatedNetworkFeeUsd: 0.0004,
      worthClaiming: true
    }
  ];

  setRebalanceCompilerDependenciesForTests({
    now: () => NOW,
    fetchHoldings: async () => holdings(5_000_000n),
    fetchPositions: async () => [],
    fetchClaimable: () => claimable,
    fetchOpportunities: async () => [retiOpportunity()],
    compileQuote: async (shapeKey) => mockQuote(shapeKey),
    priceUsdc: "0.25"
  });

  const plan = await compileRebalance({
    address: VALID_ADDRESS,
    harvestIdle: true,
    constraints: { noNewBorrows: true, executionReadyOnly: true, maxAllocations: 1 }
  });

  assert.equal(plan.meta.paymentRequired, true);
  assert.equal(plan.meta.executionSubmitted, false);
  assert.equal(plan.meta.groupsMerged, false);
  assert.equal(plan.data.mode, "harvest-idle");
  assert.equal(plan.data.fees.x402Usdc, "0.25");
  assert.equal(plan.data.book.idleAlgoMicroAlgos, "4000000");

  const kinds = plan.data.steps.map((step) => step.kind);
  assert.equal(kinds[0], "claim");
  assert.ok(kinds.includes("enter"));
  const claim = plan.data.steps.find((step) => step.kind === "claim");
  const enter = plan.data.steps.find((step) => step.kind === "enter");
  assert.equal(claim?.compileStatus, "compiled");
  assert.equal(claim?.quote?.encodedTransactions.length, 1);
  assert.equal(enter?.compileStatus, "compiled");
  assert.notEqual(claim?.quote?.encodedTransactions, enter?.quote?.encodedTransactions);
  assert.equal(plan.data.quotes.length >= 2, true);
  assert.match(plan.data.expectedPositionDelta.summary, /Claim|Enter/);
});

test("target-weight delta compiles a partial exit and defers enter from proceeds", async () => {
  setRebalanceCompilerDependenciesForTests({
    now: () => NOW,
    fetchHoldings: async () => holdings(1_000_000n),
    fetchPositions: async () => [
      stakedPosition(),
      {
        ...stakedPosition(),
        positionId: "reti:staked:1",
        opportunityId: "reti-staking-1",
        amountRaw: "3000000",
        amount: "3",
        usdValue: 30,
        inputHints: { validatorId: 1, poolAppId: 2, assetId: 0 }
      }
    ],
    fetchClaimable: () => [],
    fetchOpportunities: async () => [
      retiOpportunity(),
      retiOpportunity({ opportunityId: "reti-staking-1", apy: 7 })
    ],
    compileQuote: async (shapeKey) => mockQuote(shapeKey),
    priceUsdc: "0.25"
  });

  const plan = await compileRebalance({
    address: VALID_ADDRESS,
    targetWeights: [
      { opportunityId: "reti-staking-12", weightBps: 5_000 },
      { opportunityId: "reti-staking-1", weightBps: 5_000 }
    ]
  });

  assert.equal(plan.data.mode, "target-weights");
  const exit = plan.data.steps.find((step) => step.kind === "exit");
  assert.equal(exit?.compileStatus, "compiled");
  assert.equal(exit?.shapeKey, "mainnet:reti:v1:unstake:algo");
  assert.ok(exit?.quoteRequest?.input.amount === "2000000" || exit?.quoteRequest?.input.assetAmount === "2000000");
  const deferred = plan.data.steps.find(
    (step) => step.kind === "enter" && step.compileStatus === "deferred"
  );
  assert.ok(deferred);
  assert.match(deferred?.warnings.join(" ") ?? "", /exit groups confirm/i);
  assert.equal(plan.meta.groupsMerged, false);
});

test("POST /plans/rebalance returns 200 for harvest-idle with unsigned groups", async () => {
  setRebalanceCompilerDependenciesForTests({
    now: () => NOW,
    fetchHoldings: async () => holdings(5_000_000n),
    fetchPositions: async () => [],
    fetchClaimable: () => [],
    fetchOpportunities: async () => [retiOpportunity()],
    compileQuote: async (shapeKey) => mockQuote(shapeKey),
    priceUsdc: "0.25"
  });
  const app = buildApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: "POST",
      url: "/plans/rebalance",
      payload: {
        address: VALID_ADDRESS,
        harvestIdle: true
      }
    });
    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      data: {
        mode: string;
        steps: Array<{ kind: string; compileStatus: string; quote?: { encodedTransactions: string[] } }>;
        simulation?: { signed: boolean; submitted: boolean };
      };
      meta: { executionSubmitted: boolean; groupsMerged: boolean };
    };
    assert.equal(body.meta.executionSubmitted, false);
    assert.equal(body.meta.groupsMerged, false);
    assert.equal(body.data.mode, "harvest-idle");
    const enter = body.data.steps.find((step) => step.kind === "enter");
    assert.equal(enter?.compileStatus, "compiled");
    assert.ok((enter?.quote?.encodedTransactions.length ?? 0) > 0);
    assert.equal(body.data.simulation?.signed, false);
    assert.equal(body.data.simulation?.submitted, false);
  } finally {
    await app.close();
  }
});

test("POST /plans/rebalance rejects an invalid address with 400", async () => {
  const app = buildApp();
  await app.ready();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/plans/rebalance",
      payload: { address: "not-a-real-address", harvestIdle: true }
    });
    assert.equal(response.statusCode, 400);
  } finally {
    await app.close();
  }
});

test("POST /plans/rebalance rejects a body with neither targets nor harvestIdle", async () => {
  const app = buildApp();
  await app.ready();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/plans/rebalance",
      payload: { address: VALID_ADDRESS }
    });
    assert.equal(response.statusCode, 400);
    const body = response.json() as { error: { message: string } };
    assert.match(body.error.message, /targetWeights|harvestIdle/);
  } finally {
    await app.close();
  }
});

test("POST /plans/rebalance rejects targetWeights that do not sum to 10000", async () => {
  const app = buildApp();
  await app.ready();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/plans/rebalance",
      payload: {
        address: VALID_ADDRESS,
        targetWeights: [{ opportunityId: "reti-staking-12", weightBps: 5000 }]
      }
    });
    assert.equal(response.statusCode, 400);
  } finally {
    await app.close();
  }
});
