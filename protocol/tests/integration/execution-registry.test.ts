import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import {
  ShapeNotFoundError,
  ShapeValidationError,
  TransactionShapeRegistry,
  buildShapeKey,
  compileExecutableQuote,
  serializeTransaction
} from "../../src/execution/index.js";
import type {
  ShapeBuildContext,
  ShapeValidationResult,
  TransactionShapeSpec
} from "../../src/execution/index.js";

const GENESIS_HASH = new Uint8Array(32).fill(7);

function suggestedParams(fee: number): algosdk.SuggestedParams {
  return {
    fee: BigInt(fee),
    minFee: 1000n,
    firstValid: 1000n,
    lastValid: 2000n,
    genesisID: "testnet-v1.0",
    genesisHash: GENESIS_HASH,
    flatFee: true
  };
}

function dummyContext(now: number): ShapeBuildContext {
  return {
    network: "mainnet",
    algod: new algosdk.Algodv2("", "http://localhost", ""),
    now: () => now,
    quoteTtlMs: 30_000
  };
}

test("buildShapeKey composes a stable network-scoped key", () => {
  const key = buildShapeKey({
    network: "mainnet",
    protocol: "tinyman",
    protocolVersion: "v2",
    action: "addLiquidity",
    variant: "flexible"
  });
  assert.equal(key, "mainnet:tinyman:v2:addLiquidity:flexible");
});

test("registry registers, looks up, and rejects duplicates", () => {
  const registry = new TransactionShapeRegistry();
  const shape = makeFakeShape(true);

  registry.register(shape);
  assert.equal(registry.has(shape.key), true);
  assert.equal(registry.get(shape.key), shape);
  assert.equal(registry.require(shape.key), shape);
  assert.deepEqual(registry.keys(), [shape.key]);
  assert.deepEqual(registry.list(), [shape]);

  assert.throws(() => registry.register(shape), /already registered/);
});

test("registry.require throws ShapeNotFoundError for unknown keys", () => {
  const registry = new TransactionShapeRegistry();
  assert.throws(() => registry.require("missing:key"), ShapeNotFoundError);
});

test("compileExecutableQuote assembles a quote and expiry from a valid shape", async () => {
  const registry = new TransactionShapeRegistry();
  const shape = makeFakeShape(true);
  registry.register(shape);

  const now = Date.UTC(2026, 6, 8, 20, 0, 0);
  const quote = await compileExecutableQuote(registry, shape.key, {}, dummyContext(now));

  assert.equal(quote.shapeKey, shape.key);
  assert.equal(quote.shapeVersion, "9.9.9");
  assert.equal(quote.transactions.length, 1);
  assert.equal(quote.transactions[0]?.type, "pay");
  assert.equal(quote.encodedTransactions.length, 1);
  assert.equal(typeof quote.encodedTransactions[0], "string");
  assert.equal(quote.createdAt, new Date(now).toISOString());
  // Expiry demonstrates staleness is detectable by consumers before execution.
  assert.equal(quote.expiresAt, new Date(now + 30_000).toISOString());
  assert.ok(new Date(quote.expiresAt).getTime() > new Date(quote.createdAt).getTime());
});

test("compileExecutableQuote throws ShapeValidationError when validation fails", async () => {
  const registry = new TransactionShapeRegistry();
  const shape = makeFakeShape(false);
  registry.register(shape);

  await assert.rejects(
    () => compileExecutableQuote(registry, shape.key, {}, dummyContext(Date.now())),
    (error: unknown) => {
      assert.ok(error instanceof ShapeValidationError);
      assert.equal(error.code, "SHAPE_VALIDATION_FAILED");
      return true;
    }
  );
});

test("serializeTransaction stringifies bigints and decodes app args", () => {
  const sender = algosdk.generateAccount();
  const receiver = algosdk.generateAccount();

  const payment = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: sender.addr,
    receiver: receiver.addr,
    amount: 12345n,
    suggestedParams: suggestedParams(1000)
  });
  const serializedPayment = serializeTransaction(payment);
  assert.equal(serializedPayment.type, "pay");
  assert.equal(serializedPayment.sender, sender.addr.toString());
  assert.equal(serializedPayment.fee, "1000");
  assert.equal(serializedPayment.payment?.receiver, receiver.addr.toString());
  assert.equal(serializedPayment.payment?.amount, "12345");

  const appCall = algosdk.makeApplicationCallTxnFromObject({
    sender: sender.addr,
    appIndex: 1002541853n,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [new TextEncoder().encode("add_liquidity"), new TextEncoder().encode("flexible")],
    foreignAssets: [98765n],
    accounts: [receiver.addr],
    suggestedParams: suggestedParams(3000)
  });
  const serializedApp = serializeTransaction(appCall);
  assert.equal(serializedApp.type, "appl");
  assert.equal(serializedApp.applicationCall?.appIndex, "1002541853");
  assert.deepEqual(serializedApp.applicationCall?.appArgsText, ["add_liquidity", "flexible"]);
  assert.deepEqual(serializedApp.applicationCall?.foreignAssets, ["98765"]);
  assert.deepEqual(serializedApp.applicationCall?.accounts, [receiver.addr.toString()]);
});

function makeFakeShape(valid: boolean): TransactionShapeSpec<Record<string, never>, null> {
  const key = "mainnet:tinyman:v2:fake:variant";
  return {
    identity: {
      network: "mainnet",
      protocol: "tinyman",
      protocolVersion: "v2",
      action: "fake",
      variant: "variant"
    },
    key,
    shapeVersion: "9.9.9",
    title: "Fake shape",
    description: "Fake shape for registry orchestration tests.",
    supportedOpportunityTypes: ["lp"],
    requiredInputs: [],
    sources: [{ kind: "docs", description: "n/a" }],
    parseInput: () => ({}),
    resolveState: async () => null,
    build: async () => {
      const sender = algosdk.generateAccount();
      const receiver = algosdk.generateAccount();
      const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: sender.addr,
        receiver: receiver.addr,
        amount: 1n,
        suggestedParams: suggestedParams(1000)
      });
      algosdk.assignGroupID([txn]);
      return { transactions: [txn], metadata: { synthetic: true } };
    },
    validate: (): ShapeValidationResult => ({
      valid,
      errors: valid ? [] : ["forced validation failure"],
      warnings: []
    })
  };
}
