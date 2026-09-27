import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import {
  AERODROME_POOL_FACTORY,
  AERODROME_ROUTER
} from "../../src/adapters/aerodrome.js";
import {
  TransactionShapeRegistry,
  aerodromeDepositShape,
  aerodromeWithdrawShape,
  compileExecutableQuote,
  setAerodromeStateDependenciesForTests
} from "../../src/execution/index.js";
import type { EvmRpcClient, ShapeBuildContext } from "../../src/execution/index.js";
import { BASE_CHAIN_ID } from "../../src/execution/evm.js";
import { ShapeStateError } from "../../src/execution/errors.js";
import type { AerodromePoolView } from "../../src/execution/shapes/aerodrome/shared.js";
import {
  AERO_GAUGE,
  AERO_POOL,
  AERO_TOKEN0,
  AERO_TOKEN1
} from "../fixtures/adapters/aerodrome-pools.js";

const USER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const LIVE_POOL: AerodromePoolView = {
  token0: AERO_TOKEN0,
  token1: AERO_TOKEN1,
  stable: false,
  factory: AERODROME_POOL_FACTORY,
  gauge: AERO_GAUGE,
  alive: true
};

const stubEvm: EvmRpcClient = {
  chainId: BASE_CHAIN_ID,
  async call() {
    throw new Error("live RPC must not be used in Aerodrome unit tests");
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
  setAerodromeStateDependenciesForTests(undefined);
});

test("deposit shape encodes approves, addLiquidity, and gauge deposit", async () => {
  setAerodromeStateDependenciesForTests({
    readPool: async () => LIVE_POOL,
    readAllowance: async () => 0n,
    quoteAdd: async () => ({ amountA: 100n, amountB: 200n, liquidity: 50n })
  });
  const registry = new TransactionShapeRegistry();
  registry.register(aerodromeDepositShape);
  const quote = await compileExecutableQuote(
    registry,
    aerodromeDepositShape.key,
    {
      userAddress: USER,
      poolId: AERO_POOL,
      amountA: "1000",
      amountB: "2000"
    },
    context()
  );

  assert.equal(quote.identity.network, "base");
  assert.equal(quote.transactions.length, 5);
  assert.equal(quote.transactions[0]?.evmCall?.to, AERO_TOKEN0);
  assert.ok(quote.encodedTransactions[0]?.startsWith("0x095ea7b3"));
  assert.equal(quote.transactions[1]?.evmCall?.to, AERO_TOKEN1);
  assert.equal(quote.transactions[2]?.evmCall?.to, AERODROME_ROUTER);
  assert.ok(quote.encodedTransactions[2]?.startsWith("0x5a47ddc3"));
  assert.equal(quote.transactions[3]?.evmCall?.to, AERO_POOL);
  assert.equal(quote.transactions[4]?.evmCall?.to, AERO_GAUGE);
  assert.ok(quote.encodedTransactions[4]?.startsWith("0xb6b55f25"));
  assert.equal(quote.metadata.liquidity, "50");
  assert.equal(quote.metadata.amountAMin, "99");
  assert.equal(quote.metadata.amountBMin, "199");
});

test("deposit shape skips token approves when allowance covers the desired amounts", async () => {
  setAerodromeStateDependenciesForTests({
    readPool: async () => LIVE_POOL,
    readAllowance: async (_client, token) => (token === AERO_POOL ? 0n : 10_000n),
    quoteAdd: async () => ({ amountA: 100n, amountB: 200n, liquidity: 50n })
  });
  const registry = new TransactionShapeRegistry();
  registry.register(aerodromeDepositShape);
  const quote = await compileExecutableQuote(
    registry,
    aerodromeDepositShape.key,
    {
      userAddress: USER,
      poolId: AERO_POOL,
      amountA: "1000",
      amountB: "2000"
    },
    context()
  );
  assert.equal(quote.transactions.length, 3);
  assert.equal(quote.transactions[0]?.evmCall?.to, AERODROME_ROUTER);
  assert.equal(quote.transactions[2]?.evmCall?.to, AERO_GAUGE);
});

test("withdraw shape encodes gauge withdraw, LP approve, and removeLiquidity", async () => {
  setAerodromeStateDependenciesForTests({
    readPool: async () => LIVE_POOL,
    readAllowance: async () => 0n,
    quoteRemove: async () => ({ amountA: 80n, amountB: 160n })
  });
  const registry = new TransactionShapeRegistry();
  registry.register(aerodromeWithdrawShape);
  const quote = await compileExecutableQuote(
    registry,
    aerodromeWithdrawShape.key,
    { userAddress: USER, poolId: AERO_POOL, liquidity: "40" },
    context()
  );
  assert.equal(quote.transactions.length, 3);
  assert.equal(quote.transactions[0]?.evmCall?.to, AERO_GAUGE);
  assert.ok(quote.encodedTransactions[0]?.startsWith("0x2e1a7d4d"));
  assert.equal(quote.transactions[1]?.evmCall?.to, AERO_POOL);
  assert.equal(quote.transactions[2]?.evmCall?.to, AERODROME_ROUTER);
  assert.ok(quote.encodedTransactions[2]?.startsWith("0x0dede6c4"));
  assert.equal(quote.metadata.amountAMin, "79");
  assert.equal(quote.metadata.amountBMin, "159");
});

test("a dead gauge is rejected", async () => {
  setAerodromeStateDependenciesForTests({
    readPool: async () => ({ ...LIVE_POOL, alive: false })
  });
  const registry = new TransactionShapeRegistry();
  registry.register(aerodromeDepositShape);
  await assert.rejects(
    () =>
      compileExecutableQuote(
        registry,
        aerodromeDepositShape.key,
        {
          userAddress: USER,
          poolId: AERO_POOL,
          amountA: "1000",
          amountB: "2000"
        },
        context()
      ),
    ShapeStateError
  );
});
