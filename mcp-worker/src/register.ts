import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
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
  "alpha-arcade",
  "stamm",
  "morpho"
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

function paymentSignatureArgSchema() {
  return z
    .string()
    .min(1)
    .describe(
      "Optional PAYMENT-SIGNATURE base64 payload. Omit on first call to receive PAYMENT-REQUIRED metadata."
    )
    .optional();
}

function sessionReceiptArgSchema() {
  return z
    .string()
    .min(1)
    .describe(
      "Prepaid session receipt (X-Canix-Session). Omit to pay per request with paymentSignature. If this header was sent, Caddy skipped x402; a 402 SESSION_* means drop the header and retry with paymentSignature."
    )
    .optional();
}

function paidAuth(args: {
  paymentSignature?: string | undefined;
  sessionReceipt?: string | undefined;
}) {
  if (args.paymentSignature) {
    return { paymentSignature: args.paymentSignature };
  }
  return {
    ...(args.sessionReceipt ? { headers: { "X-Canix-Session": args.sessionReceipt } } : {})
  };
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
        "List verified execution shape catalog metadata via GET /execution/shapes (free). Returns shapeKey, requiredInputs, opportunityRole, docsPath, and meta.caveatsDocsPath from the live protocol registry. Catalog only — compile unsigned groups with canix_get_execution_quote (paid). Do not guess pool discovery, opt-ins, min-balance, slippage, liquidity limits, or app upgrades — read protocol/docs/execution-shapes/protocol-caveats.md and each shape's docsPath.",
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
        "List top aggregated DeFi opportunities across supported chains ranked by risk then APY (GET /opportunities). Each row includes chain (algorand|base). Paid ~0.01 USDC.", // pragma: allowlist secret
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
        includeInactive: z.boolean().optional(),
        protocol: ProtocolSchema.optional(),
        chain: z.enum(["algorand", "base"]).optional(),
        paymentSignature: paymentSignatureArgSchema(),
        sessionReceipt: sessionReceiptArgSchema()
      }
    },
    async (args) => {
      try {
        const query = {
          limit: args.limit,
          offset: args.offset,
          includeInactive: args.includeInactive,
          protocol: args.protocol,
          chain: args.chain
        };
        const result = await client.fetchPaid("/opportunities", {
          method: "GET",
          query,
          ...paidAuth(args)
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
        "Search/filter opportunities via GET /opportunities/search. Optional chain=algorand|base. Optional assetIds is a comma-separated list of ASA ids (0 = ALGO). Paid ~0.01 USDC.",
      inputSchema: {
        platform: z.string().optional(),
        type: z.string().optional(),
        minApy: z.number().optional(),
        maxApy: z.number().optional(),
        minTvlUsd: z.number().min(0).optional(),
        chain: z.enum(["algorand", "base"]).optional(),
        assetIds: z
          .string()
          .optional()
          .describe("Comma-separated ASA ids (0 = ALGO), e.g. \"0,31566704\""),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
        includeInactive: z.boolean().optional(),
        paymentSignature: paymentSignatureArgSchema(),
        sessionReceipt: sessionReceiptArgSchema()
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
          chain: args.chain,
          assetIds: args.assetIds,
          limit: args.limit,
          offset: args.offset,
          includeInactive: args.includeInactive
        };
        const result = await client.fetchPaid("/opportunities/search", {
          method: "GET",
          query,
          ...paidAuth(args)
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
        paymentSignature: paymentSignatureArgSchema(),
        sessionReceipt: sessionReceiptArgSchema()
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
          ...paidAuth(args)
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
    "canix_get_opportunity_history",
    {
      description:
        "Fetch a bounded APY/TVL history series for one opportunity (GET /opportunities/{opportunityId}/history?window=). Window is 1d, 7d, or 30d (default 30d). Empty points until snapshots exist — not a warehouse backfill. Includes a stability signal so snapshot APY cannot dominate plan sizing. Paid ~0.01 USDC.",
      inputSchema: {
        opportunityId: z.string().min(1),
        window: z.enum(["1d", "7d", "30d"]).optional(),
        paymentSignature: paymentSignatureArgSchema(),
        sessionReceipt: sessionReceiptArgSchema()
      }
    },
    async (args) => {
      try {
        const path = `/opportunities/${encodeURIComponent(args.opportunityId)}/history`;
        const query = {
          window: args.window
        };
        const result = await client.fetchPaid(path, {
          method: "GET",
          query,
          ...paidAuth(args)
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
    "canix_check_eligibility",
    {
      description:
        "Check whether a wallet can enter selected opportunities before quoting (POST /eligibility). Pass address and opportunityIds (1–25). Returns canEnter, missingAssets, gates, capacity, suggestedSwap, and eligibilityFullyCheckable. NFD/creator gates stay unresolved — canEnter is never true until fully checkable. Paid ~0.01 USDC.",
      inputSchema: {
        address: z.string().min(1),
        opportunityIds: z.array(z.string().min(1)).min(1).max(25),
        refresh: z.boolean().optional(),
        paymentSignature: paymentSignatureArgSchema(),
        sessionReceipt: sessionReceiptArgSchema()
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
          ...paidAuth(args)
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
    "canix_get_plan",
    {
      description:
        "Compile an allocation intent into an ordered unsigned plan (POST /plans). Pass address and budget { assetId, amount } (base units; 0 = ALGO). Optional constraints and opportunityIds. Optional swapSlippage for multi-router compose. Returns eligibility, live multi-router opt-in/swap groups when requiredAssetIds differ from the budget asset, setup/enter quotes[] as independent unsigned groups (never merged), expected position delta, attached data.simulation when groups compiled, x402 + network fee totals, and expiry. Paid ~0.25 USDC. Canix does not sign or submit.",
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
        swapSlippage: z.number().min(0).max(100).optional(),
        refresh: z.boolean().optional(),
        paymentSignature: paymentSignatureArgSchema(),
        sessionReceipt: sessionReceiptArgSchema()
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
          ...(args.swapSlippage !== undefined ? { swapSlippage: args.swapSlippage } : {}),
          ...(args.refresh !== undefined ? { refresh: args.refresh } : {})
        };
        const result = await client.fetchPaid("/plans", {
          method: "POST",
          body,
          ...paidAuth(args)
        });
        return paidToolResult(result, "0.25", {
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
    "canix_get_rebalance_plan",
    {
      description:
        "Compile a delta rebalance plan (POST /plans/rebalance). Pass address plus targetWeights (bps summing to 10000) and/or harvestIdle to claim and redeploy idle ALGO. Ordered unsigned groups only (claims, exits, swaps, enters) — deltas, never a full unwind. Groups never merged. Attaches data.simulation when compiled groups exist. Paid ~0.25 USDC. Canix does not sign or submit.",
      inputSchema: {
        address: z.string().min(1),
        targetWeights: z
          .array(
            z.object({
              opportunityId: z.string().min(1),
              weightBps: z.number().int().min(0).max(10_000)
            })
          )
          .min(1)
          .max(25)
          .optional(),
        harvestIdle: z.boolean().optional(),
        includeClaims: z.boolean().optional(),
        algoReserveMicroAlgos: z.string().min(1).optional(),
        minDeltaBps: z.number().int().min(0).max(10_000).optional(),
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
        swapSlippage: z.number().min(0).max(100).optional(),
        refresh: z.boolean().optional(),
        paymentSignature: paymentSignatureArgSchema(),
        sessionReceipt: sessionReceiptArgSchema()
      }
    },
    async (args) => {
      try {
        const body = {
          address: args.address,
          ...(args.targetWeights !== undefined ? { targetWeights: args.targetWeights } : {}),
          ...(args.harvestIdle !== undefined ? { harvestIdle: args.harvestIdle } : {}),
          ...(args.includeClaims !== undefined ? { includeClaims: args.includeClaims } : {}),
          ...(args.algoReserveMicroAlgos !== undefined
            ? { algoReserveMicroAlgos: args.algoReserveMicroAlgos }
            : {}),
          ...(args.minDeltaBps !== undefined ? { minDeltaBps: args.minDeltaBps } : {}),
          ...(args.constraints !== undefined ? { constraints: args.constraints } : {}),
          ...(args.swapSlippage !== undefined ? { swapSlippage: args.swapSlippage } : {}),
          ...(args.refresh !== undefined ? { refresh: args.refresh } : {})
        };
        const result = await client.fetchPaid("/plans/rebalance", {
          method: "POST",
          body,
          ...paidAuth(args)
        });
        return paidToolResult(result, "0.25", {
          path: "/plans/rebalance",
          method: "POST",
          body
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "canix_validate_policy",
    {
      description:
        "Validate a compiled plan or proposed quotes[] against an operator policy document (POST /policy/validate). Pass policy { schemaVersion: \"1.0.0\" } plus plan and/or quotes[]. Returns { pass, reasons[] }. Fails closed when a required field is missing — does not re-quote on-chain. Paid ~0.25 USDC. Canix does not sign or submit.",
      inputSchema: {
        policy: z.object({
          schemaVersion: z.literal("1.0.0"),
          maxProtocolWeightBps: z.number().int().min(1).max(10_000).optional(),
          minAlgoReserveMicroAlgos: z.string().min(1).optional(),
          minTvlUsd: z.number().min(0).optional(),
          maxSourceAgeSeconds: z.number().int().min(0).optional(),
          noNewBorrows: z.boolean().optional(),
          executionReadyOnly: z.boolean().optional()
        }),
        plan: z.record(z.string(), z.unknown()).optional(),
        quotes: z
          .array(
            z
              .object({
                shapeKey: z.string().min(1).optional(),
                opportunityId: z.string().min(1).optional(),
                protocol: z.string().min(1).optional(),
                weightBps: z.number().int().min(0).max(10_000).optional(),
                allocatedAmount: z.string().min(1).optional(),
                allocatedAssetId: z.number().int().min(0).optional(),
                tvlUsd: z.number().optional(),
                sourceTimestamp: z.string().min(1).optional(),
                executionReady: z.boolean().optional()
              })
              .catchall(z.unknown())
          )
          .min(1)
          .max(25)
          .optional(),
        walletAlgoMicroAlgos: z.string().min(1).optional(),
        evaluatedAt: z.string().min(1).optional(),
        paymentSignature: paymentSignatureArgSchema(),
        sessionReceipt: sessionReceiptArgSchema()
      }
    },
    async (args) => {
      try {
        const body = {
          policy: args.policy,
          ...(args.plan !== undefined ? { plan: args.plan } : {}),
          ...(args.quotes !== undefined ? { quotes: args.quotes } : {}),
          ...(args.walletAlgoMicroAlgos !== undefined
            ? { walletAlgoMicroAlgos: args.walletAlgoMicroAlgos }
            : {}),
          ...(args.evaluatedAt !== undefined ? { evaluatedAt: args.evaluatedAt } : {})
        };
        const result = await client.fetchPaid("/policy/validate", {
          method: "POST",
          body,
          ...paidAuth(args)
        });
        return paidToolResult(result, "0.25", {
          path: "/policy/validate",
          method: "POST",
          body
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "canix_compose_enter",
    {
      description:
        "Compose “I hold asset A, I want this opportunity” into sequenced unsigned groups (POST /execution/compose): opt-in → winning swap → enter, driven by requiredAssetIds. Groups are never merged. Preserve signer indexes / pre-signed members. Paid ~0.10 USDC. Canix does not sign or submit.",
      inputSchema: {
        address: z.string().min(1),
        opportunityId: z.string().min(1),
        fromAssetId: z.number().int().min(0),
        amount: z.string().min(1),
        slippage: z.number().min(0).max(100).optional(),
        refresh: z.boolean().optional(),
        paymentSignature: paymentSignatureArgSchema(),
        sessionReceipt: sessionReceiptArgSchema()
      }
    },
    async (args) => {
      try {
        const body = {
          address: args.address,
          opportunityId: args.opportunityId,
          fromAssetId: args.fromAssetId,
          amount: args.amount,
          ...(args.slippage !== undefined ? { slippage: args.slippage } : {}),
          ...(args.refresh !== undefined ? { refresh: args.refresh } : {})
        };
        const result = await client.fetchPaid("/execution/compose", {
          method: "POST",
          body,
          ...paidAuth(args)
        });
        return paidToolResult(result, "0.1", {
          path: "/execution/compose",
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
        paymentSignature: paymentSignatureArgSchema(),
        sessionReceipt: sessionReceiptArgSchema()
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
          ...paidAuth(args)
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
        paymentSignature: paymentSignatureArgSchema(),
        sessionReceipt: sessionReceiptArgSchema()
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
          ...paidAuth(args)
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
        paymentSignature: paymentSignatureArgSchema(),
        sessionReceipt: sessionReceiptArgSchema()
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
          ...paidAuth(args)
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
    "canix_simulate_execution",
    {
      description:
        "Simulate compiled unsigned groups without signing or submitting (POST /execution/simulate). Pass address and groups[] from a plan or canix_get_execution_quote. Returns predicted balance and position deltas. Fails closed with machine-readable reasons (stale-quote, not-opted-in, min-balance, health-factor-too-low, capacity). Paid ~0.10 USDC. POST /plans attaches data.simulation when compiled groups are available. Canix does not sign or submit.",
      inputSchema: {
        address: z.string().min(1),
        groups: z
          .array(
            z
              .object({
                shapeKey: z.string().min(1).optional(),
                expiresAt: z.string().min(1).optional(),
                opportunityId: z.string().min(1).optional(),
                encodedTransactions: z.array(z.string().min(1)).optional(),
                transactions: z.array(z.record(z.string(), z.unknown())).optional()
              })
              .catchall(z.unknown())
          )
          .min(1)
          .max(25),
        paymentSignature: paymentSignatureArgSchema(),
        sessionReceipt: sessionReceiptArgSchema()
      }
    },
    async (args) => {
      try {
        const body = {
          address: args.address,
          groups: args.groups
        };
        const result = await client.fetchPaid("/execution/simulate", {
          method: "POST",
          body,
          ...paidAuth(args)
        });
        return paidToolResult(result, "0.10", {
          path: "/execution/simulate",
          method: "POST",
          body
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
        "Compile one or more unsigned Algorand transaction groups (POST /execution/quotes). Pass quotes: [{ shapeKey, input }, ...]. Required input fields vary by shapeKey — call canix_list_execution_shapes and use each shape's requiredInputs (userAddress is always required). Response data is an ExecutableQuote array. Paid flat ~0.10 USDC per request (not per item). On failure, error.details includes quoteIndex and shapeKey. Do not guess pool discovery, opt-ins, min-balance, slippage, liquidity limits, or app upgrades — read protocol/docs/execution-shapes/protocol-caveats.md and each shape's docsPath.", // pragma: allowlist secret
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
        paymentSignature: paymentSignatureArgSchema(),
        sessionReceipt: sessionReceiptArgSchema()
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
          ...paidAuth(args)
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
        "Get a stateless multi-router swap quote via POST /swaps/quote. Quotes enabled routers in parallel and returns the best expected net out. Optional router forces one adapter. Pass the response data unchanged into canix_optin / canix_swap.",
      inputSchema: {
        address: z.string().min(1),
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
    "canix_create_session",
    {
      description:
        "Buy a prepaid agent session (POST /sessions, ~0.25 USDC). One x402 payment mints a walletless receipt that unlocks N research calls and M quotes/plans until TTL. Sessions are receipts, not keys. Create/refresh cannot be paid with an existing session.",
      inputSchema: {
        paymentSignature: paymentSignatureArgSchema()
      }
    },
    async (args) => {
      try {
        const result = await client.fetchPaid("/sessions", {
          method: "POST",
          body: {},
          ...(args.paymentSignature ? { paymentSignature: args.paymentSignature } : {})
        });
        return paidToolResult(result, "0.25", {
          path: "/sessions",
          method: "POST",
          body: {}
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "canix_refresh_session",
    {
      description:
        "Refresh a prepaid session (POST /sessions/refresh, ~0.25 USDC). Resets N/M and TTL in place, or mints a new receipt if the previous one is gone. One-shot only.",
      inputSchema: {
        sessionId: z.string().min(1).optional(),
        paymentSignature: paymentSignatureArgSchema()
      }
    },
    async (args) => {
      try {
        const body = args.sessionId ? { sessionId: args.sessionId } : {};
        const result = await client.fetchPaid("/sessions/refresh", {
          method: "POST",
          body,
          ...(args.paymentSignature ? { paymentSignature: args.paymentSignature } : {})
        });
        return paidToolResult(result, "0.25", {
          path: "/sessions/refresh",
          method: "POST",
          body
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "canix_get_session",
    {
      description:
        "Read remaining N/M and expiry for a prepaid session receipt (GET /sessions/{sessionId}). Free. Prefer this over the public indexer /transactions showcase.",
      inputSchema: {
        sessionId: z.string().min(1)
      }
    },
    async (args) => {
      try {
        const path = `/sessions/${encodeURIComponent(args.sessionId)}`;
        const result = await client.fetchPaid(path, { method: "GET" });
        return jsonResult(result.body);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  const watchThresholdsSchema = z
    .object({
      healthFactor: z.number().gt(0).optional(),
      claimableUsd: z.number().min(0).optional(),
      apyDropBps: z.number().int().min(1).max(100_000).optional(),
      retiCapacity: z
        .union([
          z.literal(true),
          z.object({
            minStakerSlotsRemaining: z.number().int().min(0).optional(),
            minAlgoRoomMicroAlgos: z.string().regex(/^[0-9]+$/).optional()
          })
        ])
        .optional()
    })
    .refine(
      (value) =>
        value.healthFactor !== undefined ||
        value.claimableUsd !== undefined ||
        value.apyDropBps !== undefined ||
        value.retiCapacity !== undefined,
      { message: "At least one threshold is required." }
    );

  server.registerTool(
    "canix_create_watch",
    {
      description:
        "Register a paid wallet watch retainer (POST /watch, ~0.25 USDC). Pass address + thresholds (healthFactor, claimableUsd, apyDropBps, retiCapacity) and optional HTTPS webhookUrl. Returns a walletless receipt and HMAC secret once. Notifications fire on threshold crossings with X-Canix-Signature and an idempotency key. Canix never stores wallet keys.",
      inputSchema: {
        address: AlgorandAddressSchema, // pragma: allowlist secret
        thresholds: watchThresholdsSchema,
        webhookUrl: z.string().url().optional(),
        paymentSignature: paymentSignatureArgSchema()
      }
    },
    async (args) => {
      try {
        const body = {
          address: args.address,
          thresholds: args.thresholds,
          ...(args.webhookUrl ? { webhookUrl: args.webhookUrl } : {})
        };
        const result = await client.fetchPaid("/watch", {
          method: "POST",
          body,
          ...(args.paymentSignature ? { paymentSignature: args.paymentSignature } : {})
        });
        return paidToolResult(result, "0.25", {
          path: "/watch",
          method: "POST",
          body
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "canix_refresh_watch",
    {
      description:
        "Refresh a paid watch retainer (POST /watch/refresh, ~0.25 USDC). Extends TTL. Optionally rotateSecret to mint a new HMAC key (returned once). One-shot only.",
      inputSchema: {
        watchId: z.string().min(1),
        rotateSecret: z.boolean().optional(),
        paymentSignature: paymentSignatureArgSchema()
      }
    },
    async (args) => {
      try {
        const body = {
          watchId: args.watchId,
          ...(args.rotateSecret !== undefined ? { rotateSecret: args.rotateSecret } : {})
        };
        const result = await client.fetchPaid("/watch/refresh", {
          method: "POST",
          body,
          ...(args.paymentSignature ? { paymentSignature: args.paymentSignature } : {})
        });
        return paidToolResult(result, "0.25", {
          path: "/watch/refresh",
          method: "POST",
          body
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "canix_get_watch",
    {
      description:
        "Read a watch receipt and recent threshold firings (GET /watch/{watchId}). Free. Does not return the HMAC secret.",
      inputSchema: {
        watchId: z.string().min(1)
      }
    },
    async (args) => {
      try {
        const path = `/watch/${encodeURIComponent(args.watchId)}`;
        const result = await client.fetchPaid(path, { method: "GET" });
        return jsonResult(result.body);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "canix_rotate_watch_secret",
    {
      description:
        "Rotate the watch webhook HMAC secret (POST /watch/{watchId}/rotate-secret). Free. Requires the current secret. The new secret is returned once.",
      inputSchema: {
        watchId: z.string().min(1),
        webhookSecret: z.string().min(1)
      }
    },
    async (args) => {
      try {
        const path = `/watch/${encodeURIComponent(args.watchId)}/rotate-secret`;
        const result = await client.fetchPaid(path, {
          method: "POST",
          body: {},
          headers: { "X-Canix-Watch-Secret": args.webhookSecret }
        });
        return jsonResult(result.body);
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
        "Live verified execution shape catalog (GET /execution/shapes). Metadata only; quotes remain paid. meta.caveatsDocsPath is protocol/docs/execution-shapes/protocol-caveats.md.",
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

  server.registerResource(
    "session",
    "canix://session",
    {
      description:
        "Prepaid session policy (budget N/M, TTL, receipt URI template). Remaining quota is canix://session/{sessionId}, GET /sessions/{sessionId}, or canix_get_session. Sessions are receipts, not keys.",
      mimeType: "application/json"
    },
    async (uri) => {
      const body = (await client.fetchFree("/discovery")) as {
        data?: { sessionPolicy?: unknown };
        sessionPolicy?: unknown;
      };
      const sessionPolicy = body?.data?.sessionPolicy ?? body?.sessionPolicy ?? body;
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(sessionPolicy, null, 2)
          }
        ]
      };
    }
  );

  server.registerResource(
    "session-receipt",
    new ResourceTemplate("canix://session/{sessionId}", { list: undefined }),
    {
      description:
        "Prepaid session receipt remaining N/M (GET /sessions/{sessionId}). Unknown or expired receipts return 402 SESSION_INVALID/SESSION_EXPIRED.",
      mimeType: "application/json"
    },
    async (uri, { sessionId }) => {
      const id = Array.isArray(sessionId) ? sessionId[0] : sessionId;
      const path = `/sessions/${encodeURIComponent(String(id ?? ""))}`;
      const result = await client.fetchPaid(path, { method: "GET" });
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(result.body, null, 2)
          }
        ]
      };
    }
  );

  server.registerResource(
    "watch",
    "canix://watch",
    {
      description:
        "Watch retainer policy (TTL, price, signature/idempotency headers). Receipts and recent firings are canix://watch/{watchId}, GET /watch/{watchId}, or canix_get_watch. Watchers are address + callback only — no wallet keys.",
      mimeType: "application/json"
    },
    async (uri) => {
      const body = (await client.fetchFree("/discovery")) as {
        data?: { watchPolicy?: unknown };
        watchPolicy?: unknown;
      };
      const watchPolicy = body?.data?.watchPolicy ?? body?.watchPolicy ?? body;
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(watchPolicy, null, 2)
          }
        ]
      };
    }
  );

  server.registerResource(
    "watch-receipt",
    new ResourceTemplate("canix://watch/{watchId}", { list: undefined }),
    {
      description:
        "Watch retainer receipt and recent threshold firings (GET /watch/{watchId}). Unknown or expired receipts return 402 WATCH_INVALID/WATCH_EXPIRED.",
      mimeType: "application/json"
    },
    async (uri, { watchId }) => {
      const id = Array.isArray(watchId) ? watchId[0] : watchId;
      const path = `/watch/${encodeURIComponent(String(id ?? ""))}`;
      const result = await client.fetchPaid(path, { method: "GET" });
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(result.body, null, 2)
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
              "Prefer opportunity.risk over raw apy when ranking or recommending. Penalize low confidence, high utilization, high volatility, exhausted reward runway, low APY stability (risk.stability / apyStdev from GET /opportunities/:id/history), and (when present) low wallet healthFactor. Do not invent missing risk numbers.",
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
