import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../../src/app.js";
import { SupportedProtocolValues } from "../../src/routes/schemas.js";
import { endpointPolicyMatrix } from "../../src/services/payment-policy.js";
import { OpportunityRecordSchema } from "../../src/types/opportunity-schema.js";
import {
  PositionRecordSchema,
  WalletPositionsResponseSchema
} from "../../src/types/position-schema.js";
import {
  SwapOptInRequestSchema,
  SwapOptInResponseSchema,
  SwapQuoteRequestSchema,
  SwapQuoteResponseSchema,
  SwapTransactionsRequestSchema,
  SwapTransactionsResponseSchema
} from "../../src/types/swap-schema.js";

interface OpenApiOperation {
  description?: string;
  "x-x402"?: {
    requirementTemplate?: {
      maxAmountRequired?: string;
    };
  };
  "x-payment-info"?: {
    price?: {
      amount?: string;
    };
  };
  security?: unknown[];
}

interface OpenApiPathItem {
  get?: OpenApiOperation;
  post?: OpenApiOperation;
}

interface OpenApiDocument {
  components: {
    schemas: Record<string, { required?: string[]; properties?: Record<string, unknown> }>;
  };
  paths: Record<string, OpenApiPathItem>;
}

function resolveOpenApiOperation(
  pathItem: OpenApiPathItem | undefined,
  method: "GET" | "POST"
): OpenApiOperation | undefined {
  if (!pathItem) {
    return undefined;
  }
  return method === "POST" ? pathItem.post : pathItem.get;
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
  const policyPaths = [
    ...new Set(
      endpointPolicyMatrix.map((endpoint) =>
        endpoint.pathPattern.replace(":protocol", "{protocol}")
      )
    )
  ].sort();

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
    const operation = resolveOpenApiOperation(openapi.paths[openapiPath], endpoint.method);
    assert.ok(operation, `${endpoint.method} ${openapiPath}`);
    assert.ok(operation?.["x-x402"]);
    assert.ok(operation?.["x-payment-info"]);
  }

  const positionsOperation = openapi.paths["/positions"]?.get;
  assert.equal(
    positionsOperation?.["x-x402"]?.requirementTemplate?.maxAmountRequired,
    "0.005"
  );
  assert.equal(positionsOperation?.["x-payment-info"]?.price?.amount, "0.005");

  const haystackSwapOperation = openapi.paths["/swaps/transactions"]?.post;
  assert.equal(
    haystackSwapOperation?.["x-x402"]?.requirementTemplate?.maxAmountRequired,
    "0.005"
  );
  assert.equal(haystackSwapOperation?.["x-payment-info"]?.price?.amount, "0.005");
  assert.match(haystackSwapOperation?.description ?? "", /sign/i);
  assert.match(haystackSwapOperation?.description ?? "", /10 bps/i);

  assert.deepEqual(openapi.paths["/swaps/quote"]?.post?.security, []);
  assert.deepEqual(openapi.paths["/swaps/optin"]?.post?.security, []);

  const freePolicyEndpoints = endpointPolicyMatrix.filter(
    (endpoint) => endpoint.access === "free"
  );

  for (const endpoint of freePolicyEndpoints) {
    const openapiPath = endpoint.pathPattern.replace(":protocol", "{protocol}");
    const operation = resolveOpenApiOperation(openapi.paths[openapiPath], endpoint.method);
    assert.ok(operation, `${endpoint.method} ${openapiPath}`);
    assert.deepEqual(operation?.security, []);
  }

  assert.equal(typeof (openapi as { info?: { contact?: { email?: string } } }).info?.contact?.email, "string");

  await app.close();
});

test("opportunity record schema stays aligned with TypeBox contract", async () => {
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "GET",
    url: "/openapi.json"
  });
  assert.equal(response.statusCode, 200);

  const openapi = response.json() as OpenApiDocument;
  const openapiRecord = openapi.components.schemas.OpportunityRecord;
  assert.ok(openapiRecord);

  const openapiRequired = [...(openapiRecord.required ?? [])].sort();
  const typeboxRequired = [
    ...((OpportunityRecordSchema as unknown as { required?: string[] }).required ?? [])
  ].sort();
  assert.deepEqual(openapiRequired, typeboxRequired);

  const openapiProperties = openapiRecord.properties ?? {};
  const protocolProperty = openapiProperties.protocol as { enum?: string[] } | undefined;
  const opportunityTypeProperty = openapiProperties.opportunityType as { enum?: string[] } | undefined;
  const yieldBasisProperty = openapiProperties.yieldBasis as { enum?: string[] } | undefined;
  const assetIdsProperty = openapiProperties.assetIds as { type?: string } | undefined;

  assert.deepEqual(protocolProperty?.enum, [...SupportedProtocolValues]);
  assert.equal(protocolProperty?.enum?.includes("haystack"), true);
  assert.deepEqual(opportunityTypeProperty?.enum, ["lp", "farm", "staking", "lending"]);
  assert.deepEqual(yieldBasisProperty?.enum, ["apy", "apr"]);
  assert.equal(assetIdsProperty?.type, "array");

  await app.close();
});

test("position record schema stays aligned with TypeBox contract", async () => {
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "GET",
    url: "/openapi.json"
  });
  assert.equal(response.statusCode, 200);

  const openapi = response.json() as OpenApiDocument;
  const openapiRecord = openapi.components.schemas.PositionRecord;
  assert.ok(openapiRecord);

  const openapiRequired = [...(openapiRecord.required ?? [])].sort();
  const typeboxRequired = [
    ...((PositionRecordSchema as unknown as { required?: string[] }).required ?? [])
  ].sort();
  assert.deepEqual(openapiRequired, typeboxRequired);
  assert.deepEqual(
    Object.keys(openapiRecord.properties ?? {}).sort(),
    Object.keys(
      (PositionRecordSchema as unknown as { properties?: Record<string, unknown> })
        .properties ?? {}
    ).sort()
  );

  const openapiResponse = openapi.components.schemas.WalletPositionsResponse;
  assert.ok(openapiResponse);
  assert.deepEqual(
    [...(openapiResponse.required ?? [])].sort(),
    [
      ...((WalletPositionsResponseSchema as unknown as { required?: string[] })
        .required ?? [])
    ].sort()
  );

  await app.close();
});

test("Haystack OpenAPI request and response envelopes stay aligned", async () => {
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "GET",
    url: "/openapi.json"
  });
  assert.equal(response.statusCode, 200);

  const openapi = response.json() as OpenApiDocument;
  const pairs = [
    ["HaystackSwapQuoteRequest", SwapQuoteRequestSchema],
    ["HaystackSwapQuoteResponse", SwapQuoteResponseSchema],
    ["HaystackSwapOptInRequest", SwapOptInRequestSchema],
    ["HaystackSwapOptInResponse", SwapOptInResponseSchema],
    ["HaystackSwapTransactionsRequest", SwapTransactionsRequestSchema],
    ["HaystackSwapTransactionsResponse", SwapTransactionsResponseSchema]
  ] as const;

  for (const [name, typeboxSchema] of pairs) {
    const openapiSchema = openapi.components.schemas[name];
    assert.ok(openapiSchema, name);
    assert.deepEqual(
      [...(openapiSchema.required ?? [])].sort(),
      [
        ...((typeboxSchema as unknown as { required?: string[] }).required ?? [])
      ].sort(),
      `${name} required fields`
    );
    assert.deepEqual(
      Object.keys(openapiSchema.properties ?? {}).sort(),
      Object.keys(
        (typeboxSchema as unknown as { properties?: Record<string, unknown> }).properties
          ?? {}
      ).sort(),
      `${name} properties`
    );
  }

  await app.close();
});
