import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../../src/app.js";
import { setCompXSdkDependenciesForTests } from "../../src/adapters/index.js";
import { setPositionCollectorsForTests } from "../../src/services/aggregate-positions.js";
import {
  buildClaimAllQuotes,
  COMPX_CLAIM,
  HAYSTACK_CLAIM,
  PACT_FARM_CLAIM,
  projectClaimableRecords,
  TINYMAN_FARM_CLAIM,
  TINYMAN_STALGO_CLAIM,
  ALPHA_ARCADE_CLAIM
} from "../../src/services/claimable-rewards.js";
import type { PositionRecordV1 } from "../../src/types/position.js";

const VALID_ADDRESS =
  "RS7TLLQRXKBAQDAVTSZC2ZLMVMLNSCL3FOUOESJJZ5XSKFFL56UI6X33CI";

const ALGO_USD = 0.2;

function basePosition(
  overrides: Partial<PositionRecordV1> &
    Pick<PositionRecordV1, "protocol" | "positionType" | "positionId">
): PositionRecordV1 {
  return {
    opportunityId: null,
    assetId: null,
    assetSymbol: null,
    amountRaw: "0",
    amount: "0",
    usdValue: null,
    compatibleExitShapeKeys: [],
    compatibleManageShapeKeys: [],
    ...overrides
  };
}

test.afterEach(() => {
  setPositionCollectorsForTests(undefined);
  setCompXSdkDependenciesForTests(undefined);
});

test("projectClaimableRecords includes allowlisted rewards and stALGO synthetic claim", () => {
  const positions: PositionRecordV1[] = [
    basePosition({
      protocol: "tinyman",
      positionType: "reward",
      positionId: "tinyman:reward:pool:1:230946361",
      opportunityId: "POOLADDR:farm",
      assetId: 230946361,
      assetSymbol: "TINY",
      amountRaw: "1000000",
      amount: "1",
      usdValue: 0.5,
      inputHints: { programId: 258, poolId: "POOLADDR", assetId: 230946361 }
    }),
    basePosition({
      protocol: "tinyman",
      positionType: "staked",
      positionId: "tinyman:staked:stalgo:1",
      opportunityId: "tinyman-staking-stalgo",
      assetId: 1,
      assetSymbol: "stALGO",
      amountRaw: "1000000",
      amount: "1",
      usdValue: 0.2
    }),
    basePosition({
      protocol: "haystack",
      positionType: "reward",
      positionId: "haystack:reward:app:usdc",
      opportunityId: "haystack-staking-hay",
      assetId: 31566704,
      assetSymbol: "USDC",
      amountRaw: "1500000",
      amount: "1.5",
      usdValue: 1.5
    }),
    basePosition({
      protocol: "haystack",
      positionType: "reward",
      positionId: "haystack:reward:app:hay",
      opportunityId: "haystack-staking-hay",
      assetId: 3160000000,
      assetSymbol: "HAY",
      amountRaw: "25000000",
      amount: "25",
      usdValue: 0.5
    }),
    basePosition({
      protocol: "pact",
      positionType: "reward",
      positionId: "pact:reward:99:1",
      opportunityId: "99:farm",
      assetId: 1,
      assetSymbol: "ASA",
      amountRaw: "100",
      amount: "100",
      usdValue: 2,
      inputHints: { farmAppId: 99, assetId: 1 }
    }),
    basePosition({
      protocol: "pact",
      positionType: "reward",
      positionId: "pact:reward:99:2",
      opportunityId: "99:farm",
      assetId: 2,
      assetSymbol: "ASA2",
      amountRaw: "50",
      amount: "50",
      usdValue: 1,
      inputHints: { farmAppId: 99, assetId: 2 }
    }),
    basePosition({
      protocol: "compx",
      positionType: "reward",
      positionId: "compx:reward:123:31566704",
      opportunityId: "compx-staking-123",
      assetId: 31566704,
      assetSymbol: "USDC",
      amountRaw: "500000",
      amount: "0.5",
      usdValue: 0.5,
      inputHints: { poolAppId: 123, assetId: 31566704 }
    }),
    basePosition({
      protocol: "alpha-arcade",
      positionType: "reward",
      positionId: "alpha-arcade:reward:app:usdc",
      opportunityId: "alpha-arcade-staking-alpha",
      assetId: 31566704,
      assetSymbol: "USDC",
      amountRaw: "100000",
      amount: "0.1",
      usdValue: 0.1
    }),
    basePosition({
      protocol: "reti",
      positionType: "reward",
      positionId: "reti:reward:1:2:3",
      opportunityId: "reti-staking-1",
      assetId: 3,
      amountRaw: "10",
      amount: "10",
      usdValue: 1
    })
  ];

  const records = projectClaimableRecords(positions, VALID_ADDRESS, ALGO_USD);

  assert.equal(records.length, 8);
  assert.ok(records.every((record) => record.protocol !== "reti"));

  const stAlgo = records.find((record) => record.claimKey.includes("stalgo-claim"));
  assert.ok(stAlgo);
  assert.equal(stAlgo.usdValue, null);
  assert.equal(stAlgo.worthClaiming, null);
  assert.deepEqual(stAlgo.compatibleClaimShapeKeys, [TINYMAN_STALGO_CLAIM]);
  assert.equal(stAlgo.quote?.shapeKey, TINYMAN_STALGO_CLAIM);

  const farm = records.find((record) =>
    record.compatibleClaimShapeKeys.includes(TINYMAN_FARM_CLAIM)
  );
  assert.equal(farm?.submitMode, "tinyman-analytics-claim");
  assert.equal(farm?.quote?.input.programId, 258);
  assert.equal(farm?.quote?.input.poolAddress, "POOLADDR");

  const claimAll = buildClaimAllQuotes(records);
  assert.equal(claimAll.quotes.length, 6);
  const shapeKeys = claimAll.quotes.map((quote) => quote.shapeKey).sort();
  assert.deepEqual(shapeKeys, [
    ALPHA_ARCADE_CLAIM,
    COMPX_CLAIM,
    HAYSTACK_CLAIM,
    PACT_FARM_CLAIM,
    TINYMAN_FARM_CLAIM,
    TINYMAN_STALGO_CLAIM
  ].sort());

  const haystackQuotes = claimAll.quotes.filter(
    (quote) => quote.shapeKey === HAYSTACK_CLAIM
  );
  assert.equal(haystackQuotes.length, 1);

  const pactQuotes = claimAll.quotes.filter(
    (quote) => quote.shapeKey === PACT_FARM_CLAIM
  );
  assert.equal(pactQuotes.length, 1);
  assert.equal(pactQuotes[0]?.input.farmAppId, 99);

  const compx = records.find((record) =>
    record.compatibleClaimShapeKeys.includes(COMPX_CLAIM)
  );
  assert.equal(compx?.estimatedNetworkFeeMicroAlgos, "250000");
  assert.equal(compx?.worthClaiming, true);
});

test("worthClaiming is false when reward USD is below CompX fee hint", () => {
  const positions: PositionRecordV1[] = [
    basePosition({
      protocol: "compx",
      positionType: "reward",
      positionId: "compx:reward:1:31566704",
      opportunityId: "compx-staking-1",
      assetId: 31566704,
      assetSymbol: "USDC",
      amountRaw: "1000",
      amount: "0.001",
      usdValue: 0.001,
      inputHints: { poolAppId: 1, assetId: 31566704 }
    })
  ];

  const [record] = projectClaimableRecords(positions, VALID_ADDRESS, ALGO_USD);
  assert.ok(record);
  assert.equal(record.worthClaiming, false);
  // 250000 µAlgo * $0.2 / 1e6 = $0.05
  assert.equal(record.estimatedNetworkFeeUsd, 0.05);
});

test("GET /positions/claimable returns 200 for empty mocked wallet", async () => {
  setCompXSdkDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    createSdk: () => ({ pricing: {} }) as never,
    getTokenPricesFn: async () => ({ "0": ALGO_USD })
  });
  setPositionCollectorsForTests({
    tinyman: async () => ({ positions: [], warnings: [], coverage: {
      suppliedUsdComplete: true,
      borrowedUsdComplete: true,
      rewardsUsdComplete: true
    } }),
    pact: async () => ({ positions: [], warnings: [], coverage: {
      suppliedUsdComplete: true,
      borrowedUsdComplete: true,
      rewardsUsdComplete: true
    } }),
    "folks-finance": async () => ({ positions: [], warnings: [], coverage: {
      suppliedUsdComplete: true,
      borrowedUsdComplete: true,
      rewardsUsdComplete: true
    } }),
    compx: async () => ({ positions: [], warnings: [], coverage: {
      suppliedUsdComplete: true,
      borrowedUsdComplete: true,
      rewardsUsdComplete: true
    } }),
    dorkfi: async () => ({ positions: [], warnings: [], coverage: {
      suppliedUsdComplete: true,
      borrowedUsdComplete: true,
      rewardsUsdComplete: true
    } }),
    "myth-finance": async () => ({ positions: [], warnings: [], coverage: {
      suppliedUsdComplete: true,
      borrowedUsdComplete: true,
      rewardsUsdComplete: true
    } }),
    haystack: async () => ({ positions: [], warnings: [], coverage: {
      suppliedUsdComplete: true,
      borrowedUsdComplete: true,
      rewardsUsdComplete: true
    } }),
    reti: async () => ({ positions: [], warnings: [], coverage: {
      suppliedUsdComplete: true,
      borrowedUsdComplete: true,
      rewardsUsdComplete: true
    } }),
    "alpha-arcade": async () => ({ positions: [], warnings: [], coverage: {
      suppliedUsdComplete: true,
      borrowedUsdComplete: true,
      rewardsUsdComplete: true
    } })
  });

  const app = buildApp();
  await app.ready();
  const response = await app.inject({
    method: "GET",
    url: `/positions/claimable?address=${VALID_ADDRESS}`
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: unknown[];
    claimAllQuotes: { quotes: unknown[] };
    meta: { address: string; paymentRequired: boolean; algoUsd: number | null };
  };
  assert.equal(body.data.length, 0);
  assert.equal(body.claimAllQuotes.quotes.length, 0);
  assert.equal(body.meta.address, VALID_ADDRESS);
  assert.equal(body.meta.paymentRequired, true);
  assert.equal(body.meta.algoUsd, ALGO_USD);
  await app.close();
});

test("GET /positions/claimable rejects invalid Algorand addresses", async () => {
  const app = buildApp();
  await app.ready();
  const response = await app.inject({
    method: "GET",
    url: "/positions/claimable?address=invalid"
  });
  assert.equal(response.statusCode, 400);
  await app.close();
});
