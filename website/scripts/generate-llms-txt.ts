import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const websiteRoot = resolve(scriptDir, "..");
const dataDir = resolve(websiteRoot, "src/data");
const publicDir = resolve(websiteRoot, "public");

const DOCS_SITE = (process.env.PUBLIC_SITE_URL ?? "https://canix402.compx.io").replace(/\/+$/, "");
const GATEWAY = (process.env.PUBLIC_GATEWAY_BASE_URL ?? "https://canix402-api.compx.io").replace(
  /\/+$/,
  ""
);
const MCP_URL = (process.env.PUBLIC_MCP_URL ?? "https://canix402-mcp.compx.io/mcp").replace(
  /\/+$/,
  ""
);
const MCP_WELL_KNOWN = (
  process.env.PUBLIC_MCP_WELL_KNOWN_URL ?? `${MCP_URL.replace(/\/mcp$/, "")}/.well-known/mcp`
).replace(/\/+$/, "");
const SUPPORT_EMAIL = "kieran@neonforge.ltd";
const OPERATOR = "Neon Forge Ltd";
const PROTOCOLS = [
  "Tinyman",
  "Pact",
  "Folks Finance",
  "CompX",
  "Dork.fi",
  "Myth Finance",
  "Haystack",
  "Réti",
  "Alpha Arcade",
  "STAMM"
] as const;

interface DiscoveryEndpoint {
  id: string;
  method: string;
  path: string;
  access: "free" | "paid";
  summary: string;
  description?: string;
  queryParams?: string[];
  pathParams?: string[];
  x402?: {
    facilitator: string;
    requiredHeaders: string[];
    requirementTemplate: {
      scheme: string;
      network: string;
      asset: string;
      payTo: string;
      maxAmountRequired: string;
    };
  };
}

interface DiscoveryDocument {
  apiVersion: string;
  capabilities?: string[];
  endpoints: DiscoveryEndpoint[];
  mcpServer?: {
    name: string;
    transport: string;
    url?: string;
    tools?: string[];
  };
  errorCatalog: Array<{
    code: string;
    httpStatus: number;
    description: string;
  }>;
}

interface SnapshotFile {
  data: DiscoveryDocument;
}

function loadDiscovery(): DiscoveryDocument {
  const raw = readFileSync(resolve(dataDir, "discovery.snapshot.json"), "utf-8");
  const parsed = JSON.parse(raw) as SnapshotFile;
  return parsed.data;
}

function loadSample(name: string, maxItems = 2): unknown {
  const raw = readFileSync(resolve(dataDir, name), "utf-8");
  const parsed = JSON.parse(raw) as { data?: unknown[]; meta?: unknown };
  if (!Array.isArray(parsed.data)) {
    return parsed;
  }

  return {
    data: parsed.data.slice(0, maxItems),
    meta: parsed.meta
  };
}

function formatPrice(endpoint: DiscoveryEndpoint): string {
  if (endpoint.access !== "paid") {
    return "Free";
  }

  const amount = endpoint.x402?.requirementTemplate.maxAmountRequired;
  return amount ? `${amount} USDC` : "Paid (see discovery)";
}

const SECRET_SCAN_PRAGMA = "  # pragma: allowlist secret";

function needsSecretScanPragma(path: string): boolean {
  return (
    path === "/opportunities" ||
    path === "/protocols/:protocol/opportunities" ||
    path === "/eligibility" ||
    path === "/plans" ||
    path === "/plans/rebalance" ||
    path === "/execution/compose" ||
    path === "/execution/simulate" ||
    path === "/policy/validate" ||
    path === "/opportunities/:opportunityId/history" ||
    path === "/sessions" ||
    path === "/sessions/refresh" ||
    path === "/watch" ||
    path === "/watch/refresh"
  );
}

function endpointLine(endpoint: DiscoveryEndpoint): string {
  const price = formatPrice(endpoint);
  const params = [
    ...(endpoint.pathParams ?? []).map((p) => `:${p}`),
    ...(endpoint.queryParams ?? []).map((p) => `${p}=`)
  ];
  const paramNote = params.length > 0 ? ` Params: ${params.join(", ")}.` : "";
  const pragma = needsSecretScanPragma(endpoint.path) ? SECRET_SCAN_PRAGMA : "";
  return `- \`${endpoint.method} ${endpoint.path}\` (${price}) — ${endpoint.summary}.${paramNote}${pragma}`;
}

function buildLlmsTxt(discovery: DiscoveryDocument): string {
  const paidEndpoints = discovery.endpoints.filter((e) => e.access === "paid");
  const docs = `${DOCS_SITE}`;

  return `# CANIX402

> x402-gated Algorand DeFi data and walletless transaction API for autonomous agents. Pay in USDC micropayments at the gateway edge, fetch normalized APY/TVL data, and build locally signable swap groups.  # pragma: allowlist secret

Use the **Caddy gateway** (\`${GATEWAY}\`) for all API calls. Discovery, execution shapes, swap quotes, and opt-in preparation are free; data routes, execution quotes, and swap transaction generation require x402 payment as advertised. The API never receives wallet keys or submits transactions. For the full integration guide in one file, see [llms-full.txt](${docs}/llms-full.txt).  # pragma: allowlist secret

## API (machine-readable)

- [Discovery](${GATEWAY}/discovery): endpoint catalog, x402 prices, error codes, facilitator metadata
- [OpenAPI](${GATEWAY}/openapi.json): schemas, query parameters, response examples
- [x402 manifest](${GATEWAY}/.well-known/x402.json): directory indexing surface for agent tooling and x402 directories
- [MCP server](${docs}/mcp): remote Streamable HTTP MCP at \`${MCP_URL}\` (walletless pass-through)
- [WebMCP demo](${docs}/webmcp): same MCP tools registered in-page via the WebMCP imperative API

## Integration guides

- [Quickstart](${docs}/quickstart): agent onboarding (MCP or direct HTTP)
- [MCP setup](${docs}/mcp): connect to \`${MCP_URL}\`, paid-tool paymentSignature retry
- [WebMCP demo](${docs}/webmcp): \`document.modelContext.registerTool\` (Chrome) / \`navigator.modelContext\` fallback; fail-closed execute
- [x402 payment flow](${docs}/x402): preflight 402, sign USDC transfer, retry with PAYMENT-SIGNATURE
- [Examples](${docs}/examples): copy-paste curl and sample payloads
- [Endpoint catalog](${docs}/endpoints): human-readable route table sourced from discovery
- [Live transactions](${docs}/transactions): recent inbound USDC payments to the x402 pay-to wallet
- [Release notes](${docs}/release-notes): latest protocol package changelog

## Paid data routes

${paidEndpoints
    .map((e) => {
      const line = `- [${e.method} ${e.path}](${GATEWAY}${e.path.replace(":protocol", "{protocol}")}): ${formatPrice(e)} — ${e.summary}`;
      return needsSecretScanPragma(e.path) ? `${line}${SECRET_SCAN_PRAGMA}` : line;
    })
    .join("\n")}

## Optional

- [Full LLM guide](${docs}/llms-full.txt): self-contained integration reference without following links
- [FAQ](${docs}/faq): gateway vs upstream, 402 behavior, USDC asset id
- [Terms and disclaimer](${docs}/terms): informational-only use, no financial advice
- [Support](mailto:${SUPPORT_EMAIL}): ${SUPPORT_EMAIL} (${OPERATOR})
`;
}

function buildLlmsFullTxt(discovery: DiscoveryDocument): string {
  const firstPaid = discovery.endpoints.find((e) => e.access === "paid" && e.x402);
  const x402 = firstPaid?.x402;
  const network = x402?.requirementTemplate.network ?? "algorand-mainnet";
  const assetId = x402?.requirementTemplate.asset ?? "31566704";
  const facilitator = x402?.facilitator ?? "https://facilitator.goplausible.xyz";

  const samples = {
    opportunities: loadSample("opportunities.sample.json"),
    search: loadSample("opportunities-search.sample.json"),
    personalized: loadSample("opportunities-personalized.sample.json"),
    history: loadSample("opportunities-history.sample.json"),
    eligibility: loadSample("eligibility.sample.json"),
    plans: loadSample("plans.sample.json"),
    rebalance: loadSample("rebalance.sample.json"),
    compose: loadSample("compose.sample.json"),
    simulate: loadSample("simulate.sample.json"),
    policy: loadSample("policy.sample.json"),
    protocol: loadSample("protocol-opportunities.sample.json"),
    positions: loadSample("positions.sample.json"),
    positionsClaimable: loadSample("positions-claimable.sample.json"),
    executionShapes: loadSample("execution-shapes.sample.json"),
    executionQuotes: loadSample("execution-quotes.sample.json"),
    swapsQuote: loadSample("swaps-quote.sample.json"),
    swapsOptin: loadSample("swaps-optin.sample.json"),
    swapsTransactions: loadSample("swaps-transactions.sample.json"),
    watch: loadSample("watch.sample.json")
  };

  const fullGuideBlurb = `x402-gated Algorand DeFi data and walletless transaction API (version ${discovery.apiVersion}). Normalized yield data and multi-router swap-group generation for autonomous agents; USDC micropayments at the gateway; no server-side signing or submission.`; // pragma: allowlist secret

  return `# CANIX402 — full agent integration guide

> ${fullGuideBlurb}${SECRET_SCAN_PRAGMA}

## Overview

- **Gateway base URL:** \`${GATEWAY}\`
- **Documentation site:** ${DOCS_SITE}
- **Supported protocols:** ${PROTOCOLS.join(", ")}
- **Operator:** ${OPERATOR}
- **Support:** ${SUPPORT_EMAIL}
- **Terms:** ${DOCS_SITE}/terms
- **Release notes:** ${DOCS_SITE}/release-notes

Opportunity responses are normalized records with fields such as \`protocol\`, \`opportunityType\`, \`opportunityId\`, \`assetPair\`, \`apy\`, \`apr\`, optional \`borrowApr\` (borrow-side cost for lending markets), \`tvlUsd\`, \`risk\` (confidence, utilization, liquidation threshold, LP volatility/IL hint, reward runway, APY stability from the bounded history series, wallet health factor when address is in context), \`executionShapes\`, \`compatibleExitShapes\`, optional \`entryRequirements\` / \`capacity\` (Réti), \`sourceTimestamp\`, and \`fetchedAt\`. Lists and \`POST /plans\` rank with designed risk constraints before raw APY. Positions may include \`debt\` rows with repay exit shapes (CompX/Folks) or informational Dork.fi \`debt-usd\` aggregates. Numeric precision follows the published OpenAPI \`x-precision\` contract (typically 6 decimal places).

## Machine-readable contracts

| Resource | URL |
| --- | --- |
| Discovery | ${GATEWAY}/discovery |
| OpenAPI | ${GATEWAY}/openapi.json |
| x402 manifest | ${GATEWAY}/.well-known/x402.json |
| MCP server | ${DOCS_SITE}/mcp (remote \`${MCP_URL}\`, streamable-http) |
| WebMCP demo | ${DOCS_SITE}/webmcp |
| LLM index | ${DOCS_SITE}/llms.txt |

Always call the **gateway**, not an internal upstream API. x402 enforcement, \`PAYMENT-REQUIRED\`, and settlement happen at the gateway edge.

### MCP server

Prefer the canix402 MCP for agent hosts (Cursor, Claude Desktop). Endpoint: \`${MCP_URL}\` (streamable-http). Metadata: \`${MCP_WELL_KNOWN}\`. Walletless: paid tool preflight returns payment requirements; retry with \`paymentSignature\`. Tools include \`canix_list_opportunities\`, \`canix_get_opportunity_history\`, \`canix_list_execution_shapes\`, \`canix_get_positions\`, \`canix_list_claimable\`, \`canix_check_eligibility\`, \`canix_get_plan\`, \`canix_get_rebalance_plan\`, \`canix_validate_policy\`, \`canix_compose_enter\`, \`canix_get_execution_quote\`, \`canix_simulate_execution\`, \`canix_create_session\`, \`canix_refresh_session\`, \`canix_get_session\`, \`canix_create_watch\`, \`canix_refresh_watch\`, \`canix_get_watch\`, and free discovery helpers. Prepaid sessions: one x402 payment unlocks N research + M quotes/plans for a TTL (\`sessionReceipt\` / \`X-Canix-Session\`); one-shots remain the default. Watch retainers: \`POST /watch\` registers address + thresholds and delivers signed, idempotent webhooks instead of polling positions. See ${DOCS_SITE}/mcp.${SECRET_SCAN_PRAGMA}

## x402 payment flow

1. **Discover** — \`GET ${GATEWAY}/discovery\` and \`GET ${GATEWAY}/openapi.json\` (free).
2. **Preflight** — call a paid route without \`PAYMENT-SIGNATURE\`; expect HTTP **402** with \`PAYMENT-REQUIRED\`.
3. **Sign** — client-side: build a USDC ASA transfer matching the advertised requirement (\`scheme\`, \`network\`, \`asset\`, \`payTo\`, \`maxAmountRequired\`). Wallet keys stay on the client.
4. **Retry** — repeat the request with \`PAYMENT-SIGNATURE\` (base64 JSON payload). Success returns **200** and may include \`PAYMENT-RESPONSE\`.

Default payment context (confirm against live discovery before integrating):

- **Protocol version:** 2
- **Network:** ${network}${SECRET_SCAN_PRAGMA}
- **USDC asset id:** ${assetId}
- **Facilitator:** ${facilitator}
- **Headers:** ${(x402?.requiredHeaders ?? ["PAYMENT-REQUIRED", "PAYMENT-SIGNATURE", "PAYMENT-RESPONSE"]).join(", ")}

Example preflight:

\`\`\`
curl -s -D - ${GATEWAY}/opportunities -o /dev/null
\`\`\`

## Endpoint reference

${discovery.endpoints.map(endpointLine).join("\n")}

### Route notes

- \`GET /opportunities\` — top aggregated opportunities ranked by risk then APY (default limit 10).
- \`GET /protocols/:protocol/opportunities\` — protocol slug e.g. \`tinyman\`, \`pact\`, \`folks-finance\`, \`compx\`, \`dorkfi\`, \`myth-finance\`, \`haystack\`, \`reti\`, \`alpha-arcade\`, \`stamm\`, \`morpho\`. AlgoFi and Humble LP holdings are \`GET /positions\` only.
- \`GET /opportunities/search\` — filter by \`platform\`, \`chain\` (\`algorand|base\`), \`type\`, \`minApy\`, \`maxApy\`, \`minTvlUsd\`, \`assetIds\` (comma-separated ASA ids; 0 = ALGO; ANY intersection with opportunity.assetIds).
- \`GET /opportunities/personalized\` — requires \`address\` (Algorand account); premium price; matches opportunities to wallet-held assets using eligibility rules (full/gated venues are not recommended as enterable).  // pragma: allowlist secret
- \`GET /opportunities/:id/history\` — bounded APY/TVL series (\`window=1d|7d|30d\`, default 30d); empty until snapshots exist; includes a stability signal so snapshot APY cannot dominate plan sizing. Research SKU ~0.01 USDC.
- \`POST /eligibility\` — requires \`address\` and \`opportunityIds\`; 0.01 USDC; returns \`canEnter\`, \`missingAssets\`, \`gates\`, \`capacity\`, \`suggestedSwap\`. NFD/creator gates stay unresolved (\`eligibilityFullyCheckable: false\`). Quote-time checks remain authoritative.  // pragma: allowlist secret
- \`POST /plans\` — requires \`address\` and \`budget { assetId, amount }\`; 0.25 USDC compiler SKU; returns ordered eligibility/setup/enter steps with unsigned groups, live multi-router opt-in → swap compose when \`requiredAssetIds\` differ from the budget asset, \`quotes[]\`, expected position delta, and fee totals. Brownie should consume this rather than forking a compiler.  // pragma: allowlist secret
- \`POST /plans/rebalance\` — requires \`address\` plus \`targetWeights\` and/or \`harvestIdle\`; 0.25 USDC; delta claims/exits/swaps/enters as unmerged unsigned groups (not a full unwind).  // pragma: allowlist secret
- \`POST /execution/compose\` — requires \`address\`, \`opportunityId\`, \`fromAssetId\`, \`amount\`; 0.10 USDC; sequenced unsigned groups opt-in → winning swap → enter. Groups never merged; sign only user legs. Failure modes (stale quote, missing opt-in, slippage) on step warnings.  // pragma: allowlist secret
- \`POST /execution/simulate\` — requires \`address\` and compiled \`groups[]\`; 0.10 USDC; predicted balance and position deltas without signing. Fail closed with machine-readable reasons (stale quote, not opted in, min balance, health factor, capacity). \`POST /plans\` attaches \`data.simulation\` when groups are compiled.  // pragma: allowlist secret
- \`POST /policy/validate\` — requires a versioned \`policy\` document plus a compiled \`plan\` and/or proposed \`quotes[]\`; 0.25 USDC; machine-readable \`pass\` / \`reasons[]\` (protocol weight, ALGO reserve, TVL/freshness, no-new-borrows, execution-ready). Fails closed when a required field is missing. Canix does not sign.  // pragma: allowlist secret
- \`POST /sessions\` — 0.25 USDC; mints a walletless prepaid receipt that unlocks N research + M quotes/plans for a TTL. One-shots remain the default.  // pragma: allowlist secret
- \`POST /watch\` — 0.25 USDC recurring retainer; address + thresholds (health factor, claimable USD, APY drop, Réti capacity) and optional HTTPS webhook. Signed, idempotent deliveries. HMAC secret shown once. No wallet keys.  // pragma: allowlist secret
- \`GET /positions\` — requires \`address\` (Algorand account); returns normalized wallet DeFi positions for exactly 0.005 USDC.
- \`GET /positions/claimable\` — requires \`address\`; claim desk with USD, fee/worth-claiming hints, and \`claimAllQuotes\` for exactly 0.001 USDC. Compile via \`POST /execution/quotes\` (~0.1 USDC flat; groups never merged).
- \`GET /execution/shapes\` — free catalog of verified shape keys and requiredInputs (metadata only). \`meta.caveatsDocsPath\` is \`protocol/docs/execution-shapes/protocol-caveats.md\` (pool discovery, opt-ins, min-balance, slippage, liquidity limits, app upgrades). Do not guess those details.
- \`POST /execution/quotes\` — batch unsigned transaction groups for verified shapes; flat ~0.1 USDC per request. Canix never signs or submits. Read each shape's \`docsPath\` plus the protocol caveats doc before filling inputs.
- Multi-router swaps — call free \`POST /swaps/quote\` (parallel compare unless \`router\` is set), sign and submit any group from free \`POST /swaps/optin\`, refresh the short-lived quote, then call paid \`POST /swaps/transactions\` for 0.005 USDC. Amounts are asset base units. Pass the quote object unchanged; do not edit \`payload\`.
- Walletless handoff — sign only the returned \`userSignIndexes\`, preserve any pre-signed members and group order, and submit the complete group through the caller's Algod client.
- Swap costs — the 0.005 USDC x402 access charge is separate from router fees, DEX fees, price impact, and Algorand network fees.

Free routes: \`/health\`, \`/metadata\`, \`/discovery\`, \`/openapi.json\`, \`/.well-known/x402.json\`, \`GET /execution/shapes\`, \`POST /swaps/quote\`, \`POST /swaps/optin\`.

## Error catalog

${discovery.errorCatalog.map((e) => `- \`${e.code}\` (HTTP ${e.httpStatus}) — ${e.description}`).join("\n")}

## Sample responses (trimmed)

### GET /opportunities

\`\`\`json
${JSON.stringify(samples.opportunities, null, 2)}
\`\`\`

### GET /opportunities/search

\`\`\`json
${JSON.stringify(samples.search, null, 2)}
\`\`\`

### GET /opportunities/personalized

\`\`\`json
${JSON.stringify(samples.personalized, null, 2)}
\`\`\`

### GET /opportunities/:id/history

\`\`\`json
${JSON.stringify(samples.history, null, 2)}
\`\`\`

### POST /eligibility

\`\`\`json
${JSON.stringify(samples.eligibility, null, 2)}
\`\`\`

### POST /plans

\`\`\`json
${JSON.stringify(samples.plans, null, 2)}
\`\`\`

### POST /plans/rebalance

\`\`\`json
${JSON.stringify(samples.rebalance, null, 2)}
\`\`\`

### POST /execution/compose

\`\`\`json
${JSON.stringify(samples.compose, null, 2)}
\`\`\`

### POST /execution/simulate

\`\`\`json
${JSON.stringify(samples.simulate, null, 2)}
\`\`\`

### POST /policy/validate

\`\`\`json
${JSON.stringify(samples.policy, null, 2)}
\`\`\`

### GET /protocols/{protocol}/opportunities

\`\`\`json
${JSON.stringify(samples.protocol, null, 2)}
\`\`\`

### GET /execution/shapes

\`\`\`json
${JSON.stringify(samples.executionShapes, null, 2)}
\`\`\`

### POST /execution/quotes

\`\`\`json
${JSON.stringify(samples.executionQuotes, null, 2)}
\`\`\`

### GET /positions

\`\`\`json
${JSON.stringify(samples.positions, null, 2)}
\`\`\`

### GET /positions/claimable

\`\`\`json
${JSON.stringify(samples.positionsClaimable, null, 2)}
\`\`\`

### POST /swaps/quote

\`\`\`json
${JSON.stringify(samples.swapsQuote, null, 2)}
\`\`\`

### POST /swaps/optin

\`\`\`json
${JSON.stringify(samples.swapsOptin, null, 2)}
\`\`\`

### POST /swaps/transactions

\`\`\`json
${JSON.stringify(samples.swapsTransactions, null, 2)}
\`\`\`

### GET /watch/{watchId}

\`\`\`json
${JSON.stringify(samples.watch, null, 2)}
\`\`\`

## Trust and disclaimer

Informational market data only — not financial, investment, tax, or legal advice. Data may be delayed or inaccurate; DeFi protocols carry smart-contract and market risk. API access fees paid via x402 are generally non-refundable. See ${DOCS_SITE}/terms for full terms.

Contact: ${SUPPORT_EMAIL}
`;
}

function main(): void {
  const discovery = loadDiscovery();
  const llmsTxt = buildLlmsTxt(discovery);
  const llmsFullTxt = buildLlmsFullTxt(discovery);

  writeFileSync(resolve(publicDir, "llms.txt"), llmsTxt, "utf-8");
  writeFileSync(resolve(publicDir, "llms-full.txt"), llmsFullTxt, "utf-8");

  const kb = (llmsFullTxt.length / 1024).toFixed(1);
  console.log(`Wrote public/llms.txt (${llmsTxt.length} bytes)`);
  console.log(`Wrote public/llms-full.txt (${llmsFullTxt.length} bytes, ~${kb} KB)`);
}

main();
