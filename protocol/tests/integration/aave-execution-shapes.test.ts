import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import {
  TransactionShapeRegistry,
  aaveSupplyShape,
  compileExecutableQuote,
  executionRegistry,
  setAaveStateDependenciesForTests
} from "../../src/execution/index.js";
import type { EvmRpcClient, ShapeBuildContext } from "../../src/execution/index.js";
import { BASE_CHAIN_ID } from "../../src/execution/evm.js";
import { attachExecutionShapesToOpportunity } from "../../src/services/opportunity-execution-shapes.js";
import type { OpportunityMarketRecord } from "../../src/types/opportunity.js";

const USER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

const stubEvm: EvmRpcClient = {
  chainId: BASE_CHAIN_ID,
  async call() {
    throw new Error("live RPC must not be used in Aave shape fixtures");
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
  setAaveStateDependenciesForTests(undefined);
});

test("Aave lending opportunities attach supply enter and withdraw exit", () => {
  const record: OpportunityMarketRecord = {
    protocol: "aave",
    opportunityType: "lending",
    opportunityId: `aave-lending-${USDC}`,
    assetPair: "USDC",
    chain: "base",
    assetAddresses: [USDC],
    poolId: USDC,
    apy: 3.81,
    borrowApr: 4.77,
    yieldBasis: "apy",
    tvlUsd: 179_000_000,
    sourceTimestamp: "2026-09-22T10:00:00.000Z",
    fetchedAt: "2026-09-22T10:00:00.000Z"
  };

  const enriched = attachExecutionShapesToOpportunity(record, executionRegistry);
  assert.equal(enriched.chain, "base");
  assert.equal(enriched.executionReady, true);
  assert.deepEqual(
    enriched.executionShapes.map((shape) => shape.shapeKey),
    ["base:aave:v3:supply:erc20"]
  );
  assert.equal(enriched.executionShapes[0]?.inputHints?.poolId, USDC);
  assert.equal(enriched.executionShapes[0]?.inputHints?.assetAddress, USDC);
  assert.deepEqual(
    enriched.compatibleExitShapes.map((shape) => shape.shapeKey),
    ["base:aave:v3:withdraw:erc20"]
  );
  assert.equal(
    enriched.executionShapes.some((shape) => shape.shapeKey.includes("borrow")),
    false
  );
});

test("base:aave:v3:supply:erc20 compiles through the execution registry", async () => {
  setAaveStateDependenciesForTests({
    readReserveFlags: async () => ({
      active: true,
      frozen: false,
      paused: false,
      borrowingEnabled: true
    }),
    readAllowance: async () => 0n
  });
  const registry = new TransactionShapeRegistry();
  registry.register(aaveSupplyShape);
  const quote = await compileExecutableQuote(
    registry,
    "base:aave:v3:supply:erc20",
    { userAddress: USER, assetAddress: USDC, amount: "1000000" },
    context()
  );
  assert.equal(quote.shapeKey, "base:aave:v3:supply:erc20");
  assert.equal(quote.encodedTransactions.length, 2);
});
