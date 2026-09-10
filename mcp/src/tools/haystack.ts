import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";

import { errorResult, jsonResult } from "../lib/tool-result.js";
import type { X402Client } from "../lib/x402-client.js";
import { formatPaidToolResult, paidAuth, paymentSignatureArgSchema, sessionReceiptArgSchema } from "./paid.js";

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
const MetaSwapRouterSchema = z.enum([
  "haystack",
  "hogswap",
  "tinyman",
  "pact-smart-router",
  "folks-router",
  "asastats"
]);
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
const QuoteSchema = z.object({
  router: MetaSwapRouterSchema,
  address: AlgorandAddressSchema,
  fromAssetId: z.string().regex(/^[0-9]+$/),
  toAssetId: z.string().regex(/^[0-9]+$/),
  amount: z.string().regex(/^[1-9][0-9]*$/),
  type: SwapTypeSchema,
  quotedAmount: z.string().regex(/^[0-9]+$/),
  minOut: z.string().regex(/^[0-9]+$/),
  networkFeeMicroAlgos: z.string().regex(/^[0-9]+$/),
  slippageBps: z.number().int().min(0).max(10_000),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  score: z.object({
    expectedNetOut: z.string().regex(/^[0-9]+$/),
    minOut: z.string().regex(/^[0-9]+$/),
    expectedIn: z.string().regex(/^[0-9]+$/),
    maxIn: z.string().regex(/^[0-9]+$/).optional(),
    networkFeeMicroAlgos: z.string().regex(/^[0-9]+$/),
    feeAlreadyNetted: z.boolean()
  }),
  alternatives: z.array(
    z.object({
      router: MetaSwapRouterSchema,
      status: z.enum(["quoted", "error", "skipped", "timeout"]),
      expectedNetOut: z.string().regex(/^[0-9]+$/).optional(),
      minOut: z.string().regex(/^[0-9]+$/).optional(),
      networkFeeMicroAlgos: z.string().regex(/^[0-9]+$/).optional(),
      reason: z.string().optional()
    })
  ),
  legs: z.array(z.unknown()),
  payload: z.unknown()
});

export function registerHaystackTools(server: McpServer, client: X402Client): void {
  server.registerTool(
    "canix_get_quote",
    {
      description:
        "Get a stateless multi-router swap quote via POST /swaps/quote. Quotes enabled routers in parallel and returns the best expected net out. Optional router forces one adapter. Pass the response data unchanged into canix_optin / canix_swap.",
      inputSchema: {
        address: AlgorandAddressSchema,
        fromAssetId: AssetIdSchema,
        toAssetId: AssetIdSchema,
        amount: AmountSchema,
        type: SwapTypeSchema.optional(),
        router: MetaSwapRouterSchema.optional(),
        slippage: z.number().min(0).max(100).optional(),
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
          ...(args.router === undefined ? {} : { router: args.router }),
          ...(args.slippage === undefined ? {} : { slippage: args.slippage }),
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
        "Build missing output-asset and application opt-ins via POST /swaps/optin for the winning quote. Free endpoint; pass the quote data object unchanged.",
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
        "Build unsigned swap transactions via paid POST /swaps/transactions (~0.005 USDC) for the winning quote. Omit paymentSignature for x402 preflight, then retry with the same inputs. Canix does not sign or submit.",
      inputSchema: {
        address: AlgorandAddressSchema,
        quote: QuoteSchema,
        slippage: z.number().min(0).max(100),
        paymentSignature: paymentSignatureArgSchema(),
        sessionReceipt: sessionReceiptArgSchema()
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
          ...paidAuth(args)
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
