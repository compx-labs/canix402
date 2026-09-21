import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import {
  TransactionShapeRegistry,
  compileExecutableQuote,
  executionRegistry,
  morphoVaultDepositShape,
  morphoVaultRedeemShape,
  morphoVaultWithdrawShape,
  setMorphoVaultStateDependenciesForTests
} from "../../src/execution/index.js";
import type { EvmRpcClient, ShapeBuildContext } from "../../src/execution/index.js";
import { BASE_CHAIN_ID } from "../../src/execution/evm.js";
import { attachExecutionShapesToOpportunity } from "../../src/services/opportunity-execution-shapes.js";
import type { OpportunityMarketRecord } from "../../src/types/opportunity.js";

const USER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const VAULT = "0xef417a2512c5a41f69ae4e021648b69a7cde5d03";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

const stubEvm: EvmRpcClient = {
  chainId: BASE_CHAIN_ID,
  async call() {
    throw new Error("live RPC must not be used in Morpho shape fixtures");
  }
};

function context(): ShapeBuildContext {
  return {
    network: "mainnet",
    algod: new algosdk.Algodv2("", "http://localhost", ""),
    evm: stubEvm,
    now: () => Date.UTC(2026, 8, 21, 10, 0, 0)
  };
}

test.afterEach(() => {
  setMorphoVaultStateDependenciesForTests(undefined);
});

test("Morpho vault opportunities attach deposit enter and withdraw/redeem exits", () => {
  const record: OpportunityMarketRecord = {
    protocol: "morpho",
    opportunityType: "lending",
    opportunityId: `morpho-vault-${VAULT}`,
    assetPair: "USDC",
    chain: "base",
    assetAddresses: [USDC],
    poolId: VAULT,
    apy: 4.66,
    yieldBasis: "apy",
    tvlUsd: 2_000_000,
    sourceTimestamp: "2026-09-21T10:00:00.000Z",
    fetchedAt: "2026-09-21T10:00:00.000Z"
  };

  const enriched = attachExecutionShapesToOpportunity(record, executionRegistry);
  assert.equal(enriched.chain, "base");
  assert.equal(enriched.executionReady, true);
  assert.deepEqual(
    enriched.executionShapes.map((shape) => shape.shapeKey),
    ["base:morpho:vault:deposit:erc4626"]
  );
  assert.equal(enriched.executionShapes[0]?.inputHints?.poolId, VAULT);
  assert.equal(enriched.executionShapes[0]?.inputHints?.assetAddress, USDC);
  assert.equal("poolId" in enriched, false);
  assert.deepEqual(
    enriched.compatibleExitShapes.map((shape) => shape.shapeKey),
    ["base:morpho:vault:withdraw:erc4626", "base:morpho:vault:redeem:erc4626"]
  );
});

test("base:morpho:vault:deposit:erc4626 compiles unsigned approve + deposit", async () => {
  setMorphoVaultStateDependenciesForTests({
    resolveVaultAsset: async () => USDC,
    readAllowance: async () => 0n,
    previewDeposit: async (_client, _vault, assets) => assets
  });
  const registry = new TransactionShapeRegistry();
  registry.register(morphoVaultDepositShape);
  const quote = await compileExecutableQuote(
    registry,
    "base:morpho:vault:deposit:erc4626",
    { userAddress: USER, vaultAddress: VAULT, amount: "1000000" },
    context()
  );
  assert.equal(quote.shapeKey, "base:morpho:vault:deposit:erc4626");
  assert.equal(quote.encodedTransactions.length, 2);
});

test("base:morpho:vault:withdraw:erc4626 compiles a single vault call", async () => {
  setMorphoVaultStateDependenciesForTests({
    resolveVaultAsset: async () => USDC,
    previewWithdraw: async (_client, _vault, assets) => assets
  });
  const registry = new TransactionShapeRegistry();
  registry.register(morphoVaultWithdrawShape);
  const quote = await compileExecutableQuote(
    registry,
    "base:morpho:vault:withdraw:erc4626",
    { userAddress: USER, vaultAddress: VAULT, amount: "1000000" },
    context()
  );
  assert.equal(quote.shapeKey, "base:morpho:vault:withdraw:erc4626");
  assert.equal(quote.encodedTransactions.length, 1);
});

test("base:morpho:vault:redeem:erc4626 compiles a single vault call", async () => {
  setMorphoVaultStateDependenciesForTests({
    resolveVaultAsset: async () => USDC,
    previewRedeem: async (_client, _vault, shares) => shares
  });
  const registry = new TransactionShapeRegistry();
  registry.register(morphoVaultRedeemShape);
  const quote = await compileExecutableQuote(
    registry,
    "base:morpho:vault:redeem:erc4626",
    { userAddress: USER, vaultAddress: VAULT, shares: "1000000" },
    context()
  );
  assert.equal(quote.shapeKey, "base:morpho:vault:redeem:erc4626");
  assert.equal(quote.encodedTransactions.length, 1);
});
