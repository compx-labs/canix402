import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";

import { errorResult, jsonResult } from "../lib/tool-result.js";
import type { X402Client } from "../lib/x402-client.js";
import { formatPaidToolResult, paymentSignatureArgSchema } from "./paid.js";

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

export function registerHaystackTools(server: McpServer, client: X402Client): void {
  server.registerTool(
    "canix_get_quote",
    {
      description:
        "Get a stateless Haystack swap quote via POST /swaps/quote. Free endpoint; the response is passed through unchanged.",
      inputSchema: {
        address: AlgorandAddressSchema,
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
        return formatPaidToolResult(result, "0.005", {
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
