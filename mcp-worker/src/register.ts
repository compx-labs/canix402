import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";

import type { GatewayClient } from "./client.js";
import { errorResult, jsonResult, paidToolResult } from "./tool-result.js";

const ProtocolSchema = z.enum([
  "tinyman",
  "pact",
  "folks-finance",
  "compx",
  "dorkfi",
  "myth-finance",
  "haystack",
  "reti",
  "alpha-arcade"
]);
const AlgorandAddressSchema = z.string().length(58);
const AssetIdSchema = z.union([
  z.number().int().min(0),
  z.string().regex(/^[0-9]+$/)
]);
const AmountSchema = z.union([
  z.number().int().min(1),
  z.string().regex(/^[1-9][0-9]*$/)
]);
const SwapTypeSchema = z.enum(["fixed-input", "fixed-output"]);
const DisabledProtocolSchema = z.enum([
  "Tinyman",
  "Humble",
  "TinymanV2",
  "Algofi",
  "Algomint",
  "Pact",
  "Folks",
  "TAlgo"
]);
const TransactionPayloadSchema = z.object({
  // Haystack may return an empty IV; protocol /swaps/* accepts it.
  iv: z.string(),
  data: z.string().min(1)
});
const QuoteSchema = z.object({
  address: AlgorandAddressSchema,
  fromAssetId: z.string().regex(/^[0-9]+$/),
  toAssetId: z.string().regex(/^[0-9]+$/),
  amount: z.string().regex(/^[1-9][0-9]*$/),
  type: SwapTypeSchema,
  quotedAmount: z.string().regex(/^[0-9]+$/),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  requiredAppOptIns: z.array(z.string().regex(/^[1-9][0-9]*$/)),
  txnPayload: z.union([TransactionPayloadSchema, z.null()]),
  usdIn: z.number().optional(),
  usdOut: z.number().optional(),
  userPriceImpact: z.number().optional(),
  marketPriceImpact: z.number().optional(),
  priceBaseline: z.number().optional(),
  route: z.array(z.unknown()),
  quotes: z.array(z.unknown()),
  protocolFees: z.record(z.string(), z.number())
});

function paymentSignatureArgSchema() {
  return z
    .string()
    .min(1)
    .describe(
      "Optional PAYMENT-SIGNATURE base64 payload. Omit on first call to receive PAYMENT-REQUIRED metadata."
    )
    .optional();
}

export function registerCanixTools(server: McpServer, client: GatewayClient): void {
  server.registerTool(
    "canix_health",
    {
      description: "Check canix402 gateway liveness via GET /health. Free endpoint.",
      inputSchema: {}
    },
    async () => {
      try {
        const body = await client.fetchFree("/health");
        return jsonResult(body);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "canix_get_metadata",
    {
      description: "Fetch canix402 metadata and endpoint policy matrix via GET /metadata. Free endpoint.",
      inputSchema: {}
    },
    async () => {
      try {
        const body = await client.fetchFree("/metadata");
        return jsonResult(body);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "canix_get_discovery",
    {
      description: "Fetch the discovery catalog via GET /discovery. Free endpoint.",
      inputSchema: {}
    },
    async () => {
      try {
        const body = await client.fetchFree("/discovery");
        return jsonResult(body);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "canix_get_openapi",
    {
      description: "Fetch the OpenAPI contract via GET /openapi.json. Free endpoint.",
      inputSchema: {}
    },
    async () => {
      try {
        const body = await client.fetchFree("/openapi.json");
        return jsonResult(body);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "canix_get_token_prices",
    {
      description:
        "Fetch CompX USD oracle prices for Algorand asset IDs via POST /pricing. Free endpoint; missing prices are returned as null.",
      inputSchema: {
        assetIds: z.array(z.number().int().min(0)).min(1).max(100)
      }
    },
    async (args) => {
      try {
        const body = await client.fetchFree("/pricing", {
          method: "POST",
          body: { assetIds: args.assetIds }
        });
        return jsonResult(body);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "canix_list_execution_shapes",
    {
      description:
        "List verified execution shape catalog metadata via GET /execution/shapes (free). Returns shapeKey, requiredInputs, opportunityRole, and docsPath from the live protocol registry. Catalog only — compile unsigned groups with canix_get_execution_quote (paid).",
      inputSchema: {}
    },
    async () => {
      try {
        const body = await client.fetchFree("/execution/shapes");
        return jsonResult(body);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "canix_list_opportunities",
    {
      description:
        "List top aggregated Algorand DeFi opportunities ranked by APY (GET /opportunities). Paid ~0.01 USDC.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
        includeInactive: z.boolean().optional(),
        protocol: ProtocolSchema.optional(),
        paymentSignature: paymentSignatureArgSchema()
      }
    },
    async (args) => {
      try {
        const query = {
          limit: args.limit,
          offset: args.offset,
          includeInactive: args.includeInactive,
          protocol: args.protocol
        };
        const result = await client.fetchPaid("/opportunities", {
          method: "GET",
          query,
          ...(args.paymentSignature ? { paymentSignature: args.paymentSignature } : {})
        });
        return paidToolResult(result, "0.01", {
          path: "/opportunities",
          method: "GET",
          query
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "canix_search_opportunities",
    {
      description:
        "Search/filter opportunities via GET /opportunities/search. Optional assetIds is a comma-separated list of ASA ids (0 = ALGO). Paid ~0.01 USDC.",
      inputSchema: {
        platform: z.string().optional(),
        type: z.string().optional(),
        minApy: z.number().optional(),
        maxApy: z.number().optional(),
        minTvlUsd: z.number().min(0).optional(),
        assetIds: z
          .string()
          .optional()
          .describe("Comma-separated ASA ids (0 = ALGO), e.g. \"0,31566704\""),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
        includeInactive: z.boolean().optional(),
        paymentSignature: paymentSignatureArgSchema()
      }
    },
    async (args) => {
      try {
        const query = {
          platform: args.platform,
          type: args.type,
          minApy: args.minApy,
          maxApy: args.maxApy,
          minTvlUsd: args.minTvlUsd,
          assetIds: args.assetIds,
          limit: args.limit,
          offset: args.offset,
          includeInactive: args.includeInactive
        };
        const result = await client.fetchPaid("/opportunities/search", {
          method: "GET",
          query,
          ...(args.paymentSignature ? { paymentSignature: args.paymentSignature } : {})
        });
        return paidToolResult(result, "0.01", {
          path: "/opportunities/search",
          method: "GET",
          query
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "canix_get_personalized_opportunities",
    {
      description:
        "Fetch wallet-aware opportunities matched to held assets (GET /opportunities/personalized). Applies eligibility rules so full/gated venues are not recommended as enterable. Use canix_check_eligibility for missingAssets/gates/capacity. Paid ~0.05 USDC.",
      inputSchema: {
        address: AlgorandAddressSchema,
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
        includeInactive: z.boolean().optional(),
        paymentSignature: paymentSignatureArgSchema()
      }
    },
    async (args) => {
      try {
        const query = {
          address: args.address,
          limit: args.limit,
          offset: args.offset,
          includeInactive: args.includeInactive
        };
        const result = await client.fetchPaid("/opportunities/personalized", {
          method: "GET",
          query,
          ...(args.paymentSignature ? { paymentSignature: args.paymentSignature } : {})
        });
        return paidToolResult(result, "0.05", {
          path: "/opportunities/personalized",
          method: "GET",
          query
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "canix_check_eligibility",
    {
      description:
        "Check whether a wallet can enter selected opportunities before quoting (POST /eligibility). Pass address and opportunityIds (1–25). Returns canEnter, missingAssets, gates, capacity, suggestedSwap, and eligibilityFullyCheckable. NFD/creator gates stay unresolved — canEnter is never true until fully checkable. Paid ~0.01 USDC.",
      inputSchema: {
        address: z.string().min(1),
        opportunityIds: z.array(z.string().min(1)).min(1).max(25),
        refresh: z.boolean().optional(),
        paymentSignature: paymentSignatureArgSchema()
      }
    },
    async (args) => {
      try {
        const body = {
          address: args.address,
          opportunityIds: args.opportunityIds,
          ...(args.refresh !== undefined ? { refresh: args.refresh } : {})
        };
        const result = await client.fetchPaid("/eligibility", {
          method: "POST",
          body,
          ...(args.paymentSignature ? { paymentSignature: args.paymentSignature } : {})
        });
        return paidToolResult(result, "0.01", {
          path: "/eligibility",
          method: "POST",
          body
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "canix_get_protocol_opportunities",
    {
      description:
        "List opportunities for a single protocol (GET /protocols/{protocol}/opportunities). Paid ~0.01 USDC.",
      inputSchema: {
        protocol: ProtocolSchema,
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
        includeInactive: z.boolean().optional(),
        paymentSignature: paymentSignatureArgSchema()
      }
    },
    async (args) => {
      try {
        const path = `/protocols/${encodeURIComponent(args.protocol)}/opportunities`;
        const query = {
          limit: args.limit,
          offset: args.offset,
          includeInactive: args.includeInactive
        };
        const result = await client.fetchPaid(path, {
          method: "GET",
          query,
          ...(args.paymentSignature ? { paymentSignature: args.paymentSignature } : {})
        });
        return paidToolResult(result, "0.01", {
          path,
          method: "GET",
          query
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "canix_get_positions",
    {
      description:
        "Fetch Algorand DeFi positions for a wallet via GET /positions. Paid ~0.005 USDC. First call returns PAYMENT-REQUIRED metadata; retry with paymentSignature.",
      inputSchema: {
        address: z.string().min(1),
        paymentSignature: paymentSignatureArgSchema()
      }
    },
    async (args) => {
      try {
        const query = {
          address: args.address
        };
        const result = await client.fetchPaid("/positions", {
          method: "GET",
          query,
          ...(args.paymentSignature ? { paymentSignature: args.paymentSignature } : {})
        });
        return paidToolResult(result, "0.005", {
          path: "/positions",
          method: "GET",
          query
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "canix_list_claimable",
    {
      description:
        "List claimable DeFi rewards for a wallet via GET /positions/claimable. Returns USD value, network-fee / worth-claiming hints, claim shapeKeys, and claimAllQuotes ready for canix_get_execution_quote. Paid ~0.001 USDC. Then compile with canix_get_execution_quote (~0.10 USDC flat); groups are never merged. Sign and submit locally.",
      inputSchema: {
        address: z.string().min(1),
        paymentSignature: paymentSignatureArgSchema()
      }
    },
    async (args) => {
      try {
        const query = {
          address: args.address
        };
        const result = await client.fetchPaid("/positions/claimable", {
          method: "GET",
          query,
          ...(args.paymentSignature ? { paymentSignature: args.paymentSignature } : {})
        });
        return paidToolResult(result, "0.001", {
          path: "/positions/claimable",
          method: "GET",
          query
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "canix_get_execution_quote",
    {
      description:
        "Compile one or more unsigned Algorand transaction groups (POST /execution/quotes). Pass quotes: [{ shapeKey, input }, ...]. Required input fields vary by shapeKey — call canix_list_execution_shapes and use each shape's requiredInputs (userAddress is always required). Response data is an ExecutableQuote array. Paid flat ~0.10 USDC per request (not per item). On failure, error.details includes quoteIndex and shapeKey.",
      inputSchema: {
        quotes: z
          .array(
            z.object({
              shapeKey: z.string().min(1),
              input: z
                .object({
                  userAddress: z.string().min(1)
                })
                .catchall(
                  z.union([
                    z.string(),
                    z.number(),
                    z.boolean(),
                    z.null()
                  ])
                )
            })
          )
          .min(1),
        paymentSignature: paymentSignatureArgSchema()
      }
    },
    async (args) => {
      try {
        const body = {
          quotes: args.quotes
        };
        const result = await client.fetchPaid("/execution/quotes", {
          method: "POST",
          body,
          ...(args.paymentSignature ? { paymentSignature: args.paymentSignature } : {})
        });
        return paidToolResult(result, "0.10", {
          path: "/execution/quotes",
          method: "POST",
          body
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );


  server.registerTool(
    "canix_get_quote",
    {
      description:
        "Get a stateless Haystack swap quote via POST /swaps/quote. Free endpoint; the response is passed through unchanged.",
      inputSchema: {
        address: z.string().min(1),
        fromAssetId: AssetIdSchema,
        toAssetId: AssetIdSchema,
        amount: AmountSchema,
        type: SwapTypeSchema.optional(),
        disabledProtocols: z.array(DisabledProtocolSchema).optional(),
        maxGroupSize: z.number().int().min(1).max(16).optional(),
        maxDepth: z.number().int().min(1).max(4).optional()
      }
    },
    async (args) => {
      try {
        const body = {
          address: args.address,
          fromAssetId: args.fromAssetId,
          toAssetId: args.toAssetId,
          amount: args.amount,
          ...(args.type === undefined ? {} : { type: args.type }),
          ...(args.disabledProtocols === undefined
            ? {}
            : { disabledProtocols: args.disabledProtocols }),
          ...(args.maxGroupSize === undefined ? {} : { maxGroupSize: args.maxGroupSize }),
          ...(args.maxDepth === undefined ? {} : { maxDepth: args.maxDepth })
        };
        const response = await client.fetchFree("/swaps/quote", {
          method: "POST",
          body
        });
        return jsonResult(response);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "canix_optin",
    {
      description:
        "Build missing Haystack output-asset and application opt-ins via POST /swaps/optin. Free endpoint; the response is passed through unchanged.",
      inputSchema: {
        address: AlgorandAddressSchema,
        quote: QuoteSchema
      }
    },
    async (args) => {
      try {
        const body = {
          address: args.address,
          quote: args.quote
        };
        const response = await client.fetchFree("/swaps/optin", {
          method: "POST",
          body
        });
        return jsonResult(response);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "canix_swap",
    {
      description:
        "Build Haystack swap transactions via paid POST /swaps/transactions (~0.005 USDC). Omit paymentSignature for x402 preflight, then retry with the same inputs.",
      inputSchema: {
        address: AlgorandAddressSchema,
        quote: QuoteSchema,
        slippage: z.number().min(0).max(100),
        paymentSignature: paymentSignatureArgSchema()
      }
    },
    async (args) => {
      try {
        const body = {
          address: args.address,
          quote: args.quote,
          slippage: args.slippage
        };
        const result = await client.fetchPaid("/swaps/transactions", {
          method: "POST",
          body,
          ...(args.paymentSignature ? { paymentSignature: args.paymentSignature } : {})
        });
        return paidToolResult(result, "0.005", {
          path: "/swaps/transactions",
          method: "POST",
          body
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}

export function registerCanixResources(server: McpServer, client: GatewayClient): void {
  server.registerResource(
    "discovery",
    "canix://discovery",
    {
      description: "Live canix402 discovery document (GET /discovery)",
      mimeType: "application/json"
    },
    async (uri) => {
      const body = await client.fetchFree("/discovery");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(body, null, 2)
          }
        ]
      };
    }
  );

  server.registerResource(
    "openapi",
    "canix://openapi",
    {
      description: "Live canix402 OpenAPI contract (GET /openapi.json)",
      mimeType: "application/json"
    },
    async (uri) => {
      const body = await client.fetchFree("/openapi.json");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(body, null, 2)
          }
        ]
      };
    }
  );

  server.registerResource(
    "execution-shapes",
    "canix://execution-shapes",
    {
      description:
        "Live verified execution shape catalog (GET /execution/shapes). Metadata only; quotes remain paid.",
      mimeType: "application/json"
    },
    async (uri) => {
      const body = await client.fetchFree("/execution/shapes");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(body, null, 2)
          }
        ]
      };
    }
  );
}

export function registerCanixPrompts(server: McpServer): void {
  server.registerPrompt(
    "analyze-opportunity",
    {
      description:
        "Guide structured evaluation of a canix402 opportunity record without calling paid endpoints.",
      argsSchema: {
        opportunityJson: z
          .string()
          .describe("JSON string of a single opportunity record from canix402")
      }
    },
    async ({ opportunityJson }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Analyze this Algorand DeFi opportunity from canix402.",
              "Evaluate APY/APR quality, TVL depth, protocol risk, asset exposure, and whether an execution shape exists for acting on it.",
              "Do not invent on-chain state. If data is missing, say what additional canix402 tool calls would help.",
              "",
              "Opportunity JSON:",
              opportunityJson
            ].join("\n")
          }
        }
      ]
    })
  );
}
