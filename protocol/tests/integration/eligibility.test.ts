import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { setFolksFinanceSdkDependenciesForTests } from "../../src/adapters/index.js";
import { buildApp } from "../../src/app.js";
import {
  evaluateOpportunityEligibility,
  matchesPersonalizedOpportunity,
  setAccountAssetsDependenciesForTests,
  setAssetDecimalsDependenciesForTests
} from "../../src/services/index.js";
import type { OpportunityMarketRecord } from "../../src/types/opportunity.js";

const VALID_ADDRESS =
  "RS7TLLQRXKBAQDAVTSZC2ZLMVMLNSCL3FOUOESJJZ5XSKFFL56UI6X33CI";
const GATE_ASA = 12345678;

function retiBase(
  overrides: Partial<OpportunityMarketRecord> = {}
): OpportunityMarketRecord {
  return {
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
      eligibilityFullyCheckable: true
    },
    capacity: {
      stakerSlotsRemaining: 10,
      algoRoomMicroAlgos: "5000000",
      acceptingStake: true
    },
    ...overrides
  };
}

test("eligibility can enter when min amount, ASA gate, and capacity pass", () => {
  const opportunity = retiBase({
    entryRequirements: {
      minAmount: { assetId: 0, amount: "1000000" },
      gates: [{ kind: "asa", assetId: GATE_ASA, minBalance: "1" }],
      gateMatch: "any",
      eligibilityFullyCheckable: true
    }
  });

  const result = evaluateOpportunityEligibility(opportunity, opportunity.opportunityId, {
    heldAssetIds: new Set([0, GATE_ASA]),
    balances: new Map([
      [0, 2_000_000n],
      [GATE_ASA, 1n]
    ])
  });

  assert.equal(result.found, true);
  assert.equal(result.canEnter, true);
  assert.equal(result.eligibilityFullyCheckable, true);
  assert.deepEqual(result.missingAssets, []);
  assert.equal(result.suggestedSwap, null);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.capacity?.acceptingStake, true);
});

test("eligibility reports missing ASA and suggestedSwap", () => {
  const opportunity = retiBase({
    entryRequirements: {
      minAmount: { assetId: 0, amount: "1000000" },
      gates: [{ kind: "asa", assetId: GATE_ASA, minBalance: "1" }],
      gateMatch: "any",
      eligibilityFullyCheckable: true
    }
  });

  const result = evaluateOpportunityEligibility(opportunity, opportunity.opportunityId, {
    heldAssetIds: new Set([0]),
    balances: new Map([[0, 5_000_000n]])
  });

  assert.equal(result.canEnter, false);
  assert.equal(result.eligibilityFullyCheckable, true);
  assert.equal(result.missingAssets.length, 1);
  assert.equal(result.missingAssets[0]?.assetId, GATE_ASA);
  assert.equal(result.missingAssets[0]?.role, "asa-gate");
  assert.ok(result.reasons.includes("missing-asa-gate"));
  assert.equal(result.suggestedSwap?.toAssetId, GATE_ASA);
  assert.equal(result.suggestedSwap?.fromAssetId, 0);
  assert.equal(result.suggestedSwap?.reason, "missing-asa-gate");
});

test("eligibility capacity full cannot enter", () => {
  const opportunity = retiBase({
    capacity: {
      stakerSlotsRemaining: 0,
      algoRoomMicroAlgos: "0",
      acceptingStake: false
    }
  });

  const result = evaluateOpportunityEligibility(opportunity, opportunity.opportunityId, {
    heldAssetIds: new Set([0]),
    balances: new Map([[0, 10_000_000n]])
  });

  assert.equal(result.canEnter, false);
  assert.equal(result.eligibilityFullyCheckable, true);
  assert.equal(result.capacity?.acceptingStake, false);
  assert.ok(result.reasons.includes("capacity-not-accepting"));
  assert.ok(result.reasons.includes("capacity-no-slots"));
  assert.ok(result.reasons.includes("capacity-no-algo-room"));
  assert.equal(result.suggestedSwap, null);
});

test("eligibility unresolved NFD gate never sets canEnter true", () => {
  const opportunity = retiBase({
    entryRequirements: {
      minAmount: { assetId: 0, amount: "1" },
      gates: [{ kind: "nfd-root-segment", nfdRoot: "99" }],
      gateMatch: "any",
      eligibilityFullyCheckable: false
    }
  });

  const result = evaluateOpportunityEligibility(opportunity, opportunity.opportunityId, {
    heldAssetIds: new Set([0]),
    balances: new Map([[0, 10n]])
  });

  assert.equal(result.canEnter, false);
  assert.equal(result.eligibilityFullyCheckable, false);
  assert.equal(result.gates[0]?.status, "unresolved");
  assert.equal(result.gates[0]?.kind, "nfd-root-segment");
  assert.ok(result.reasons.includes("unresolved-nfd-gate"));
});

test("eligibility overlapping pair asset is enough when no entryRequirements", () => {
  const opportunity: OpportunityMarketRecord = {
    protocol: "folks-finance",
    opportunityType: "lending",
    opportunityId: "pair-overlap",
    assetPair: "TEST",
    assetIds: [10, 999],
    apy: 9,
    yieldBasis: "apy",
    tvlUsd: 1000,
    sourceTimestamp: "2026-06-18T00:00:00.000Z",
    fetchedAt: "2026-06-18T00:00:00.000Z"
  };

  const overlapping = evaluateOpportunityEligibility(
    opportunity,
    opportunity.opportunityId,
    { heldAssetIds: new Set([10, 11]) }
  );
  assert.equal(overlapping.canEnter, true);
  assert.equal(overlapping.eligibilityFullyCheckable, true);
  assert.deepEqual(overlapping.missingAssets, []);
  assert.equal(
    matchesPersonalizedOpportunity(opportunity, { heldAssetIds: new Set([10, 11]) }),
    true
  );

  const noneHeld = evaluateOpportunityEligibility(
    opportunity,
    opportunity.opportunityId,
    { heldAssetIds: new Set([11]) }
  );
  assert.equal(noneHeld.canEnter, false);
  assert.ok(noneHeld.reasons.includes("missing-required-asset"));
});

test("personalized matching excludes capacity-full venues", () => {
  const opportunity = retiBase({
    capacity: {
      stakerSlotsRemaining: 0,
      algoRoomMicroAlgos: "0",
      acceptingStake: false
    }
  });
  assert.equal(
    matchesPersonalizedOpportunity(opportunity, {
      heldAssetIds: new Set([0]),
      balances: new Map([[0, 10_000_000n]])
    }),
    false
  );
});

test("eligibility unknown opportunityId is not found", () => {
  const result = evaluateOpportunityEligibility(undefined, "missing-id", {
    heldAssetIds: new Set([0]),
    balances: new Map([[0, 1n]])
  });
  assert.equal(result.found, false);
  assert.equal(result.canEnter, false);
  assert.deepEqual(result.reasons, ["opportunity-not-found"]);
});

function stubFolksWithAssetIds(): void {
  setAssetDecimalsDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    getAssetById: async () => ({ params: { decimals: 6 } })
  });
  setFolksFinanceSdkDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    getConsensusStateFn: async () => {
      throw new Error("consensus disabled in this test");
    },
    estimateConsensusApr: async () => {
      throw new Error("consensus APR disabled in this test");
    },
    retrievePoolManagerInfoFn: async () => ({
      adminAddress: "ADMIN",
      pools: {
        42: {
          variableBorrowInterestRate: 0n,
          variableBorrowInterestYield: 0n,
          variableBorrowInterestIndex: 0n,
          depositInterestRate: 400000000000000n,
          depositInterestYield: 850000000000000n,
          metadata: {
            oldVariableBorrowInterestIndex: 0n,
            oldDepositInterestIndex: 0n,
            oldTimestamp: 0n
          }
        }
      }
    }),
    getOraclePricesFn: async () => ({
      prices: {
        10: { price: 100_000_000n, timestamp: 0n }
      }
    }),
    mainnetPools: {
      ASSET_TEN: {
        appId: 42,
        assetId: 10,
        fAssetId: 1,
        frAssetId: 2,
        assetDecimals: 6,
        poolManagerIndex: 0,
        loans: {}
      }
    },
    retrievePoolInfoFn: async () => ({
      poolManagerAppId: 1,
      poolAdminAddress: "A",
      paramsAdminAddress: "B",
      configAdminAddress: "C",
      loansAdminAddress: "D",
      variableBorrow: {
        vr0: 0n,
        vr1: 0n,
        vr2: 0n,
        totalVariableBorrowAmount: 0n,
        variableBorrowInterestRate: 0n,
        variableBorrowInterestYield: 0n,
        variableBorrowInterestIndex: 0n
      },
      stableBorrow: {
        sr0: 0n,
        sr1: 0n,
        sr2: 0n,
        sr3: 0n,
        optimalStableToTotalDebtRatio: 0n,
        rebalanceUpUtilisationRatio: 0n,
        rebalanceUpDepositInterestRate: 0n,
        rebalanceDownDelta: 0n,
        totalStableBorrowAmount: 0n,
        stableBorrowInterestRate: 0n,
        stableBorrowInterestYield: 0n,
        overallStableBorrowInterestAmount: 0n
      },
      interest: {
        retentionRate: 0n,
        flashLoanFee: 0n,
        optimalUtilisationRatio: 0n,
        totalDeposits: 250_000_000_000n,
        depositInterestRate: 0n,
        depositInterestYield: 0n,
        depositInterestIndex: 0n,
        latestUpdate: 0n
      },
      caps: {
        borrowCap: 0n,
        stableBorrowPercentageCap: 0n
      },
      config: {
        depreciated: false,
        rewardsPaused: false,
        stableBorrowSupported: false,
        flashLoanSupported: false
      }
    })
  });
}

test("POST /eligibility returns 200 for a valid wallet and known opportunity", async () => {
  stubFolksWithAssetIds();
  setAccountAssetsDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    fetchAccountInformation: async () => ({
      amount: 1_000_000n,
      assets: [{ assetId: 10n, amount: 5n }]
    })
  });

  const tinymanMock = await startEmptyTinymanMock();
  process.env.TINYMAN_API_BASE_URL = tinymanMock.baseUrl;

  const app = buildApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: "POST",
      url: "/eligibility",
      payload: {
        address: VALID_ADDRESS,
        opportunityIds: ["folks-lending-42", "missing-opportunity"]
      }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      data: Array<{
        opportunityId: string;
        found: boolean;
        canEnter: boolean;
        eligibilityFullyCheckable: boolean;
      }>;
      meta: { address: string; paymentRequired: boolean; quoteTimeAuthoritative: boolean };
    };
    assert.equal(body.meta.address, VALID_ADDRESS);
    assert.equal(body.meta.paymentRequired, true);
    assert.equal(body.meta.quoteTimeAuthoritative, true);
    assert.equal(body.data.length, 2);
    assert.equal(body.data[0]?.opportunityId, "folks-lending-42");
    assert.equal(body.data[0]?.found, true);
    assert.equal(body.data[0]?.canEnter, true);
    assert.equal(body.data[1]?.opportunityId, "missing-opportunity");
    assert.equal(body.data[1]?.found, false);
    assert.equal(body.data[1]?.canEnter, false);
  } finally {
    await app.close();
    await tinymanMock.close();
    delete process.env.TINYMAN_API_BASE_URL;
    setFolksFinanceSdkDependenciesForTests(undefined);
    setAccountAssetsDependenciesForTests(undefined);
    setAssetDecimalsDependenciesForTests(undefined);
  }
});

test("POST /eligibility rejects an invalid address with 400", async () => {
  const app = buildApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: "POST",
      url: "/eligibility",
      payload: {
        address: "not-a-real-address",
        opportunityIds: ["folks-lending-42"]
      }
    });

    assert.equal(response.statusCode, 400);
    const body = response.json() as { error: { code: string } };
    assert.equal(body.error.code, "VALIDATION_ERROR");
  } finally {
    await app.close();
  }
});

test("POST /eligibility rejects an empty opportunityIds list", async () => {
  const app = buildApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: "POST",
      url: "/eligibility",
      payload: {
        address: VALID_ADDRESS,
        opportunityIds: []
      }
    });

    assert.equal(response.statusCode, 400);
  } finally {
    await app.close();
  }
});

interface MockServer {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startEmptyTinymanMock(): Promise<MockServer> {
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/pools/")) {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ results: [] }));
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Failed to bind Tinyman mock server.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}
