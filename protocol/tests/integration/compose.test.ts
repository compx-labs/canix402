import assert from "node:assert/strict";
import test from "node:test";

import type { HaystackService } from "../../src/services/haystack-router.js";
import type { HaystackQuote } from "../../src/types/swap-schema.js";
import type { ExecutableQuote } from "../../src/execution/types.js";
import { buildApp } from "../../src/app.js";
import {
  applySlippageHaircut,
  COMPOSE_MISSING_OPTIN_CAVEAT,
  COMPOSE_SLIPPAGE_CAVEAT,
  COMPOSE_STALE_QUOTE_CAVEAT,
  compileCompose,
  composeEnterSteps,
  HAYSTACK_OPTIN_SHAPE_KEY,
  HAYSTACK_SWAP_SHAPE_KEY,
  selectComposeTargetAsset,
  setComposeDependenciesForTests
} from "../../src/services/compose.js";
import {
  compilePlan,
  setPlanCompilerDependenciesForTests
} from "../../src/services/index.js";
import type {
  OpportunityExecutionShape,
  OpportunityMarketRecord
} from "../../src/types/opportunity.js";
import type { AccountHoldings } from "../../src/services/account-assets.js";
import { attachExecutionShapesToOpportunity } from "../../src/services/opportunity-execution-shapes.js";
import { evaluateOpportunityEligibility } from "../../src/services/eligibility.js";
import { USDC_ASSET_ID } from "../../src/execution/shapes/haystack/constants.js";

const VALID_ADDRESS =
  "RS7TLLQRXKBAQDAVTSZC2ZLMVMLNSCL3FOUOESJJZ5XSKFFL56UI6X33CI";
const NOW = new Date("2026-08-19T10:00:00.000Z");

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

function usdcHoldings(): AccountHoldings {
  return {
    heldAssetIds: new Set([USDC_ASSET_ID]),
    balances: new Map([[USDC_ASSET_ID, 5_000_000n]])
  };
}

function mockQuote(shapeKey: string, amount = "247500"): ExecutableQuote {
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
          amount
        }
      }
    ],
    encodedTransactions: ["AAAA"],
    warnings: [],
    metadata: {}
  };
}

function haystackQuote(): HaystackQuote {
  return {
    address: VALID_ADDRESS,
    fromAssetId: String(USDC_ASSET_ID),
    toAssetId: "0",
    amount: "1000000",
    type: "fixed-input",
    quotedAmount: "250000",
    createdAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 25_000).toISOString(),
    requiredAppOptIns: ["123"],
    txnPayload: { iv: "iv", data: "payload" },
    usdIn: 1,
    usdOut: 0.25,
    route: [],
    quotes: [],
    protocolFees: {}
  };
}

function mockHaystack(): HaystackService {
  return {
    async getQuote(input) {
      return {
        ...haystackQuote(),
        address: input.address,
        fromAssetId: String(input.fromAssetId),
        toAssetId: String(input.toAssetId),
        amount: String(input.amount)
      };
    },
    async buildOptIns() {
      return {
        required: true,
        transactions: [
          {
            index: 0,
            kind: "asset-opt-in",
            encodedTransaction: "b3B0aW4=",
            signer: "user",
            assetId: "123"
          }
        ],
        userSignIndexes: [0],
        createdAt: NOW.toISOString(),
        expiresAt: new Date(NOW.getTime() + 120_000).toISOString()
      };
    },
    async buildSwapTransactions() {
      return {
        transactions: [
          {
            index: 0,
            encodedTransaction: "dXNlcg==",
            signer: "user"
          },
          {
            index: 1,
            encodedTransaction: "cm91dGVy",
            signer: "haystack",
            signedTransaction: "c2lnbmVk"
          }
        ],
        userSignIndexes: [0],
        createdAt: NOW.toISOString(),
        quoteExpiresAt: new Date(NOW.getTime() + 25_000).toISOString()
      };
    }
  };
}

function installComposeStubs(): void {
  setComposeDependenciesForTests({
    now: () => NOW,
    fetchHoldings: async () => usdcHoldings(),
    fetchOpportunities: async () => [retiOpportunity()],
    compileQuote: async (shapeKey, input) => {
      const amount =
        typeof input === "object" &&
        input !== null &&
        "amount" in input &&
        typeof (input as { amount?: unknown }).amount === "string"
          ? (input as { amount: string }).amount
          : "247500";
      return mockQuote(shapeKey, amount);
    },
    haystack: mockHaystack(),
    priceUsdc: "0.1"
  });
  setPlanCompilerDependenciesForTests({
    now: () => NOW,
    fetchHoldings: async () => usdcHoldings(),
    fetchOpportunities: async () => [retiOpportunity()],
    compileQuote: async (shapeKey, input) => {
      const amount =
        typeof input === "object" &&
        input !== null &&
        "amount" in input &&
        typeof (input as { amount?: unknown }).amount === "string"
          ? (input as { amount: string }).amount
          : "247500";
      return mockQuote(shapeKey, amount);
    },
    haystack: mockHaystack(),
    priceUsdc: "0.25"
  });
}

test.afterEach(() => {
  setComposeDependenciesForTests(undefined);
  setPlanCompilerDependenciesForTests(undefined);
});

test("selectComposeTargetAsset returns the unique required asset", () => {
  const opportunity = attachExecutionShapesToOpportunity(retiOpportunity());
  assert.equal(selectComposeTargetAsset(opportunity.executionShapes, USDC_ASSET_ID), 0);
  assert.equal(selectComposeTargetAsset(opportunity.executionShapes, 0), undefined);
});

test("selectComposeTargetAsset skips two-sided required assets", () => {
  const chain = [
    { requiredAssetIds: [0, USDC_ASSET_ID] }
  ] as OpportunityExecutionShape[];
  assert.equal(selectComposeTargetAsset(chain, 123), undefined);
  assert.equal(selectComposeTargetAsset(chain, 0), undefined);
});

test("applySlippageHaircut subtracts Haystack percent as bps", () => {
  assert.equal(applySlippageHaircut("250000", 1), "247500");
  assert.equal(applySlippageHaircut("250000", 0), "250000");
});

test("composeEnterSteps emits opt-in → swap → enter without merging groups", async () => {
  installComposeStubs();
  const market = retiOpportunity();
  const opportunity = attachExecutionShapesToOpportunity(market);
  const eligibility = evaluateOpportunityEligibility(
    market,
    opportunity.opportunityId,
    usdcHoldings()
  );

  const result = await composeEnterSteps({
    address: VALID_ADDRESS,
    fromAssetId: USDC_ASSET_ID,
    amount: "1000000",
    opportunity,
    eligibility,
    chain: opportunity.executionShapes,
    slippage: 1,
    compileQuote: async (shapeKey, input) =>
      mockQuote(
        shapeKey,
        typeof input === "object" && input !== null && "amount" in input
          ? String((input as { amount: string }).amount)
          : "247500"
      ),
    haystack: mockHaystack(),
    now: NOW
  });

  const kinds = result.steps.map((step) => step.kind);
  assert.deepEqual(kinds, ["eligibility", "opt-in", "swap", "enter"]);
  assert.equal(result.swapCompiled, true);
  assert.equal(result.enterAmount, "247500");
  assert.equal(result.enterAssetId, 0);

  const optIn = result.steps.find((step) => step.kind === "opt-in");
  assert.equal(optIn?.compileStatus, "compiled");
  assert.equal(optIn?.shapeKey, HAYSTACK_OPTIN_SHAPE_KEY);
  assert.deepEqual(optIn?.quote?.userSignIndexes, [0]);
  assert.equal(optIn?.quote?.groupTransactions?.[0]?.signer, "user");

  const swap = result.steps.find((step) => step.kind === "swap");
  assert.equal(swap?.compileStatus, "compiled");
  assert.equal(swap?.shapeKey, HAYSTACK_SWAP_SHAPE_KEY);
  assert.deepEqual(swap?.prerequisiteShapeKeys, [HAYSTACK_OPTIN_SHAPE_KEY]);
  assert.deepEqual(swap?.quote?.userSignIndexes, [0]);
  assert.equal(swap?.quote?.encodedTransactions.length, 1);
  assert.equal(swap?.quote?.groupTransactions?.length, 2);
  assert.equal(swap?.quote?.groupTransactions?.[1]?.signer, "logicsig");
  assert.equal(swap?.quote?.groupTransactions?.[1]?.signedTransaction, "c2lnbmVk");
  assert.ok(swap?.warnings.some((row) => row === COMPOSE_STALE_QUOTE_CAVEAT));
  assert.ok(swap?.warnings.some((row) => row === COMPOSE_SLIPPAGE_CAVEAT));
  assert.ok(swap?.warnings.some((row) => row === COMPOSE_MISSING_OPTIN_CAVEAT) === false);

  const enter = result.steps.find((step) => step.kind === "enter");
  assert.equal(enter?.compileStatus, "compiled");
  assert.ok(enter?.prerequisiteShapeKeys?.includes(HAYSTACK_SWAP_SHAPE_KEY));
  assert.equal(enter?.quoteRequest?.input.amount, "247500");
  assert.equal(result.quotes.length, 1);
  assert.equal(result.quotes[0]?.shapeKey, "mainnet:reti:v1:stake:algo");
});

test("POST /plans composes USDC budget into a Réti ALGO enter", async () => {
  installComposeStubs();

  const plan = await compilePlan({
    address: VALID_ADDRESS,
    budget: { assetId: USDC_ASSET_ID, amount: "1000000" },
    opportunityIds: ["reti-staking-12"],
    swapSlippage: 1
  });

  assert.equal(plan.data.allocations.length, 1);
  const kinds = plan.data.allocations[0]!.steps.map((step) => step.kind);
  assert.deepEqual(kinds, ["eligibility", "opt-in", "swap", "enter"]);
  const swap = plan.data.allocations[0]!.steps.find((step) => step.kind === "swap");
  assert.equal(swap?.compileStatus, "compiled");
  assert.equal(swap?.quote?.groupTransactions?.[1]?.signedTransaction, "c2lnbmVk");
  const enter = plan.data.allocations[0]!.steps.find((step) => step.kind === "enter");
  assert.equal(enter?.compileStatus, "compiled");
  assert.equal(enter?.quoteRequest?.input.amount, "247500");
  assert.equal(plan.data.expectedPositionDelta.entries[0]?.assetId, 0);
  assert.equal(plan.data.expectedPositionDelta.entries[0]?.amount, "247500");
  assert.equal(plan.data.fees.x402Usdc, "0.25");
});

test("POST /execution/compose returns sequenced unsigned groups", async () => {
  installComposeStubs();
  const app = buildApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: "POST",
      url: "/execution/compose",
      payload: {
        address: VALID_ADDRESS,
        opportunityId: "reti-staking-12",
        fromAssetId: USDC_ASSET_ID,
        amount: "1000000",
        slippage: 1
      }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      data: {
        steps: Array<{
          kind: string;
          compileStatus: string;
          quote?: {
            userSignIndexes?: number[];
            groupTransactions?: Array<{ signer: string; signedTransaction?: string }>;
            encodedTransactions: string[];
          };
        }>;
        quotes: Array<{ shapeKey: string }>;
        enterAmount: string;
        toAssetId: number;
        fees: { x402Usdc: string };
      };
      meta: { executionSubmitted: boolean; groupsMerged: boolean };
    };
    assert.equal(body.meta.executionSubmitted, false);
    assert.equal(body.meta.groupsMerged, false);
    assert.equal(body.data.fees.x402Usdc, "0.1");
    assert.deepEqual(
      body.data.steps.map((step) => step.kind),
      ["eligibility", "opt-in", "swap", "enter"]
    );
    assert.equal(body.data.toAssetId, 0);
    assert.equal(body.data.enterAmount, "247500");
    const swap = body.data.steps.find((step) => step.kind === "swap");
    assert.equal(swap?.compileStatus, "compiled");
    assert.deepEqual(swap?.quote?.userSignIndexes, [0]);
    assert.equal(swap?.quote?.groupTransactions?.[1]?.signer, "logicsig");
    assert.equal(body.data.quotes[0]?.shapeKey, "mainnet:reti:v1:stake:algo");
  } finally {
    await app.close();
  }
});

test("compileCompose rejects an unknown opportunity", async () => {
  installComposeStubs();
  await assert.rejects(
    () =>
      compileCompose({
        address: VALID_ADDRESS,
        opportunityId: "missing",
        fromAssetId: USDC_ASSET_ID,
        amount: "1000000"
      }),
    /not found/
  );
});
