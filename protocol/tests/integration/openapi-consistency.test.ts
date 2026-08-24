import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../../src/app.js";
import { SupportedProtocolValues } from "../../src/routes/schemas.js";
import { endpointPolicyMatrix } from "../../src/services/payment-policy.js";
import { OpportunityRecordSchema } from "../../src/types/opportunity-schema.js";
import {
  EligibilityRequestSchema,
  EligibilityResponseSchema,
  OpportunityEligibilitySchema
} from "../../src/types/eligibility-schema.js";
import {
  PlanDataSchema,
  PlanRequestSchema,
  PlanResponseSchema
} from "../../src/types/plan-schema.js";
import {
  RebalanceDataSchema,
  RebalanceRequestSchema,
  RebalanceResponseSchema
} from "../../src/types/rebalance-schema.js";
import {
  ComposeDataSchema,
  ComposeRequestSchema,
  ComposeResponseSchema
} from "../../src/types/compose-schema.js";
import {
  SimulationRequestSchema,
  SimulationResponseSchema,
  SimulationSummarySchema
} from "../../src/types/simulate-schema.js";
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
  parameters?: Array<{ $ref?: string; name?: string }>;
  responses?: Record<string, { $ref?: string }>;
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

interface OpenApiDocument {
  components: {
    schemas: Record<string, { required?: string[]; properties?: Record<string, unknown> }>;
    parameters?: Record<string, unknown>;
    responses?: Record<string, unknown>;
  };
  paths: Record<string, OpenApiPathItem>;
}

interface OpenApiPathItem {
  get?: OpenApiOperation;
  post?: OpenApiOperation;
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
        endpoint.pathPattern.replace(/:([A-Za-z]+)/g, "{$1}")
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
    const openapiPath = endpoint.pathPattern.replace(/:([A-Za-z]+)/g, "{$1}");
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

  const claimableOperation = openapi.paths["/positions/claimable"]?.get;
  assert.equal(
    claimableOperation?.["x-x402"]?.requirementTemplate?.maxAmountRequired,
    "0.001"
  );
  assert.equal(claimableOperation?.["x-payment-info"]?.price?.amount, "0.001");
  assert.match(claimableOperation?.description ?? "", /claimAllQuotes/i);

  const eligibilityOperation = openapi.paths["/eligibility"]?.post;
  assert.equal(
    eligibilityOperation?.["x-x402"]?.requirementTemplate?.maxAmountRequired,
    "0.01"
  );
  assert.equal(eligibilityOperation?.["x-payment-info"]?.price?.amount, "0.01");
  assert.match(eligibilityOperation?.description ?? "", /eligibilityFullyCheckable/i);

  const plansOperation = openapi.paths["/plans"]?.post;
  assert.equal(
    plansOperation?.["x-x402"]?.requirementTemplate?.maxAmountRequired,
    "0.25"
  );
  assert.equal(plansOperation?.["x-payment-info"]?.price?.amount, "0.25");
  assert.match(plansOperation?.description ?? "", /unsigned/i);
  assert.match(plansOperation?.description ?? "", /Brownie/i);

  const rebalanceOperation = openapi.paths["/plans/rebalance"]?.post;
  assert.equal(
    rebalanceOperation?.["x-x402"]?.requirementTemplate?.maxAmountRequired,
    "0.25"
  );
  assert.equal(rebalanceOperation?.["x-payment-info"]?.price?.amount, "0.25");
  assert.match(rebalanceOperation?.description ?? "", /delta/i);
  assert.match(rebalanceOperation?.description ?? "", /never merged/i);

  const composeOperation = openapi.paths["/execution/compose"]?.post;
  assert.equal(
    composeOperation?.["x-x402"]?.requirementTemplate?.maxAmountRequired,
    "0.1"
  );
  assert.equal(composeOperation?.["x-payment-info"]?.price?.amount, "0.1");
  assert.match(composeOperation?.description ?? "", /requiredAssetIds/i);
  assert.match(composeOperation?.description ?? "", /never merged/i);

  const simulateOperation = openapi.paths["/execution/simulate"]?.post;
  assert.equal(
    simulateOperation?.["x-x402"]?.requirementTemplate?.maxAmountRequired,
    "0.1"
  );
  assert.equal(simulateOperation?.["x-payment-info"]?.price?.amount, "0.1");
  assert.match(simulateOperation?.description ?? "", /fail/i);
  assert.match(simulateOperation?.description ?? "", /does not sign/i);

  const haystackSwapOperation = openapi.paths["/swaps/transactions"]?.post;
  assert.equal(
    haystackSwapOperation?.["x-x402"]?.requirementTemplate?.maxAmountRequired,
    "0.005"
  );
  assert.equal(haystackSwapOperation?.["x-payment-info"]?.price?.amount, "0.005");
  assert.match(haystackSwapOperation?.description ?? "", /sign/i);
  assert.match(haystackSwapOperation?.description ?? "", /10 bps/i);

  const sessionsCreateOperation = openapi.paths["/sessions"]?.post;
  assert.equal(
    sessionsCreateOperation?.["x-x402"]?.requirementTemplate?.maxAmountRequired,
    "0.25"
  );
  assert.equal(sessionsCreateOperation?.["x-payment-info"]?.price?.amount, "0.25");
  assert.match(sessionsCreateOperation?.description ?? "", /receipt/i);

  const sessionsRefreshOperation = openapi.paths["/sessions/refresh"]?.post;
  assert.equal(
    sessionsRefreshOperation?.["x-x402"]?.requirementTemplate?.maxAmountRequired,
    "0.25"
  );
  assert.equal(sessionsRefreshOperation?.["x-payment-info"]?.price?.amount, "0.25");

  assert.equal(openapi.paths["/sessions/{sessionId}"]?.get?.["x-x402"], undefined);
  assert.equal(
    openapi.paths["/sessions/{sessionId}"]?.get?.responses?.["402"]?.$ref,
    "#/components/responses/SessionError"
  );
  assert.equal(openapi.paths["/sessions/{sessionId}"]?.get?.responses?.["404"], undefined);
  assert.ok(openapi.components.responses?.SessionError);
  assert.ok(openapi.components.parameters?.CanixSessionHeader);

  const sessionEligible = endpointPolicyMatrix.filter((endpoint) => endpoint.sessionAccess);
  for (const endpoint of sessionEligible) {
    const openapiPath = endpoint.pathPattern.replace(/:([A-Za-z]+)/g, "{$1}");
    const operation = resolveOpenApiOperation(openapi.paths[openapiPath], endpoint.method);
    assert.ok(operation, `${endpoint.method} ${openapiPath}`);
    const hasSessionHeader = operation?.parameters?.some(
      (param) => param.$ref === "#/components/parameters/CanixSessionHeader"
    );
    assert.equal(hasSessionHeader, true, `${endpoint.method} ${openapiPath} session header`);
  }

  assert.match(
    openapi.paths["/execution/shapes"]?.get?.description ?? "",
    /protocol-caveats/
  );
  assert.match(
    openapi.paths["/execution/quotes"]?.post?.description ?? "",
    /protocol-caveats/
  );

  assert.deepEqual(openapi.paths["/swaps/quote"]?.post?.security, []);
  assert.deepEqual(openapi.paths["/swaps/optin"]?.post?.security, []);

  const freePolicyEndpoints = endpointPolicyMatrix.filter(
    (endpoint) => endpoint.access === "free"
  );

  for (const endpoint of freePolicyEndpoints) {
    const openapiPath = endpoint.pathPattern.replace(/:([A-Za-z]+)/g, "{$1}");
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

test("eligibility OpenAPI request and response envelopes stay aligned", async () => {
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "GET",
    url: "/openapi.json"
  });
  assert.equal(response.statusCode, 200);

  const openapi = response.json() as OpenApiDocument;
  const pairs = [
    ["EligibilityRequest", EligibilityRequestSchema],
    ["EligibilityResponse", EligibilityResponseSchema],
    ["OpportunityEligibility", OpportunityEligibilitySchema]
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

test("plans OpenAPI request and response envelopes stay aligned", async () => {
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "GET",
    url: "/openapi.json"
  });
  assert.equal(response.statusCode, 200);

  const openapi = response.json() as OpenApiDocument;
  const pairs = [
    ["PlanRequest", PlanRequestSchema],
    ["PlanResponse", PlanResponseSchema],
    ["PlanData", PlanDataSchema]
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

test("rebalance OpenAPI request and response envelopes stay aligned", async () => {
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "GET",
    url: "/openapi.json"
  });
  assert.equal(response.statusCode, 200);

  const openapi = response.json() as OpenApiDocument;
  const pairs = [
    ["RebalanceRequest", RebalanceRequestSchema],
    ["RebalanceResponse", RebalanceResponseSchema],
    ["RebalanceData", RebalanceDataSchema]
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

test("compose OpenAPI request and response envelopes stay aligned", async () => {
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "GET",
    url: "/openapi.json"
  });
  assert.equal(response.statusCode, 200);

  const openapi = response.json() as OpenApiDocument;
  const pairs = [
    ["ComposeRequest", ComposeRequestSchema],
    ["ComposeResponse", ComposeResponseSchema],
    ["ComposeData", ComposeDataSchema]
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

test("simulate OpenAPI request and response envelopes stay aligned", async () => {
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "GET",
    url: "/openapi.json"
  });
  assert.equal(response.statusCode, 200);

  const openapi = response.json() as OpenApiDocument;
  const pairs = [
    ["SimulationRequest", SimulationRequestSchema],
    ["SimulationResponse", SimulationResponseSchema],
    ["SimulationSummary", SimulationSummarySchema]
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
