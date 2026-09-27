import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import { AAVE_V3_BASE_POOL } from "../../src/adapters/aave.js";
import {
  TransactionShapeRegistry,
  aaveBorrowShape,
  aaveRepayShape,
  aaveSupplyShape,
  aaveWithdrawShape,
  compileExecutableQuote,
  setAaveStateDependenciesForTests
} from "../../src/execution/index.js";
import type { EvmRpcClient, ShapeBuildContext } from "../../src/execution/index.js";
import { BASE_CHAIN_ID } from "../../src/execution/evm.js";
import { ShapeStateError } from "../../src/execution/errors.js";
import { readReserveFlags } from "../../src/execution/shapes/aave/shared.js";
import type { AaveReserveFlags } from "../../src/execution/shapes/aave/shared.js";

const USER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const AMOUNT = 1_000_000n;

const OPEN_FLAGS: AaveReserveFlags = {
  active: true,
  frozen: false,
  paused: false,
  borrowingEnabled: true
};

const stubEvm: EvmRpcClient = {
  chainId: BASE_CHAIN_ID,
  async call() {
    throw new Error("live RPC must not be used in Aave unit tests");
  }
};

function context(): ShapeBuildContext {
  return {
    network: "mainnet",
    algod: new algosdk.Algodv2("", "http://localhost", ""),
    evm: stubEvm,
    now: () => Date.UTC(2026, 8, 22, 10, 0, 0),
    quoteTtlMs: 30_000
  };
}

test.afterEach(() => {
  setAaveStateDependenciesForTests(undefined);
});

test("supply shape encodes approve plus Pool.supply when allowance is short", async () => {
  setAaveStateDependenciesForTests({
    readReserveFlags: async () => OPEN_FLAGS,
    readAllowance: async () => 0n
  });
  const registry = new TransactionShapeRegistry();
  registry.register(aaveSupplyShape);
  const quote = await compileExecutableQuote(
    registry,
    aaveSupplyShape.key,
    { userAddress: USER, poolId: USDC, amount: AMOUNT.toString() },
    context()
  );

  assert.equal(quote.identity.network, "base");
  assert.equal(quote.chain, "base");
  assert.equal(quote.transactions.length, 2);
  assert.equal(quote.transactions[0]?.evmCall?.to, USDC);
  assert.ok(quote.encodedTransactions[0]?.startsWith("0x095ea7b3"));
  assert.equal(quote.transactions[1]?.evmCall?.to, AAVE_V3_BASE_POOL);
  assert.ok(quote.encodedTransactions[1]?.startsWith("0x617ba037"));
  assert.equal(quote.metadata.needsApprove, true);
});

test("supply shape skips approve when allowance covers the amount", async () => {
  setAaveStateDependenciesForTests({
    readReserveFlags: async () => OPEN_FLAGS,
    readAllowance: async () => AMOUNT
  });
  const registry = new TransactionShapeRegistry();
  registry.register(aaveSupplyShape);
  const quote = await compileExecutableQuote(
    registry,
    aaveSupplyShape.key,
    { userAddress: USER, assetAddress: USDC, amount: AMOUNT.toString() },
    context()
  );
  assert.equal(quote.transactions.length, 1);
  assert.ok(quote.encodedTransactions[0]?.startsWith("0x617ba037"));
});

test("withdraw, borrow, and repay encode Pool selectors", async () => {
  setAaveStateDependenciesForTests({
    readReserveFlags: async () => OPEN_FLAGS,
    readAllowance: async () => 0n
  });
  const registry = new TransactionShapeRegistry();
  registry.register(aaveWithdrawShape);
  registry.register(aaveBorrowShape);
  registry.register(aaveRepayShape);

  const withdraw = await compileExecutableQuote(
    registry,
    aaveWithdrawShape.key,
    { userAddress: USER, assetAddress: USDC, amount: AMOUNT.toString() },
    context()
  );
  assert.equal(withdraw.transactions.length, 1);
  assert.ok(withdraw.encodedTransactions[0]?.startsWith("0x69328dec"));

  const borrow = await compileExecutableQuote(
    registry,
    aaveBorrowShape.key,
    { userAddress: USER, assetAddress: USDC, amount: AMOUNT.toString() },
    context()
  );
  assert.equal(borrow.transactions.length, 1);
  assert.ok(borrow.encodedTransactions[0]?.startsWith("0xa415bcad"));
  const data = borrow.encodedTransactions[0] ?? "";
  const mode = data.slice(2 + 8 + 64 + 64, 2 + 8 + 64 + 64 + 64);
  assert.equal(mode, "2".padStart(64, "0"));

  const repay = await compileExecutableQuote(
    registry,
    aaveRepayShape.key,
    { userAddress: USER, assetAddress: USDC, amount: AMOUNT.toString() },
    context()
  );
  assert.equal(repay.transactions.length, 2);
  assert.ok(repay.encodedTransactions[1]?.startsWith("0x573ade81"));
});

test("paused reserves and disabled borrowing are rejected at quote time", async () => {
  const registry = new TransactionShapeRegistry();
  registry.register(aaveSupplyShape);
  registry.register(aaveBorrowShape);

  setAaveStateDependenciesForTests({
    readReserveFlags: async () => ({ ...OPEN_FLAGS, paused: true }),
    readAllowance: async () => 0n
  });
  await assert.rejects(
    () =>
      compileExecutableQuote(
        registry,
        aaveSupplyShape.key,
        { userAddress: USER, assetAddress: USDC, amount: AMOUNT.toString() },
        context()
      ),
    (error: unknown) => error instanceof ShapeStateError && /paused/.test(error.message)
  );

  setAaveStateDependenciesForTests({
    readReserveFlags: async () => ({ ...OPEN_FLAGS, borrowingEnabled: false }),
    readAllowance: async () => 0n
  });
  await assert.rejects(
    () =>
      compileExecutableQuote(
        registry,
        aaveBorrowShape.key,
        { userAddress: USER, assetAddress: USDC, amount: AMOUNT.toString() },
        context()
      ),
    (error: unknown) =>
      error instanceof ShapeStateError && /borrowing is disabled/.test(error.message)
  );
});

test("readReserveFlags decodes the Aave configuration bitmap", async () => {
  const data = (1n << 56n) | (1n << 58n);
  const client: EvmRpcClient = {
    chainId: BASE_CHAIN_ID,
    async call() {
      return `0x${data.toString(16).padStart(64, "0")}`;
    }
  };
  const flags = await readReserveFlags(client, USDC);
  assert.deepEqual(flags, {
    active: true,
    frozen: false,
    paused: false,
    borrowingEnabled: true
  });
});
