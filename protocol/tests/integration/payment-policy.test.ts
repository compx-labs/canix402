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
  assert.match(shapes?.description ?? "", /protocol-caveats/);
  assert.match(quotes?.description ?? "", /protocol-caveats/);
});

test("ready and metrics are free system routes", () => {
  assert.equal(classifyEndpointAccess("/ready", "GET"), "free");
  assert.equal(classifyEndpointAccess("/metrics", "GET"), "free");
  assert.ok(endpointPolicyMatrix.some((endpoint) => endpoint.id === "ready"));
  assert.ok(endpointPolicyMatrix.some((endpoint) => endpoint.id === "metrics"));
});

test("eligibility is a dedicated paid POST route", () => {
  assert.equal(classifyEndpointAccess("/eligibility", "POST"), "paid");
  const eligibility = endpointPolicyMatrix.find((endpoint) => endpoint.id === "eligibility");
  assert.equal(eligibility?.method, "POST");
  assert.equal(eligibility?.access, "paid");
  assert.equal(eligibility?.pathPattern, "/eligibility");
  assert.equal(
    eligibility?.priceUsdc,
    process.env.X402_PRICE_ELIGIBILITY_USDC ?? "0.01"
  );
});

test("plans is a dedicated paid compiler POST route", () => {
  assert.equal(classifyEndpointAccess("/plans", "POST"), "paid");
  const plans = endpointPolicyMatrix.find((endpoint) => endpoint.id === "plans");
  assert.equal(plans?.method, "POST");
  assert.equal(plans?.access, "paid");
  assert.equal(plans?.pathPattern, "/plans");
  assert.equal(plans?.priceUsdc, process.env.X402_PRICE_PLANS_USDC ?? "0.25");
});

test("plans rebalance is a dedicated paid compiler POST route", () => {
  assert.equal(classifyEndpointAccess("/plans/rebalance", "POST"), "paid");
  const rebalance = endpointPolicyMatrix.find((endpoint) => endpoint.id === "plansRebalance");
  assert.equal(rebalance?.method, "POST");
  assert.equal(rebalance?.access, "paid");
  assert.equal(rebalance?.pathPattern, "/plans/rebalance");
  assert.equal(
    rebalance?.priceUsdc,
    process.env.X402_PRICE_PLANS_REBALANCE_USDC ?? "0.25"
  );
});

test("execution compose is a dedicated paid compiler POST route", () => {
  assert.equal(classifyEndpointAccess("/execution/compose", "POST"), "paid");
  const compose = endpointPolicyMatrix.find((endpoint) => endpoint.id === "executionCompose");
  assert.equal(compose?.method, "POST");
  assert.equal(compose?.access, "paid");
  assert.equal(compose?.pathPattern, "/execution/compose");
  assert.equal(
    compose?.priceUsdc,
    process.env.X402_PRICE_EXECUTION_COMPOSE_USDC ?? "0.1"
  );
});

test("Brownie showcase positions are free while arbitrary /positions stays paid", () => {
  assert.equal(
    classifyEndpointAccess("/public/agents/brownie/positions", "GET"),
    "free"
  );
  assert.equal(classifyEndpointAccess("/positions", "GET"), "paid");
  assert.equal(classifyEndpointAccess("/positions/claimable", "GET"), "paid");
  const showcase = endpointPolicyMatrix.find(
    (endpoint) => endpoint.id === "publicBrowniePositions"
  );
  assert.equal(showcase?.access, "free");
  assert.equal(showcase?.pathPattern, "/public/agents/brownie/positions");

  const claimable = endpointPolicyMatrix.find(
    (endpoint) => endpoint.id === "positionsClaimable"
  );
  assert.equal(claimable?.access, "paid");
  assert.equal(claimable?.pathPattern, "/positions/claimable");
  assert.equal(
    claimable?.priceUsdc,
    process.env.X402_PRICE_POSITIONS_CLAIMABLE_USDC ?? "0.001"
  );
});
