import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";

import { errorResult, jsonResult } from "../lib/tool-result.js";
import type { X402Client } from "../lib/x402-client.js";
import { microUsdcToUsdc } from "../lib/x402-client.js";

const ProtocolSchema = z.enum(["tinyman", "pact", "folks-finance", "compx", "dorkfi"]);

function paidMeta(
  result: {
    paymentResponseHeader: string | null;
    paymentRequired: {
      accepts?: Array<{ maxAmountRequired?: string; amount?: string }>;
    } | null;
  },
  fallbackPriceUsdc: string
) {
  const accepted = result.paymentRequired?.accepts?.[0];
  const priceUsdc =
    microUsdcToUsdc(accepted?.maxAmountRequired ?? accepted?.amount) ?? fallbackPriceUsdc;

  return {
    priceUsdc,
    paymentResponsePresent: Boolean(result.paymentResponseHeader)
  };
}

export function registerPaidTools(server: McpServer, client: X402Client): void {
  server.registerTool(
    "canix_list_opportunities",
    {
      description:
        "List top aggregated Algorand DeFi opportunities ranked by APY (GET /opportunities). Paid: ~0.01 USDC via x402. Requires CANIX402_WALLET_MNEMONIC for auto-pay.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
        includeInactive: z.boolean().optional(),
        protocol: ProtocolSchema.optional()
      }
    },
    async (args) => {
      try {
        const result = await client.fetchPaid("/opportunities", {
          method: "GET",
          query: {
            limit: args.limit,
            offset: args.offset,
            includeInactive: args.includeInactive,
            protocol: args.protocol
          },
          estimatedPriceUsdc: "0.01"
        });
        return jsonResult({
          ...((result.body as object) ?? {}),
          mcpPayment: paidMeta(result, "0.01")
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
        includeInactive: z.boolean().optional()
      }
    },
    async (args) => {
      try {
        const result = await client.fetchPaid("/opportunities/search", {
          method: "GET",
          query: {
            platform: args.platform,
            type: args.type,
            minApy: args.minApy,
            maxApy: args.maxApy,
            minTvlUsd: args.minTvlUsd,
            limit: args.limit,
            offset: args.offset,
            includeInactive: args.includeInactive
          },
          estimatedPriceUsdc: "0.01"
        });
        return jsonResult({
          ...((result.body as object) ?? {}),
          mcpPayment: paidMeta(result, "0.01")
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
        includeInactive: z.boolean().optional()
      }
    },
    async (args) => {
      try {
        const result = await client.fetchPaid("/opportunities/personalized", {
          method: "GET",
          query: {
            address: args.address,
            limit: args.limit,
            offset: args.offset,
            includeInactive: args.includeInactive
          },
          estimatedPriceUsdc: "0.05"
        });
        return jsonResult({
          ...((result.body as object) ?? {}),
          mcpPayment: paidMeta(result, "0.05")
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
        includeInactive: z.boolean().optional()
      }
    },
    async (args) => {
      try {
        const result = await client.fetchPaid(
          `/protocols/${encodeURIComponent(args.protocol)}/opportunities`,
          {
            method: "GET",
            query: {
              limit: args.limit,
              offset: args.offset,
              includeInactive: args.includeInactive
            },
            estimatedPriceUsdc: "0.01"
          }
        );
        return jsonResult({
          ...((result.body as object) ?? {}),
          mcpPayment: paidMeta(result, "0.01")
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
        })
      }
    },
    async (args) => {
      try {
        const result = await client.fetchPaid("/execution/quotes", {
          method: "POST",
          body: {
            shapeKey: args.shapeKey,
            input: args.input
          },
          estimatedPriceUsdc: "0.10"
        });
        return jsonResult({
          ...((result.body as object) ?? {}),
          mcpPayment: paidMeta(result, "0.10")
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
