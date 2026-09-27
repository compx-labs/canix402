import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import { AERODROME_POOL_FACTORY } from "../../src/adapters/aerodrome.js";
import {
  aerodromeDepositShape,
  compileExecutableQuote,
  executionRegistry,
  setAerodromeStateDependenciesForTests
} from "../../src/execution/index.js";
import type { EvmRpcClient, ShapeBuildContext } from "../../src/execution/index.js";
import { BASE_CHAIN_ID } from "../../src/execution/evm.js";
import { attachExecutionShapesToOpportunity } from "../../src/services/opportunity-execution-shapes.js";
import { attachExecutionShapesToPosition } from "../../src/services/position-execution-shapes.js";
import type { OpportunityMarketRecord } from "../../src/types/opportunity.js";
import {
  AERO_GAUGE,
  AERO_POOL,
  AERO_TOKEN0,
  AERO_TOKEN1
} from "../fixtures/adapters/aerodrome-pools.js";

const USER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const stubEvm: EvmRpcClient = {
  chainId: BASE_CHAIN_ID,
  async call() {
    throw new Error("live RPC must not be used in Aerodrome shape fixtures");
  }
};

function context(): ShapeBuildContext {
  return {
    network: "mainnet",
    algod: new algosdk.Algodv2("", "http://localhost", ""),
    evm: stubEvm,
    now: () => Date.UTC(2026, 8, 22, 10, 0, 0)
  };
}

test.afterEach(() => {
  setAerodromeStateDependenciesForTests(undefined);
});

test("Aerodrome farm rows attach deposit enter and withdraw exit", () => {
  const record: OpportunityMarketRecord = {
    protocol: "aerodrome",
    opportunityType: "farm",
    opportunityId: `aerodrome-farm-${AERO_POOL}`,
    assetPair: "WETH/USDC",
    chain: "base",
    assetAddresses: [AERO_TOKEN0, AERO_TOKEN1],
    poolId: AERO_POOL,
    apy: 12,
    yieldBasis: "apy",
    tvlUsd: 80_000,
    sourceTimestamp: "2026-09-22T10:00:00.000Z",
    fetchedAt: "2026-09-22T10:00:00.000Z"
  };

  const enriched = attachExecutionShapesToOpportunity(record, executionRegistry);
  assert.equal(enriched.chain, "base");
  assert.equal(enriched.executionReady, true);
  assert.deepEqual(
    enriched.executionShapes.map((shape) => shape.shapeKey),
    ["base:aerodrome:v2:deposit:gauge"]
  );
  assert.equal(enriched.executionShapes[0]?.inputHints?.poolId, AERO_POOL);
  assert.deepEqual(
    enriched.compatibleExitShapes.map((shape) => shape.shapeKey),
    ["base:aerodrome:v2:withdraw:gauge"]
  );
  assert.equal(enriched.compatibleExitShapes[0]?.inputHints?.poolId, AERO_POOL);
});

test("a staked Aerodrome position exits through withdraw-gauge", () => {
  const position = attachExecutionShapesToPosition({
    protocol: "aerodrome",
    positionType: "staked",
    positionId: `aerodrome:staked:${AERO_POOL}`,
    opportunityId: `aerodrome-farm-${AERO_POOL}`,
    assetId: null,
    assetSymbol: "WETH/USDC",
    amountRaw: "10",
    amount: "10",
    usdValue: 100,
    inputHints: { poolId: AERO_POOL }
  });
  assert.deepEqual(position.compatibleExitShapeKeys, ["base:aerodrome:v2:withdraw:gauge"]);
  assert.deepEqual(position.compatibleManageShapeKeys, []);
});

test("base:aerodrome:v2:deposit:gauge compiles through the execution registry", async () => {
  setAerodromeStateDependenciesForTests({
    readPool: async () => ({
      token0: AERO_TOKEN0,
      token1: AERO_TOKEN1,
      stable: false,
      factory: AERODROME_POOL_FACTORY,
      gauge: AERO_GAUGE,
      alive: true
    }),
    readAllowance: async () => 0n,
    quoteAdd: async () => ({ amountA: 10n, amountB: 20n, liquidity: 5n })
  });
  const quote = await compileExecutableQuote(
    executionRegistry,
    aerodromeDepositShape.key,
    {
      userAddress: USER,
      poolId: AERO_POOL,
      amountA: "10",
      amountB: "20"
    },
    context()
  );
  assert.equal(quote.chain, "base");
  assert.ok(quote.transactions.some((txn) => txn.evmCall?.to === AERO_GAUGE));
});
