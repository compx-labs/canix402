import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import {
  TransactionShapeRegistry,
  compileExecutableQuote,
  morphoVaultDepositShape,
  morphoVaultRedeemShape,
  morphoVaultWithdrawShape,
  setMorphoVaultStateDependenciesForTests
} from "../../src/execution/index.js";
import type { EvmRpcClient, ShapeBuildContext } from "../../src/execution/index.js";
import { BASE_CHAIN_ID } from "../../src/execution/evm.js";

const USER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const VAULT = "0xef417a2512c5a41f69ae4e021648b69a7cde5d03";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const AMOUNT = 1_000_000n;

const stubEvm: EvmRpcClient = {
  chainId: BASE_CHAIN_ID,
  async call() {
    throw new Error("live RPC must not be used in Morpho unit tests");
  }
};

function context(): ShapeBuildContext {
  return {
    network: "mainnet",
    algod: new algosdk.Algodv2("", "http://localhost", ""),
    evm: stubEvm,
    now: () => Date.UTC(2026, 8, 21, 10, 0, 0),
    quoteTtlMs: 30_000
  };
}

test.afterEach(() => {
  setMorphoVaultStateDependenciesForTests(undefined);
});

test("deposit shape encodes approve + deposit when allowance is insufficient", async () => {
  setMorphoVaultStateDependenciesForTests({
    resolveVaultAsset: async () => USDC,
    readAllowance: async () => 0n,
    previewDeposit: async (_client, _vault, assets) => assets
  });

  const registry = new TransactionShapeRegistry();
  registry.register(morphoVaultDepositShape);
  const quote = await compileExecutableQuote(
    registry,
    morphoVaultDepositShape.key,
    { userAddress: USER, vaultAddress: VAULT, amount: AMOUNT.toString() },
    context()
  );

  assert.equal(quote.identity.network, "base");
  assert.equal(quote.chain, "base");
  assert.equal(quote.transactions.length, 2);
  assert.equal(quote.transactions[0]?.type, "evm");
  assert.equal(quote.transactions[0]?.evmCall?.to, USDC);
  assert.ok(quote.encodedTransactions[0]?.startsWith("0x095ea7b3"));
  assert.equal(quote.transactions[1]?.evmCall?.to, VAULT);
  assert.ok(quote.encodedTransactions[1]?.startsWith("0x6e553f65"));
  assert.equal(quote.metadata.needsApprove, true);
  assert.equal(quote.metadata.previewShares, AMOUNT.toString());
});

test("deposit shape skips approve when allowance covers assets", async () => {
  setMorphoVaultStateDependenciesForTests({
    resolveVaultAsset: async () => USDC,
    readAllowance: async () => AMOUNT,
    previewDeposit: async (_client, _vault, assets) => assets
  });

  const registry = new TransactionShapeRegistry();
  registry.register(morphoVaultDepositShape);
  const quote = await compileExecutableQuote(
    registry,
    morphoVaultDepositShape.key,
    { userAddress: USER, poolId: VAULT, amount: AMOUNT.toString() },
    context()
  );

  assert.equal(quote.transactions.length, 1);
  assert.equal(quote.encodedTransactions.length, 1);
  assert.ok(quote.encodedTransactions[0]?.startsWith("0x6e553f65"));
  assert.equal(quote.metadata.needsApprove, false);
});

test("withdraw and redeem shapes encode a single vault call", async () => {
  setMorphoVaultStateDependenciesForTests({
    resolveVaultAsset: async () => USDC,
    previewWithdraw: async (_client, _vault, assets) => assets,
    previewRedeem: async (_client, _vault, shares) => shares
  });

  const registry = new TransactionShapeRegistry();
  registry.register(morphoVaultWithdrawShape);
  registry.register(morphoVaultRedeemShape);

  const withdraw = await compileExecutableQuote(
    registry,
    morphoVaultWithdrawShape.key,
    { userAddress: USER, vaultAddress: VAULT, amount: AMOUNT.toString() },
    context()
  );
  assert.equal(withdraw.transactions.length, 1);
  assert.ok(withdraw.encodedTransactions[0]?.startsWith("0xb460af94"));
  assert.equal(withdraw.chain, "base");

  const redeem = await compileExecutableQuote(
    registry,
    morphoVaultRedeemShape.key,
    { userAddress: USER, vaultAddress: VAULT, shares: AMOUNT.toString() },
    context()
  );
  assert.equal(redeem.transactions.length, 1);
  assert.ok(redeem.encodedTransactions[0]?.startsWith("0xba087652"));
});
