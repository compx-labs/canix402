import assert from "node:assert/strict";
import test from "node:test";

import {
  productionFreeEndpoints,
  productionPaidEndpoints
} from "../helpers/productionEndpoints.js";

test("production smoke posts Haystack quote and opt-in instead of GET", () => {
  const quote = productionFreeEndpoints.find((endpoint) => endpoint.id === "haystackSwapQuote");
  const optIn = productionFreeEndpoints.find((endpoint) => endpoint.id === "haystackSwapOptIn");
  const quoteIndex = productionFreeEndpoints.findIndex(
    (endpoint) => endpoint.id === "haystackSwapQuote"
  );
  const optInIndex = productionFreeEndpoints.findIndex(
    (endpoint) => endpoint.id === "haystackSwapOptIn"
  );

  assert.equal(quote?.method, "POST");
  assert.equal(quote?.path, "/swaps/quote");
  assert.equal(
    (quote?.body as { type?: string } | undefined)?.type,
    "fixed-input"
  );
  assert.ok((quote?.body as { address?: string } | undefined)?.address);

  assert.equal(optIn?.method, "POST");
  assert.equal(optIn?.path, "/swaps/optin");
  assert.equal(optIn?.body, undefined);
  assert.ok(quoteIndex >= 0 && optInIndex > quoteIndex);
});

test("production endpoint mapping copies method from the policy matrix", () => {
  for (const endpoint of [...productionFreeEndpoints, ...productionPaidEndpoints]) {
    assert.ok(endpoint.method === "GET" || endpoint.method === "POST", endpoint.id);
  }

  const pricing = productionFreeEndpoints.find((endpoint) => endpoint.id === "tokenPricing");
  assert.equal(pricing?.method, "POST");
  assert.ok(pricing?.body);

  const executionQuote = productionPaidEndpoints.find(
    (endpoint) => endpoint.id === "executionQuote"
  );
  assert.equal(executionQuote?.method, "POST");
  assert.ok(executionQuote?.body);
});
