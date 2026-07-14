import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";

import { errorResult, jsonResult } from "../lib/tool-result.js";
import type { PaidCallResult, X402Client } from "../lib/x402-client.js";
import { microUsdcToUsdc } from "../lib/x402-client.js";

const ProtocolSchema = z.enum(["tinyman", "pact", "folks-finance", "compx", "dorkfi"]);

interface PaidRequestContext {
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

function paymentSignatureArgSchema() {
  return z
    .string()
    .min(1)
    .describe(
      "Optional PAYMENT-SIGNATURE base64 payload. Omit on first call to receive PAYMENT-REQUIRED details."
    )
    .optional();
}

function formatPaidToolResult(
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
        "Compile an unsigned Algorand transaction group for a verified execution shape (POST /execution/quotes). Paid: ~0.10 USDC via x402. Canix does not sign or submit transactions. Use canix_list_execution_shapes first.",
      inputSchema: {
        shapeKey: z.string().min(1),
        input: z.object({
          userAddress: z.string().min(1),
          assetAId: z.union([z.number().int().min(0), z.string()]),
          assetAAmount: z.union([z.number().int().min(1), z.string().min(1)]).optional(),
          assetBId: z.union([z.number().int().min(0), z.string()]),
          assetBAmount: z.union([z.number().int().min(1), z.string().min(1)]).optional(),
          poolTokenAmount: z.union([z.number().int().min(1), z.string().min(1)]).optional(),
          maxSlippageBps: z.union([z.number().int().min(0).max(10_000), z.string()]),
          poolId: z.string().min(1).optional()
        }),
        paymentSignature: paymentSignatureArgSchema()
      }
    },
    async (args) => {
      try {
        const body = {
          shapeKey: args.shapeKey,
          input: args.input
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
