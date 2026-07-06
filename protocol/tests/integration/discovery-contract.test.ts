import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../../src/app.js";
import { endpointPolicyMatrix } from "../../src/services/payment-policy.js";
import { DiscoveryDocument } from "../../src/types/discovery.js";

test("discovery includes every endpoint in policy matrix", async () => {
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "GET",
    url: "/discovery"
  });

  assert.equal(response.statusCode, 200);

  const payload = response.json() as { data: DiscoveryDocument };
  const discoveryPaths = payload.data.endpoints.map((endpoint) => endpoint.path).sort();
  const policyPaths = endpointPolicyMatrix.map((endpoint) => endpoint.pathPattern).sort();

  assert.deepEqual(discoveryPaths, policyPaths);

  await app.close();
});

test("paid discovery endpoints include complete x402 descriptors", async () => {
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "GET",
    url: "/discovery"
  });

  assert.equal(response.statusCode, 200);

  const payload = response.json() as { data: DiscoveryDocument };
  const paidEndpoints = payload.data.endpoints.filter((endpoint) => endpoint.access === "paid");

  assert.equal(paidEndpoints.length > 0, true);
  for (const endpoint of paidEndpoints) {
    assert.ok(endpoint.x402);
    assert.equal(endpoint.x402?.protocolVersion, 2);
    assert.deepEqual(endpoint.x402?.requiredHeaders, [
      "PAYMENT-REQUIRED",
      "PAYMENT-SIGNATURE",
      "PAYMENT-RESPONSE"
    ]);
    assert.equal(typeof endpoint.x402?.requirementTemplate.network, "string");
    assert.equal(typeof endpoint.x402?.requirementTemplate.asset, "string");
    assert.equal(typeof endpoint.x402?.requirementTemplate.payTo, "string");
    assert.equal(typeof endpoint.x402?.requirementTemplate.maxAmountRequired, "string");
  }

  await app.close();
});
