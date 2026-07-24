import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyEndpointAccess,
  endpointPolicyMatrix
} from "../../src/services/payment-policy.js";

test("Haystack quote and opt-in are free while transaction generation is paid", () => {
  assert.equal(classifyEndpointAccess("/swaps/quote"), "free");
  assert.equal(classifyEndpointAccess("/swaps/optin"), "free");
  assert.equal(classifyEndpointAccess("/swaps/transactions"), "paid");
  assert.equal(classifyEndpointAccess("/swaps"), "unknown");
});

test("Haystack swap policy advertises the dedicated 0.005 USDC price", () => {
  const quote = endpointPolicyMatrix.find((endpoint) => endpoint.id === "haystackSwapQuote");
  const optIn = endpointPolicyMatrix.find((endpoint) => endpoint.id === "haystackSwapOptIn");
  const transactions = endpointPolicyMatrix.find(
    (endpoint) => endpoint.id === "haystackSwapTransactions"
  );

  assert.equal(quote?.method, "POST");
  assert.equal(quote?.access, "free");
  assert.equal(optIn?.method, "POST");
  assert.equal(optIn?.access, "free");
  assert.equal(transactions?.method, "POST");
  assert.equal(transactions?.access, "paid");
  assert.equal(transactions?.priceUsdc, process.env.X402_PRICE_HAYSTACK_SWAP_USDC ?? "0.005");
});

test("execution shapes catalog is free while quote compile remains paid", () => {
  assert.equal(classifyEndpointAccess("/execution/shapes", "GET"), "free");
  assert.equal(classifyEndpointAccess("/execution/quotes", "POST"), "paid");

  const shapes = endpointPolicyMatrix.find((endpoint) => endpoint.id === "executionShapes");
  const quotes = endpointPolicyMatrix.find((endpoint) => endpoint.id === "executionQuote");
  assert.equal(shapes?.method, "GET");
  assert.equal(shapes?.access, "free");
  assert.equal(quotes?.method, "POST");
  assert.equal(quotes?.access, "paid");
});

test("strategy marketplace policy is method-aware with publish/revise/compile prices", () => {
  assert.equal(classifyEndpointAccess("/strategies", "GET"), "free");
  assert.equal(classifyEndpointAccess("/strategies", "POST"), "paid");
  assert.equal(classifyEndpointAccess("/strategies/42", "GET"), "free");
  assert.equal(classifyEndpointAccess("/strategies/42", "POST"), "paid");
  assert.equal(classifyEndpointAccess("/strategies/42/compile"), "paid");

  const publish = endpointPolicyMatrix.find((endpoint) => endpoint.id === "strategyPublish");
  const revise = endpointPolicyMatrix.find((endpoint) => endpoint.id === "strategyRevise");
  const compile = endpointPolicyMatrix.find((endpoint) => endpoint.id === "strategyCompile");
  assert.equal(publish?.priceUsdc, process.env.X402_PRICE_STRATEGY_PUBLISH_USDC ?? "100");
  assert.equal(revise?.priceUsdc, process.env.X402_PRICE_STRATEGY_REVISE_USDC ?? "1");
  assert.equal(compile?.priceUsdc, process.env.X402_PRICE_STRATEGY_COMPILE_USDC ?? "0.1");
});

test("ready and metrics are free system routes", () => {
  assert.equal(classifyEndpointAccess("/ready", "GET"), "free");
  assert.equal(classifyEndpointAccess("/metrics", "GET"), "free");
  assert.ok(endpointPolicyMatrix.some((endpoint) => endpoint.id === "ready"));
  assert.ok(endpointPolicyMatrix.some((endpoint) => endpoint.id === "metrics"));
});
