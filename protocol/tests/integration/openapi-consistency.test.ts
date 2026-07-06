import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../../src/app.js";
import { endpointPolicyMatrix } from "../../src/services/payment-policy.js";

interface OpenApiOperation {
  "x-x402"?: unknown;
}

interface OpenApiDocument {
  paths: Record<string, { get?: OpenApiOperation }>;
}

test("openapi paths match policy matrix routes", async () => {
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "GET",
    url: "/openapi.json"
  });

  assert.equal(response.statusCode, 200);

  const openapi = response.json() as OpenApiDocument;
  const openapiPaths = Object.keys(openapi.paths).sort();
  const policyPaths = endpointPolicyMatrix
    .map((endpoint) => endpoint.pathPattern.replace(":protocol", "{protocol}"))
    .sort();

  assert.deepEqual(openapiPaths, policyPaths);

  await app.close();
});

test("paid operations expose x-x402 metadata", async () => {
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "GET",
    url: "/openapi.json"
  });

  assert.equal(response.statusCode, 200);

  const openapi = response.json() as OpenApiDocument;
  const paidPolicyEndpoints = endpointPolicyMatrix.filter(
    (endpoint) => endpoint.access === "paid"
  );

  for (const endpoint of paidPolicyEndpoints) {
    const openapiPath = endpoint.pathPattern.replace(":protocol", "{protocol}");
    const operation = openapi.paths[openapiPath]?.get;
    assert.ok(operation);
    assert.ok(operation?.["x-x402"]);
  }

  await app.close();
});
