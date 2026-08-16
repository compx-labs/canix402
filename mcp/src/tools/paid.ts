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
        "Search/filter DeFi opportunities (GET /opportunities/search). Optional assetIds is a comma-separated list of ASA ids (0 = ALGO). Paid: ~0.01 USDC via x402.",
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
        "Fetch wallet-aware opportunities matched to held assets (GET /opportunities/personalized). Applies eligibility rules so full/gated venues are not recommended as enterable. Use canix_check_eligibility for missingAssets/gates/capacity. Paid: ~0.05 USDC via x402.",
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
    "canix_check_eligibility",
    {
      description:
        "Check whether a wallet can enter selected opportunities before quoting (POST /eligibility). Pass address and opportunityIds (1–25). Returns canEnter, missingAssets, gates, capacity, suggestedSwap, and eligibilityFullyCheckable. NFD/creator gates stay unresolved — canEnter is never true until fully checkable. Quote-time on-chain checks remain authoritative. Paid: ~0.01 USDC via x402. Canix does not sign or submit transactions.",
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
        return formatPaidToolResult(result, "0.01", {
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
    "canix_get_plan",
    {
      description:
        "Compile an allocation intent into an ordered unsigned plan (POST /plans). Pass address and budget { assetId, amount } (base units; 0 = ALGO). Optional constraints: maxProtocolWeightBps, noNewBorrows, executionReadyOnly, minTvlUsd, maxSourceAgeSeconds, maxAllocations. Optional opportunityIds pins the compiler. Returns eligibility, optional swap hints, setup/enter quotes[] as independent unsigned groups (never merged), expected position delta, x402 + network fee totals, and expiry. Paid: ~0.25 USDC via x402. Canix does not sign or submit — Brownie and other agents should consume this SKU rather than forking a compiler.",
      inputSchema: {
        address: z.string().min(1),
        budget: z.object({
          assetId: z.number().int().min(0),
          amount: z.string().min(1)
        }),
        constraints: z
          .object({
            maxProtocolWeightBps: z.number().int().min(1).max(10_000).optional(),
            noNewBorrows: z.boolean().optional(),
            executionReadyOnly: z.boolean().optional(),
            minTvlUsd: z.number().min(0).optional(),
            maxSourceAgeSeconds: z.number().int().min(0).optional(),
            maxAllocations: z.number().int().min(1).max(10).optional()
          })
          .optional(),
        opportunityIds: z.array(z.string().min(1)).min(1).max(25).optional(),
        refresh: z.boolean().optional(),
        paymentSignature: paymentSignatureArgSchema()
      }
    },
    async (args) => {
      try {
        const body = {
          address: args.address,
          budget: args.budget,
          ...(args.constraints !== undefined ? { constraints: args.constraints } : {}),
          ...(args.opportunityIds !== undefined
            ? { opportunityIds: args.opportunityIds }
            : {}),
          ...(args.refresh !== undefined ? { refresh: args.refresh } : {})
        };
        const result = await client.fetchPaid("/plans", {
          method: "POST",
          body,
          ...(args.paymentSignature ? { paymentSignature: args.paymentSignature } : {})
        });
        return formatPaidToolResult(result, "0.25", {
          path: "/plans",
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
    "canix_list_claimable",
    {
      description:
        "List claimable DeFi rewards for a wallet (GET /positions/claimable). Returns USD value, network-fee / worth-claiming hints, claim shapeKeys, and claimAllQuotes ready for canix_get_execution_quote. Paid: ~0.001 USDC via x402. Then compile with canix_get_execution_quote (~0.10 USDC flat); groups are never merged. Sign and submit locally — Canix does not hold keys.",
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
        return formatPaidToolResult(result, "0.001", {
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
}