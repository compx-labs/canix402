import { schemas } from "./schemas";
import type { WebMcpToolSpec } from "./types";

const readOnly = {
  readOnlyHint: true,
  untrustedContentHint: true
} as const;

const mutating = {
  readOnlyHint: false,
  untrustedContentHint: true
} as const;

/**
 * WebMCP tool names for NEO-304: locked live MCP set plus 13.8 session tools
 * and 13.9 watch retainer tools as shipped in this repo. Do not invent a
 * second session or watch model.
 */
export const WEBMCP_TOOL_NAMES = [
  "canix_health",
  "canix_get_metadata",
  "canix_get_discovery",
  "canix_get_openapi",
  "canix_get_token_prices",
  "canix_list_execution_shapes",
  "canix_list_opportunities",
  "canix_search_opportunities",
  "canix_get_personalized_opportunities",
  "canix_get_opportunity_history",
  "canix_check_eligibility",
  "canix_get_plan",
  "canix_get_protocol_opportunities",
  "canix_get_positions",
  "canix_list_claimable",
  "canix_get_execution_quote",
  "canix_get_quote",
  "canix_optin",
  "canix_swap",
  "canix_create_session",
  "canix_refresh_session",
  "canix_get_session",
  "canix_create_watch",
  "canix_refresh_watch",
  "canix_get_watch",
  "canix_rotate_watch_secret"
] as const;

export type WebMcpToolName = (typeof WEBMCP_TOOL_NAMES)[number];

export const WEBMCP_TOOLS: WebMcpToolSpec[] = [
  {
    name: "canix_health",
    description: "Check canix402 gateway liveness via GET /health. Free endpoint.",
    inputSchema: schemas.emptyObject(),
    annotations: readOnly,
    access: "free",
    allowSessionReceipt: false,
    http: { method: "GET", path: "/health" }
  },
  {
    name: "canix_get_metadata",
    description:
      "Fetch canix402 metadata and endpoint policy matrix via GET /metadata. Free endpoint.",
    inputSchema: schemas.emptyObject(),
    annotations: readOnly,
    access: "free",
    allowSessionReceipt: false,
    http: { method: "GET", path: "/metadata" }
  },
  {
    name: "canix_get_discovery",
    description: "Fetch the discovery catalog via GET /discovery. Free endpoint.",
    inputSchema: schemas.emptyObject(),
    annotations: readOnly,
    access: "free",
    allowSessionReceipt: false,
    http: { method: "GET", path: "/discovery" }
  },
  {
    name: "canix_get_openapi",
    description: "Fetch the OpenAPI contract via GET /openapi.json. Free endpoint.",
    inputSchema: schemas.emptyObject(),
    annotations: readOnly,
    access: "free",
    allowSessionReceipt: false,
    http: { method: "GET", path: "/openapi.json" }
  },
  {
    name: "canix_get_token_prices",
    description:
      "Fetch CompX USD oracle prices for Algorand asset IDs via POST /pricing. Free endpoint; missing prices are returned as null.", // pragma: allowlist secret
    inputSchema: schemas.objectSchema(
      {
        assetIds: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: { type: "integer", minimum: 0 }
        }
      },
      ["assetIds"]
    ),
    annotations: readOnly,
    access: "free",
    allowSessionReceipt: false,
    http: { method: "POST", path: "/pricing" }
  },
  {
    name: "canix_list_execution_shapes",
    description:
      "List verified execution shape catalog metadata via GET /execution/shapes (free). Returns shapeKey, requiredInputs, opportunityRole, docsPath, and meta.caveatsDocsPath from the live protocol registry. Catalog only — compile unsigned groups with canix_get_execution_quote (paid). Do not guess pool discovery, opt-ins, min-balance, slippage, liquidity limits, or app upgrades — read protocol/docs/execution-shapes/protocol-caveats.md and each shape's docsPath.",
    inputSchema: schemas.emptyObject(),
    annotations: readOnly,
    access: "free",
    allowSessionReceipt: false,
    http: { method: "GET", path: "/execution/shapes" }
  },
  {
    name: "canix_list_opportunities",
    description:
      "List top aggregated DeFi opportunities across supported chains ranked by risk then APY (GET /opportunities). Each row includes chain (algorand|base). Paid ~0.01 USDC.", // pragma: allowlist secret
    inputSchema: schemas.withPaidAuth({
      limit: schemas.pagination.limit,
      offset: schemas.pagination.offset,
      includeInactive: schemas.pagination.includeInactive,
      protocol: schemas.protocol,
      chain: { type: "string", enum: ["algorand", "base"] }
    }),
    annotations: mutating,
    access: "paid",
    fallbackPriceUsdc: "0.01",
    allowSessionReceipt: true,
    http: {
      method: "GET",
      path: "/opportunities",
      queryParams: ["limit", "offset", "includeInactive", "protocol", "chain"]
    }
  },
  {
    name: "canix_search_opportunities",
    description:
      "Search/filter opportunities via GET /opportunities/search. Optional chain=algorand|base. Optional assetIds is a comma-separated list of ASA ids (0 = ALGO). Paid ~0.01 USDC.",
    inputSchema: schemas.withPaidAuth({
      platform: { type: "string" },
      type: { type: "string" },
      minApy: { type: "number" },
      maxApy: { type: "number" },
      minTvlUsd: { type: "number", minimum: 0 },
      chain: { type: "string", enum: ["algorand", "base"] },
      assetIds: {
        type: "string",
        description: "Comma-separated ASA ids (0 = ALGO)."
      },
      limit: schemas.pagination.limit,
      offset: schemas.pagination.offset,
      includeInactive: schemas.pagination.includeInactive
    }),
    annotations: mutating,
    access: "paid",
    fallbackPriceUsdc: "0.01",
    allowSessionReceipt: true,
    http: {
      method: "GET",
      path: "/opportunities/search",
      queryParams: [
        "platform",
        "type",
        "minApy",
        "maxApy",
        "minTvlUsd",
        "assetIds",
        "chain",
        "limit",
        "offset",
        "includeInactive"
      ]
    }
  },
  {
    name: "canix_get_personalized_opportunities",
    description:
      "Fetch wallet-aware opportunities matched to held assets (GET /opportunities/personalized). Applies eligibility rules so full/gated venues are not recommended as enterable. Use canix_check_eligibility for missingAssets/gates/capacity. Paid ~0.05 USDC.",
    inputSchema: schemas.withPaidAuth(
      {
        address: schemas.algoAddress,
        limit: schemas.pagination.limit,
        offset: schemas.pagination.offset,
        includeInactive: schemas.pagination.includeInactive
      },
      ["address"]
    ),
    annotations: mutating,
    access: "paid",
    fallbackPriceUsdc: "0.05",
    allowSessionReceipt: true,
    http: {
      method: "GET",
      path: "/opportunities/personalized",
      queryParams: ["address", "limit", "offset", "includeInactive"]
    }
  },
  {
    name: "canix_get_opportunity_history",
    description:
      "Fetch a bounded APY/TVL history series for one opportunity (GET /opportunities/{opportunityId}/history). Window is 1d, 7d, or 30d (default 30d). Empty points until snapshots exist. Includes a stability signal so snapshot APY cannot dominate plan sizing. Paid ~0.01 USDC.",
    inputSchema: schemas.withPaidAuth(
      {
        opportunityId: { type: "string", minLength: 1 },
        window: { type: "string", enum: ["1d", "7d", "30d"] }
      },
      ["opportunityId"]
    ),
    annotations: mutating,
    access: "paid",
    fallbackPriceUsdc: "0.01",
    allowSessionReceipt: true,
    http: {
      method: "GET",
      path: "/opportunities/{opportunityId}/history",
      pathParams: ["opportunityId"],
      queryParams: ["window"]
    }
  },
  {
    name: "canix_check_eligibility",
    description:
      "Check whether a wallet can enter selected opportunities before quoting (POST /eligibility). Pass address and opportunityIds (1–25). Returns canEnter, missingAssets, gates, capacity, suggestedSwap, and eligibilityFullyCheckable. NFD/creator gates stay unresolved — canEnter is never true until fully checkable. Paid ~0.01 USDC.",
    inputSchema: schemas.withPaidAuth(
      {
        address: schemas.address,
        opportunityIds: {
          type: "array",
          minItems: 1,
          maxItems: 25,
          items: { type: "string", minLength: 1 }
        },
        refresh: { type: "boolean" }
      },
      ["address", "opportunityIds"]
    ),
    annotations: mutating,
    access: "paid",
    fallbackPriceUsdc: "0.01",
    allowSessionReceipt: true,
    http: { method: "POST", path: "/eligibility" }
  },
  {
    name: "canix_get_plan",
    description:
      "Compile an allocation intent into an ordered unsigned plan (POST /plans). Pass address and budget { assetId, amount } (base units; 0 = ALGO). Optional constraints and opportunityIds. Optional swapSlippage for multi-router compose. Returns eligibility, live multi-router opt-in/swap groups when requiredAssetIds differ from the budget asset, setup/enter quotes[] as independent unsigned groups (never merged), expected position delta, attached data.simulation when groups compiled, x402 + network fee totals, and expiry. Paid ~0.25 USDC. Canix does not sign or submit.",
    inputSchema: schemas.withPaidAuth(
      {
        address: schemas.address,
        budget: {
          type: "object",
          required: ["assetId", "amount"],
          properties: {
            assetId: { type: "integer", minimum: 0 },
            amount: { type: "string", minLength: 1 }
          }
        },
        constraints: schemas.constraints,
        opportunityIds: {
          type: "array",
          minItems: 1,
          maxItems: 25,
          items: { type: "string", minLength: 1 }
        },
        swapSlippage: { type: "number", minimum: 0, maximum: 100 },
        refresh: { type: "boolean" }
      },
      ["address", "budget"]
    ),
    annotations: mutating,
    access: "paid",
    fallbackPriceUsdc: "0.25",
    allowSessionReceipt: true,
    http: { method: "POST", path: "/plans" }
  },
  {
    name: "canix_get_protocol_opportunities",
    description:
      "List opportunities for a single protocol (GET /protocols/{protocol}/opportunities). Paid ~0.01 USDC.",
    inputSchema: schemas.withPaidAuth(
      {
        protocol: schemas.protocol,
        limit: schemas.pagination.limit,
        offset: schemas.pagination.offset,
        includeInactive: schemas.pagination.includeInactive
      },
      ["protocol"]
    ),
    annotations: mutating,
    access: "paid",
    fallbackPriceUsdc: "0.01",
    allowSessionReceipt: true,
    http: {
      method: "GET",
      path: "/protocols/{protocol}/opportunities",
      pathParams: ["protocol"],
      queryParams: ["limit", "offset", "includeInactive"]
    }
  },
  {
    name: "canix_get_positions",
    description:
      "Fetch Algorand DeFi positions for a wallet via GET /positions. Paid ~0.005 USDC. First call returns PAYMENT-REQUIRED metadata; retry with paymentSignature.", // pragma: allowlist secret
    inputSchema: schemas.withPaidAuth({ address: schemas.address }, ["address"]),
    annotations: mutating,
    access: "paid",
    fallbackPriceUsdc: "0.005",
    allowSessionReceipt: true,
    http: {
      method: "GET",
      path: "/positions",
      queryParams: ["address"]
    }
  },
  {
    name: "canix_list_claimable",
    description:
      "List claimable DeFi rewards for a wallet via GET /positions/claimable. Returns USD value, network-fee / worth-claiming hints, claim shapeKeys, and claimAllQuotes ready for canix_get_execution_quote. Paid ~0.001 USDC. Then compile with canix_get_execution_quote (~0.10 USDC flat); groups are never merged. Sign and submit locally.",
    inputSchema: schemas.withPaidAuth({ address: schemas.address }, ["address"]),
    annotations: mutating,
    access: "paid",
    fallbackPriceUsdc: "0.001",
    allowSessionReceipt: true,
    http: {
      method: "GET",
      path: "/positions/claimable",
      queryParams: ["address"]
    }
  },
  {
    name: "canix_get_execution_quote",
    description:
      "Compile one or more unsigned groups (POST /execution/quotes). Algorand shapes return Algorand groups; Morpho shapes (base:morpho:vault:*) return unsigned Base calldata. Pass an Algorand userAddress unless the shape is on Base. Omitting a Base address does not change rank, eligibility, price, or access. Pass quotes: [{ shapeKey, input }, ...]. Required input fields vary by shapeKey — call canix_list_execution_shapes and use each shape's requiredInputs (userAddress is always required). Response data is an ExecutableQuote array. Paid flat ~0.10 USDC per request on Algorand or Base (not per item). On failure, error.details includes quoteIndex and shapeKey. Do not guess pool discovery, opt-ins, min-balance, slippage, liquidity limits, or app upgrades — read protocol/docs/execution-shapes/protocol-caveats.md and each shape's docsPath.", // pragma: allowlist secret
    inputSchema: schemas.withPaidAuth(
      {
        quotes: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["shapeKey", "input"],
            properties: {
              shapeKey: { type: "string", minLength: 1 },
              input: {
                type: "object",
                required: ["userAddress"],
                properties: {
                  userAddress: { type: "string", minLength: 1 }
                },
                additionalProperties: {
                  anyOf: [
                    { type: "string" },
                    { type: "number" },
                    { type: "boolean" },
                    { type: "null" }
                  ]
                }
              }
            }
          }
        }
      },
      ["quotes"]
    ),
    annotations: mutating,
    access: "paid",
    fallbackPriceUsdc: "0.10",
    allowSessionReceipt: true,
    http: { method: "POST", path: "/execution/quotes" }
  },
  {
    name: "canix_get_quote",
    description:
      "Get a stateless multi-router swap quote via POST /swaps/quote. Quotes enabled routers in parallel and returns the best expected net out. Optional router forces one adapter. Pass the response data unchanged into canix_optin / canix_swap.",
    inputSchema: schemas.objectSchema(
      {
        address: schemas.address,
        fromAssetId: schemas.assetId,
        toAssetId: schemas.assetId,
        amount: schemas.amount,
        type: schemas.swapType,
        router: schemas.swapRouter,
        slippage: { type: "number", minimum: 0, maximum: 100 },
        disabledProtocols: {
          type: "array",
          items: schemas.disabledProtocol
        },
        maxGroupSize: { type: "integer", minimum: 1, maximum: 16 },
        maxDepth: { type: "integer", minimum: 1, maximum: 4 }
      },
      ["address", "fromAssetId", "toAssetId", "amount"]
    ),
    annotations: readOnly,
    access: "free",
    allowSessionReceipt: false,
    http: { method: "POST", path: "/swaps/quote" }
  },
  {
    name: "canix_optin",
    description:
      "Build missing output-asset and application opt-ins via POST /swaps/optin for the winning quote. Free endpoint; pass the quote data object unchanged.",
    inputSchema: schemas.objectSchema(
      {
        address: schemas.algoAddress,
        quote: schemas.quote
      },
      ["address", "quote"]
    ),
    annotations: readOnly,
    access: "free",
    allowSessionReceipt: false,
    http: { method: "POST", path: "/swaps/optin" }
  },
  {
    name: "canix_swap",
    description:
      "Build unsigned swap transactions via paid POST /swaps/transactions (~0.005 USDC) for the winning quote. Omit paymentSignature for x402 preflight, then retry with the same inputs. Canix does not sign or submit.",
    inputSchema: schemas.withPaidAuth(
      {
        address: schemas.algoAddress,
        quote: schemas.quote,
        slippage: { type: "number", minimum: 0, maximum: 100 }
      },
      ["address", "quote", "slippage"]
    ),
    annotations: mutating,
    access: "paid",
    fallbackPriceUsdc: "0.005",
    allowSessionReceipt: true,
    http: { method: "POST", path: "/swaps/transactions" }
  },
  {
    name: "canix_create_session",
    description:
      "Buy a prepaid agent session (POST /sessions, ~0.25 USDC). One x402 payment mints a walletless receipt that unlocks N research calls and M quotes/plans until TTL. Sessions are receipts, not keys. Create/refresh cannot be paid with an existing session.",
    inputSchema: schemas.withPaidAuth({}, undefined, false),
    annotations: mutating,
    access: "paid",
    fallbackPriceUsdc: "0.25",
    allowSessionReceipt: false,
    http: { method: "POST", path: "/sessions" }
  },
  {
    name: "canix_refresh_session",
    description:
      "Refresh a prepaid session (POST /sessions/refresh, ~0.25 USDC). Resets N/M and TTL in place, or mints a new receipt if the previous one is gone. One-shot only.",
    inputSchema: schemas.withPaidAuth(
      {
        sessionId: { type: "string", minLength: 1 }
      },
      undefined,
      false
    ),
    annotations: mutating,
    access: "paid",
    fallbackPriceUsdc: "0.25",
    allowSessionReceipt: false,
    http: { method: "POST", path: "/sessions/refresh" }
  },
  {
    name: "canix_get_session",
    description:
      "Read remaining N/M and expiry for a prepaid session receipt (GET /sessions/{sessionId}). Free. Prefer this over the public indexer /transactions showcase.",
    inputSchema: schemas.objectSchema(
      {
        sessionId: { type: "string", minLength: 1 }
      },
      ["sessionId"]
    ),
    annotations: readOnly,
    access: "free",
    allowSessionReceipt: false,
    http: {
      method: "GET",
      path: "/sessions/{sessionId}",
      pathParams: ["sessionId"]
    }
  },
  {
    name: "canix_create_watch",
    description:
      "Register a paid wallet watch retainer (POST /watch, ~0.25 USDC). Address + thresholds + optional HTTPS webhook. HMAC secret shown once. Canix never stores wallet keys.",
    inputSchema: schemas.withPaidAuth(
      {
        address: schemas.algoAddress,
        thresholds: schemas.watchThresholds,
        webhookUrl: { type: "string", minLength: 8, maxLength: 2048 }
      },
      ["address", "thresholds"],
      false
    ),
    annotations: mutating,
    access: "paid",
    fallbackPriceUsdc: "0.25",
    allowSessionReceipt: false,
    http: { method: "POST", path: "/watch" }
  },
  {
    name: "canix_refresh_watch",
    description:
      "Refresh a paid watch retainer (POST /watch/refresh, ~0.25 USDC). Extends TTL. Optionally rotateSecret. One-shot only.",
    inputSchema: schemas.withPaidAuth(
      {
        watchId: { type: "string", minLength: 1 },
        rotateSecret: { type: "boolean" }
      },
      ["watchId"],
      false
    ),
    annotations: mutating,
    access: "paid",
    fallbackPriceUsdc: "0.25",
    allowSessionReceipt: false,
    http: { method: "POST", path: "/watch/refresh" }
  },
  {
    name: "canix_get_watch",
    description:
      "Read a watch receipt and recent threshold firings (GET /watch/{watchId}). Free. Does not return the HMAC secret.",
    inputSchema: schemas.objectSchema(
      {
        watchId: { type: "string", minLength: 1 }
      },
      ["watchId"]
    ),
    annotations: readOnly,
    access: "free",
    allowSessionReceipt: false,
    http: {
      method: "GET",
      path: "/watch/{watchId}",
      pathParams: ["watchId"]
    }
  },
  {
    name: "canix_rotate_watch_secret",
    description:
      "Rotate the watch webhook HMAC secret (POST /watch/{watchId}/rotate-secret). Free. Requires the current secret.",
    inputSchema: schemas.objectSchema(
      {
        watchId: { type: "string", minLength: 1 },
        webhookSecret: { type: "string", minLength: 1 }
      },
      ["watchId", "webhookSecret"]
    ),
    annotations: mutating,
    access: "free",
    allowSessionReceipt: false,
    http: {
      method: "POST",
      path: "/watch/{watchId}/rotate-secret",
      pathParams: ["watchId"]
    }
  }
];

const toolsByName = new Map(WEBMCP_TOOLS.map((tool) => [tool.name, tool]));

export function getWebMcpTool(name: string): WebMcpToolSpec | undefined {
  return toolsByName.get(name);
}
