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
