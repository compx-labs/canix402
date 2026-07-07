import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../../src/app.js";
import { endpointPolicyMatrix } from "../../src/services/payment-policy.js";
import { DiscoveryDocument } from "../../src/types/discovery.js";

interface X402Manifest {
  service: "canix402";
  x402Version: 2;
  docsUrl: string;
  llmsTxtUrl: string;
  openapiUrl: string;
  discoveryUrl: string;
  facilitator: string;
  chains: Array<{
    network: string;
    assets: Array<{ symbol: string; assetId: string; decimals: number }>;
  }>;
  resources: Array<{
    id: string;
    method: "GET";
    path: string;
    url: string;
    price: {
      amount: string;
      currency: string;
      network: string;
      asset: string;
    };
    x402: unknown;
  }>;
}

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

test("well-known x402 manifest lists paid resources and indexing links", async () => {
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "GET",
    url: "/.well-known/x402.json"
  });

  assert.equal(response.statusCode, 200);

  const manifest = response.json() as X402Manifest;
  const paidPolicyEndpoints = endpointPolicyMatrix.filter(
    (endpoint) => endpoint.access === "paid"
  );
  const manifestPaths = manifest.resources.map((resource) => resource.path).sort();
  const paidPolicyPaths = paidPolicyEndpoints
    .map((endpoint) => endpoint.pathPattern.replace(":protocol", "{protocol}"))
    .sort();

  assert.equal(manifest.service, "canix402");
  assert.equal(manifest.x402Version, 2);
  assert.equal(manifest.openapiUrl, "https://canix402-api.compx.io/openapi.json");
  assert.equal(manifest.discoveryUrl, "https://canix402-api.compx.io/discovery");
  assert.equal(manifest.docsUrl, "https://canix402.compx.io/x402");
  assert.equal(manifest.llmsTxtUrl, "https://canix402.compx.io/llms.txt");
  assert.equal(typeof manifest.facilitator, "string");
  assert.equal(manifest.chains[0]?.assets[0]?.symbol, "USDC");
  assert.deepEqual(manifestPaths, paidPolicyPaths);

  for (const resource of manifest.resources) {
    assert.equal(resource.method, "GET");
    assert.equal(resource.url.startsWith("https://canix402-api.compx.io/"), true);
    assert.equal(resource.price.currency, "USDC");
    assert.equal(typeof resource.price.amount, "string");
    assert.ok(resource.x402);
  }

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

test("well-known x402 fan-out lists paid resource URLs", async () => {
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "GET",
    url: "/.well-known/x402"
  });

  assert.equal(response.statusCode, 200);

  const payload = response.json() as { version: 1; resources: string[] };
  assert.equal(payload.version, 1);
  assert.equal(payload.resources.length, 4);
  assert.equal(payload.resources.every((url) => url.startsWith("https://canix402-api.compx.io/")), true);

  await app.close();
});
