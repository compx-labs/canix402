import assert from "node:assert/strict";
import test from "node:test";

import {
  MCP_SERVER_REMOTE_URL,
  MCP_SERVER_TRANSPORT,
  MCP_TOOL_NAMES
} from "../../src/constants/mcp.js";

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
  logoUrl: string;
  bannerUrl: string;
  facilitator: string;
  chains: Array<{
    network: string;
    assets: Array<{ symbol: string; assetId: string; decimals: number }>;
  }>;
  resources: Array<{
    id: string;
    method: "GET" | "POST";
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
  // Agent discovery metadata: advertises MCP tooling without invoking the MCP server.
  assert.ok(payload.data.capabilities.includes("mcp-server"));
  assert.ok(payload.data.capabilities.includes("haystack-swaps"));
  assert.ok(payload.data.capabilities.includes("multi-router-swaps"));
  assert.equal(payload.data.capabilities.includes("folks-router-swaps"), false);
  assert.ok(payload.data.capabilities.includes("prepaid-sessions"));
  assert.ok(payload.data.capabilities.includes("watch-retainers"));
  assert.ok(payload.data.sessionPolicy);
  assert.ok(payload.data.watchPolicy);
  assert.equal(payload.data.sessionPolicy.header, "X-Canix-Session");
  assert.equal(payload.data.watchPolicy.signatureHeader, "X-Canix-Signature");
  assert.equal(payload.data.sessionPolicy.oneShotDefault, true);
  const quote = payload.data.endpoints.find((endpoint) => endpoint.id === "haystackSwapQuote");
  const optIn = payload.data.endpoints.find((endpoint) => endpoint.id === "haystackSwapOptIn");
  const transactions = payload.data.endpoints.find(
    (endpoint) => endpoint.id === "haystackSwapTransactions"
  );
  const pricing = payload.data.endpoints.find((endpoint) => endpoint.id === "tokenPricing");
  assert.equal(quote?.access, "free");
  assert.deepEqual(quote?.responseCodes, [200, 400, 404, 429, 502]);
  assert.equal(optIn?.access, "free");
  assert.deepEqual(optIn?.responseCodes, [200, 400, 502]);
  assert.equal(transactions?.access, "paid");
  assert.deepEqual(transactions?.responseCodes, [200, 400, 402, 429, 502]);
  assert.equal(transactions?.x402?.requirementTemplate.maxAmountRequired, "0.005");
  assert.equal(pricing?.access, "free");
  assert.deepEqual(pricing?.responseCodes, [200, 400, 502]);
  const sessionsReceipt = payload.data.endpoints.find(
    (endpoint) => endpoint.id === "sessionsReceipt"
  );
  assert.deepEqual(sessionsReceipt?.responseCodes, [200, 402]);
  assert.equal(payload.data.mcpServer?.transport, MCP_SERVER_TRANSPORT);
  assert.equal(payload.data.mcpServer?.url, MCP_SERVER_REMOTE_URL);
  assert.deepEqual(
    [...(payload.data.mcpServer?.tools ?? [])].sort(),
    [...MCP_TOOL_NAMES].sort()
  );

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
    .map((endpoint) => endpoint.pathPattern.replace(/:([A-Za-z]+)/g, "{$1}"))
    .sort();

  assert.equal(manifest.service, "canix402");
  assert.equal(manifest.x402Version, 2);
  assert.equal(manifest.openapiUrl, "https://canix402-api.compx.io/openapi.json");
  assert.equal(manifest.discoveryUrl, "https://canix402-api.compx.io/discovery");
  assert.equal(manifest.logoUrl, "https://canix402-api.compx.io/logo.png?v=2");
  assert.equal(manifest.bannerUrl, "https://canix402-api.compx.io/banner.png?v=2");
  assert.equal(manifest.docsUrl, "https://canix402.compx.io/x402");
  assert.equal(manifest.llmsTxtUrl, "https://canix402.compx.io/llms.txt");
  assert.equal((manifest as { mcpTransport?: string }).mcpTransport, MCP_SERVER_TRANSPORT);
  assert.equal((manifest as { mcpUrl?: string }).mcpUrl, MCP_SERVER_REMOTE_URL);
  assert.equal(
    (manifest as { mcpInstall?: string }).mcpInstall,
    "https://canix402.compx.io/x402#mcp"
  );
  assert.equal(typeof manifest.facilitator, "string");
  assert.equal(manifest.chains[0]?.assets[0]?.symbol, "USDC");
  assert.deepEqual(manifestPaths, paidPolicyPaths);
  assert.equal(
    manifest.resources.find((resource) => resource.id === "positions")?.price.amount,
    "0.005"
  );
  assert.equal(
    manifest.resources.find((resource) => resource.id === "positionsClaimable")?.price.amount,
    "0.001"
  );
  assert.equal(
    manifest.resources.find((resource) => resource.id === "eligibility")?.price.amount,
    "0.01"
  );
  assert.equal(
    manifest.resources.find((resource) => resource.id === "plans")?.price.amount,
    "0.25"
  );
  assert.equal(
    manifest.resources.find((resource) => resource.id === "plansRebalance")?.price.amount,
    "0.25"
  );
  assert.equal(
    manifest.resources.find((resource) => resource.id === "haystackSwapTransactions")?.price
      .amount,
    "0.005"
  );

  for (const resource of manifest.resources) {
    assert.equal(resource.method === "GET" || resource.method === "POST", true);
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
    assert.equal(typeof endpoint.x402?.amountUsdc, "string");
    assert.equal(typeof endpoint.x402?.amountMicro, "string");
    assert.equal(
      endpoint.x402?.amountUsdc,
      endpoint.x402?.requirementTemplate.maxAmountRequired
    );
  }

  await app.close();
});

test("discovery error catalog includes core codes", async () => {
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "GET",
    url: "/discovery"
  });
  assert.equal(response.statusCode, 200);
  const payload = response.json() as { data: DiscoveryDocument };
  const codes = new Set(payload.data.errorCatalog.map((entry) => entry.code));
  assert.ok(codes.has("VALIDATION_ERROR"));
  assert.ok(codes.has("NOT_FOUND"));
  assert.ok(codes.has("INTERNAL_ERROR"));
  assert.equal(codes.has("STRATEGY_VALIDATION_ERROR"), false);
  assert.equal(codes.has("STRATEGY_NOT_FOUND"), false);
  assert.equal(codes.has("STRATEGY_FORBIDDEN"), false);
  assert.equal(codes.has("STRATEGY_CONFLICT"), false);

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
  const expectedPaidCount = endpointPolicyMatrix.filter(
    (endpoint) => endpoint.access === "paid"
  ).length;
  assert.equal(payload.resources.length, expectedPaidCount);
  assert.ok(payload.resources.includes("https://canix402-api.compx.io/positions"));
  assert.ok(
    payload.resources.includes("https://canix402-api.compx.io/positions/claimable")
  );
  assert.ok(payload.resources.some((url) => url.endsWith("/eligibility")));
  assert.ok(payload.resources.some((url) => url.endsWith("/plans")));
  assert.ok(payload.resources.some((url) => url.endsWith("/execution/simulate")));
  assert.ok(payload.resources.some((url) => url.endsWith("/policy/validate")));
  assert.ok(
    payload.resources.includes("https://canix402-api.compx.io/swaps/transactions")
  );
  assert.equal(
    payload.resources.some((url) => url.includes("/strategies")),
    false
  );
  assert.equal(payload.resources.every((url) => url.startsWith("https://canix402-api.compx.io/")), true);

  await app.close();
});

test("API root serves branding HTML with social metadata", async () => {
  const app = buildApp();
  await app.ready();

  const [root, logo, banner] = await Promise.all([
    app.inject({ method: "GET", url: "/" }),
    app.inject({ method: "GET", url: "/logo.png" }),
    app.inject({ method: "GET", url: "/banner.png" })
  ]);

  assert.equal(root.statusCode, 200);
  assert.match(root.headers["content-type"] ?? "", /text\/html/);
  assert.match(root.body, /og:title/);
  assert.match(root.body, /og:image/);
  assert.match(root.body, /og:description/);
  assert.match(root.body, /\/logo\.png/);
  assert.match(root.body, /\/banner\.png/);
  assert.equal(logo.statusCode, 200);
  assert.equal(banner.statusCode, 200);
  assert.ok(logo.rawPayload.length > 0);
  assert.ok(banner.rawPayload.length > 0);

  await app.close();
});

test("gateway serves agent discovery metadata without payment", async () => {
  const app = buildApp();
  await app.ready();

  const [llms, fullLlms, robots, agentCard, legacyAgentCard, aiPlugin] = await Promise.all([
    app.inject({ method: "GET", url: "/llms.txt" }),
    app.inject({ method: "GET", url: "/llms-full.txt" }),
    app.inject({ method: "GET", url: "/robots.txt" }),
    app.inject({ method: "GET", url: "/.well-known/agent-card.json" }),
    app.inject({ method: "GET", url: "/.well-known/agent.json" }),
    app.inject({ method: "GET", url: "/.well-known/ai-plugin.json" })
  ]);

  assert.equal(llms.statusCode, 200);
  assert.match(llms.body, /Canonical documentation: https:\/\/canix402\.compx\.io/);
  assert.match(llms.body, /https:\/\/canix402-api\.compx\.io\/\.well-known\/x402\.json/);
  assert.equal(fullLlms.statusCode, 200);
  assert.match(fullLlms.body, /POST https:\/\/canix402-api\.compx\.io\/pricing — free/);
  assert.equal(robots.statusCode, 200);
  assert.match(robots.body, /agent-card\.json/);

  const card = agentCard.json() as {
    documentationUrl: string;
    provider: { url: string };
    iconUrl?: string;
    skills: Array<{ id: string }>;
    x402?: { logoUrl?: string; bannerUrl?: string };
  };
  assert.equal(agentCard.statusCode, 200);
  assert.equal(legacyAgentCard.statusCode, 200);
  assert.equal(card.documentationUrl, "https://canix402.compx.io/llms.txt");
  assert.equal(card.iconUrl, "https://canix402-api.compx.io/logo.png?v=2");
  assert.equal(card.x402?.logoUrl, "https://canix402-api.compx.io/logo.png?v=2");
  assert.equal(card.x402?.bannerUrl, "https://canix402-api.compx.io/banner.png?v=2");
  assert.equal(card.provider.url, "https://canix402.compx.io");
  assert.equal(card.skills.length, endpointPolicyMatrix.filter((endpoint) => endpoint.access === "paid").length);

  const plugin = aiPlugin.json() as { api: { type: string; url: string } };
  assert.equal(aiPlugin.statusCode, 200);
  assert.equal(plugin.api.type, "openapi");
  assert.equal(plugin.api.url, "https://canix402-api.compx.io/openapi.json");

  await app.close();
});
