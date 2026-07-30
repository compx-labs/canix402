import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";

import { errorResult, jsonResult } from "../lib/tool-result.js";
import type { PaidCallResult, X402Client } from "../lib/x402-client.js";
import { microUsdcToUsdc } from "../lib/x402-client.js";

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

export interface PaidRequestContext {
  path: string;
  method: "GET" | "POST";
  query?: Record<string, unknown>;
  body?: unknown;
}

function paidMeta(result: PaidCallResult, fallbackPriceUsdc: string) {
  const accepted = result.paymentRequired?.accepts?.[0];
  const priceUsdc =
    microUsdcToUsdc(accepted?.maxAmountRequired ?? accepted?.amount) ?? fallbackPriceUsdc;

  return {
    priceUsdc,
    required: result.status === 402,
    paymentRequiredHeader: result.paymentRequiredHeader,
    paymentRequired: result.paymentRequired,
    paymentResponsePresent: Boolean(result.paymentResponseHeader),
    paymentResponseHeader: result.paymentResponseHeader
  };
}

export function paymentSignatureArgSchema() {
  return z
    .string()
    .min(1)
    .describe(
      "Optional PAYMENT-SIGNATURE base64 payload. Omit on first call to receive PAYMENT-REQUIRED details."
    )
    .optional();
}

export function formatPaidToolResult(
  result: PaidCallResult,
  fallbackPriceUsdc: string,
  request: PaidRequestContext
) {
  const payment = paidMeta(result, fallbackPriceUsdc);

  if (result.status === 402) {
    return jsonResult({
      error: "PAYMENT_REQUIRED",
      message: "Paid endpoint requires x402 payment. Sign PAYMENT-REQUIRED and retry with paymentSignature.",
      mcpPayment: payment,
      request,
      retry: {
        arg: "paymentSignature",
        header: "PAYMENT-SIGNATURE"
      },
      gatewayResponse: result.body
    });
  }

  if (result.body && typeof result.body === "object" && !Array.isArray(result.body)) {
    return jsonResult({
      ...(result.body as Record<string, unknown>),
      mcpPayment: payment
    });
  }

  return jsonResult({
    data: result.body,
    mcpPayment: payment
  });
}

export function registerPaidTools(server: McpServer, client: X402Client): void {
  server.registerTool(
    "canix_list_opportunities",
    {
      description:
        "List top aggregated Algorand DeFi opportunities ranked by APY (GET /opportunities). Paid: ~0.01 USDC via x402. First call returns PAYMENT-REQUIRED metadata; retry with paymentSignature.",
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
        return formatPaidToolResult(result, "0.01", {
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
        "Search/filter DeFi opportunities (GET /opportunities/search). Paid: ~0.01 USDC via x402.",
      inputSchema: {
        platform: z.string().optional(),
        type: z.string().optional(),
        minApy: z.number().optional(),
        maxApy: z.number().optional(),
        minTvlUsd: z.number().min(0).optional(),
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
          limit: args.limit,
          offset: args.offset,
          includeInactive: args.includeInactive
        };
        const result = await client.fetchPaid("/opportunities/search", {
          method: "GET",
          query,
          ...(args.paymentSignature ? { paymentSignature: args.paymentSignature } : {})
        });
        return formatPaidToolResult(result, "0.01", {
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
        "Fetch wallet-aware opportunities matched to held assets (GET /opportunities/personalized). Paid: ~0.05 USDC via x402.",
      inputSchema: {
        address: z.string().min(1),
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
        return formatPaidToolResult(result, "0.05", {
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
    "canix_get_protocol_opportunities",
    {
      description:
        "List opportunities for a single protocol (GET /protocols/{protocol}/opportunities). Paid: ~0.01 USDC via x402.",
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
        const result = await client.fetchPaid(
          path,
          {
            method: "GET",
            query,
            ...(args.paymentSignature ? { paymentSignature: args.paymentSignature } : {})
          }
        );
        return formatPaidToolResult(result, "0.01", {
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
        "Fetch Algorand DeFi positions for a wallet (GET /positions). Paid: ~0.005 USDC via x402. First call returns PAYMENT-REQUIRED metadata; retry with paymentSignature.",
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
        return formatPaidToolResult(result, "0.005", {
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
    "canix_get_execution_quote",
    {
      description:
        "Compile one or more unsigned Algorand transaction groups for verified execution shapes (POST /execution/quotes). Pass quotes: [{ shapeKey, input }, ...] (min 1). Required input fields vary by shapeKey — call canix_list_execution_shapes and use each shape's requiredInputs (userAddress is always required). Response data is an ExecutableQuote array in the same order — groups are never merged. Paid: flat ~0.10 USDC via x402 per request (not per quote item). On failure, error.details includes quoteIndex and shapeKey. Canix does not sign or submit transactions.",
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
        return formatPaidToolResult(result, "0.10", {
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
    "canix_publish_strategy",
    {
      description:
        "Publish a weight-based strategy (POST /strategies). Mints a tradable ARC-3 strategy NFT and stores the composition. Paid 100 USDC (Canix-only; no NFT-holder share). Legs must use verified shapeKeys with weights summing to 10000 bps.",
      inputSchema: {
        creatorAddress: z.string().min(58).max(58),
        name: z.string().min(1).max(120),
        description: z.string().min(1).max(4000),
        tags: z.array(z.string().min(1).max(64)).max(32).optional(),
        legs: z
          .array(
            z.object({
              shapeKey: z.string().min(1),
              opportunityId: z.string().min(1).optional(),
              venueIds: z.array(z.string().min(1)).min(1).optional(),
              weightBps: z.number().int().min(1).max(10_000)
            })
          )
          .min(1)
          .max(32),
        paymentSignature: paymentSignatureArgSchema()
      }
    },
    async (args) => {
      try {
        const body = {
          creatorAddress: args.creatorAddress,
          name: args.name,
          description: args.description,
          tags: args.tags,
          legs: args.legs
        };
        const result = await client.fetchPaid("/strategies", {
          method: "POST",
          body,
          ...(args.paymentSignature ? { paymentSignature: args.paymentSignature } : {})
        });
        return formatPaidToolResult(result, "100", {
          path: "/strategies",
          method: "POST",
          body
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "canix_revise_strategy",
    {
      description:
        "Revise a strategy in place (POST /strategies/{strategyId}). Paid 1 USDC (Canix-only). Caller must be the current NFT holder. At most one successful revise per 14 days per strategyId.",
      inputSchema: {
        strategyId: z.number().int().min(1),
        holderAddress: z.string().min(58).max(58),
        name: z.string().min(1).max(120).optional(),
        description: z.string().min(1).max(4000).optional(),
        tags: z.array(z.string().min(1).max(64)).max(32).optional(),
        legs: z
          .array(
            z.object({
              shapeKey: z.string().min(1),
              opportunityId: z.string().min(1).optional(),
              venueIds: z.array(z.string().min(1)).min(1).optional(),
              weightBps: z.number().int().min(1).max(10_000)
            })
          )
          .min(1)
          .max(32),
        paymentSignature: paymentSignatureArgSchema()
      }
    },
    async (args) => {
      try {
        const body = {
          holderAddress: args.holderAddress,
          name: args.name,
          description: args.description,
          tags: args.tags,
          legs: args.legs
        };
        const path = `/strategies/${args.strategyId}`;
        const result = await client.fetchPaid(path, {
          method: "POST",
          body,
          ...(args.paymentSignature ? { paymentSignature: args.paymentSignature } : {})
        });
        return formatPaidToolResult(result, "1", {
          path,
          method: "POST",
          body
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "canix_compile_strategy",
    {
      description:
        "Compile a published strategy into unsigned ExecutableQuote[] (POST /strategies/{strategyId}/compile). Paid 0.1 USDC. 50% of this access fee is paid weekly to the strategy NFT holder. Prefer payment note x402:v2:strategy:{strategyId} when building PAYMENT-SIGNATURE.",
      inputSchema: {
        strategyId: z.number().int().min(1),
        userAddress: z.string().min(58).max(58),
        amount: z.string().min(1).regex(/^[0-9]+$/),
        legInputs: z
          .array(
            z.object({
              legIndex: z.number().int().min(0),
              input: z.record(z.string(), z.unknown())
            })
          )
          .optional(),
        paymentSignature: paymentSignatureArgSchema()
      }
    },
    async (args) => {
      try {
        const body = {
          userAddress: args.userAddress,
          amount: args.amount,
          legInputs: args.legInputs
        };
        const path = `/strategies/${args.strategyId}/compile`;
        const result = await client.fetchPaid(path, {
          method: "POST",
          body,
          ...(args.paymentSignature ? { paymentSignature: args.paymentSignature } : {})
        });
        return formatPaidToolResult(result, "0.1", {
          path,
          method: "POST",
          body
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}