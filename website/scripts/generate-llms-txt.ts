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
const PROTOCOLS = ["Tinyman", "Pact", "Folks Finance", "CompX", "Dork.fi", "Myth Finance", "Haystack"] as const;

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

function endpointLine(endpoint: DiscoveryEndpoint): string {
  const price = formatPrice(endpoint);
  const params = [
    ...(endpoint.pathParams ?? []).map((p) => `:${p}`),
    ...(endpoint.queryParams ?? []).map((p) => `${p}=`)
  ];
  const paramNote = params.length > 0 ? ` Params: ${params.join(", ")}.` : "";
  return `- \`${endpoint.method} ${endpoint.path}\` (${price}) — ${endpoint.summary}.${paramNote}`;
}

function buildLlmsTxt(discovery: DiscoveryDocument): string {
  const paidEndpoints = discovery.endpoints.filter((e) => e.access === "paid");
  const docs = `${DOCS_SITE}`;

  return `# CANIX402

> x402-gated Algorand DeFi data and walletless transaction API for autonomous agents. Pay in USDC micropayments at the gateway edge, fetch normalized APY/TVL data, and build locally signable Haystack swap groups.

Use the **Caddy gateway** (\`${GATEWAY}\`) for all API calls. Discovery, Haystack quotes, and opt-in preparation are free; data routes and Haystack swap transaction generation require x402 payment as advertised. The API never receives wallet keys or submits transactions. For the full integration guide in one file, see [llms-full.txt](${docs}/llms-full.txt).

## API (machine-readable)

- [Discovery](${GATEWAY}/discovery): endpoint catalog, x402 prices, error codes, facilitator metadata
- [OpenAPI](${GATEWAY}/openapi.json): schemas, query parameters, response examples
- [x402 manifest](${GATEWAY}/.well-known/x402.json): directory indexing surface for agent tooling and x402 directories
- [MCP server](${docs}/mcp): remote Streamable HTTP MCP at \`${MCP_URL}\` (walletless pass-through)

## Integration guides

- [Quickstart](${docs}/quickstart): agent onboarding (MCP or direct HTTP)
- [MCP setup](${docs}/mcp): connect to \`${MCP_URL}\`, paid-tool paymentSignature retry
- [x402 payment flow](${docs}/x402): preflight 402, sign USDC transfer, retry with PAYMENT-SIGNATURE
- [Examples](${docs}/examples): copy-paste curl and sample payloads
- [Endpoint catalog](${docs}/endpoints): human-readable route table sourced from discovery
- [Live transactions](${docs}/transactions): recent inbound USDC payments to the x402 pay-to wallet

## Paid data routes

${paidEndpoints.map((e) => `- [${e.method} ${e.path}](${GATEWAY}${e.path.replace(":protocol", "{protocol}")}): ${formatPrice(e)} — ${e.summary}`).join("\n")}

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
    protocol: loadSample("protocol-opportunities.sample.json")
  };

  return `# CANIX402 — full agent integration guide

> x402-gated Algorand DeFi data and walletless transaction API (version ${discovery.apiVersion}). Normalized yield data and Haystack swap-group generation for autonomous agents; USDC micropayments at the gateway; no server-side signing or submission.

## Overview

- **Gateway base URL:** \`${GATEWAY}\`
- **Documentation site:** ${DOCS_SITE}
- **Supported protocols:** ${PROTOCOLS.join(", ")}
- **Operator:** ${OPERATOR}
- **Support:** ${SUPPORT_EMAIL}
- **Terms:** ${DOCS_SITE}/terms

Opportunity responses are normalized records with fields such as \`protocol\`, \`opportunityType\`, \`opportunityId\`, \`assetPair\`, \`apy\`, \`apr\`, \`tvlUsd\`, \`sourceTimestamp\`, and \`fetchedAt\`. Numeric precision follows the published OpenAPI \`x-precision\` contract (typically 6 decimal places).

## Machine-readable contracts

| Resource | URL |
| --- | --- |
| Discovery | ${GATEWAY}/discovery |
| OpenAPI | ${GATEWAY}/openapi.json |
| x402 manifest | ${GATEWAY}/.well-known/x402.json |
| MCP server | ${DOCS_SITE}/mcp (remote \`${MCP_URL}\`, streamable-http) |
| LLM index | ${DOCS_SITE}/llms.txt |

Always call the **gateway**, not an internal upstream API. x402 enforcement, \`PAYMENT-REQUIRED\`, and settlement happen at the gateway edge.

### MCP server

Prefer the canix402 MCP for agent hosts (Cursor, Claude Desktop). Endpoint: \`${MCP_URL}\` (streamable-http). Metadata: \`${MCP_WELL_KNOWN}\`. Walletless: paid tool preflight returns payment requirements; retry with \`paymentSignature\`. Tools include \`canix_list_opportunities\`, \`canix_get_positions\`, \`canix_get_execution_quote\`, and free discovery helpers. See ${DOCS_SITE}/mcp.

## x402 payment flow

1. **Discover** — \`GET ${GATEWAY}/discovery\` and \`GET ${GATEWAY}/openapi.json\` (free).
2. **Preflight** — call a paid route without \`PAYMENT-SIGNATURE\`; expect HTTP **402** with \`PAYMENT-REQUIRED\`.
3. **Sign** — client-side: build a USDC ASA transfer matching the advertised requirement (\`scheme\`, \`network\`, \`asset\`, \`payTo\`, \`maxAmountRequired\`). Wallet keys stay on the client.
4. **Retry** — repeat the request with \`PAYMENT-SIGNATURE\` (base64 JSON payload). Success returns **200** and may include \`PAYMENT-RESPONSE\`.

Default payment context (confirm against live discovery before integrating):

- **Protocol version:** 2
- **Network:** ${network}
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

- \`GET /opportunities\` — top aggregated opportunities ranked by APY (default limit 10).
- \`GET /protocols/:protocol/opportunities\` — protocol slug e.g. \`tinyman\`, \`pact\`, \`folks-finance\`, \`compx\`, \`dorkfi\`, \`myth-finance\`, \`haystack\`, \`reti\`.
- \`GET /opportunities/search\` — filter by \`platform\`, \`type\`, \`minApy\`, \`maxApy\`, \`minTvlUsd\`.
- \`GET /opportunities/personalized\` — requires \`address\` (Algorand account); premium price; matches opportunities to wallet-held assets.
- \`GET /positions\` — requires \`address\` (Algorand account); returns normalized wallet DeFi positions for exactly 0.005 USDC.
- Haystack swaps — call free \`POST /swaps/quote\`, sign and submit any group from free \`POST /swaps/optin\`, refresh the short-lived quote, then call paid \`POST /swaps/transactions\` for 0.005 USDC. Amounts are asset base units.
- Walletless handoff — sign only the returned \`userSignIndexes\`, preserve Haystack pre-signed members and group order, and submit the complete group through the caller's Algod client.
- Swap costs — the 0.005 USDC x402 access charge is separate from Haystack's SDK-default 10 bps output fee/referral, DEX fees, price impact, and Algorand network fees.

Free routes: \`/health\`, \`/metadata\`, \`/discovery\`, \`/openapi.json\`, \`/.well-known/x402.json\`, \`POST /swaps/quote\`, \`POST /swaps/optin\`.

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

### GET /protocols/{protocol}/opportunities

\`\`\`json
${JSON.stringify(samples.protocol, null, 2)}
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
