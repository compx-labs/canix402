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

function typedApiErrorFromBody(
  body: unknown,
  prefix: "SESSION_" | "WATCH_"
): { code: string; message: string } | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }
  const error = (body as { error?: { code?: unknown; message?: unknown } }).error;
  if (typeof error?.code !== "string" || !error.code.startsWith(prefix)) {
    return undefined;
  }
  return {
    code: error.code,
    message: typeof error.message === "string" ? error.message : error.code
  };
}

function sessionErrorFromBody(body: unknown): { code: string; message: string } | undefined {
  return typedApiErrorFromBody(body, "SESSION_");
}

function watchErrorFromBody(body: unknown): { code: string; message: string } | undefined {
  return typedApiErrorFromBody(body, "WATCH_");
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

export function sessionReceiptArgSchema() {
  return z
    .string()
    .min(1)
    .describe(
      "Prepaid session receipt (X-Canix-Session). Omit to pay per request with paymentSignature. If this header was sent, Caddy skipped x402; a 402 SESSION_* means drop the header and retry with paymentSignature."
    )
    .optional();
}

export function paidAuth(args: {
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

export function formatPaidToolResult(
  result: PaidCallResult,
  fallbackPriceUsdc: string,
  request: PaidRequestContext
) {
  const payment = paidMeta(result, fallbackPriceUsdc);

  if (result.status === 402) {
    const sessionError = sessionErrorFromBody(result.body);
    if (sessionError) {
      return jsonResult({
        error: sessionError.code,
        message: sessionError.message,
        mcpPayment: payment,
        request,
        retry: {
          omitHeader: "X-Canix-Session",
          arg: "paymentSignature",
          header: "PAYMENT-SIGNATURE"
        },
        gatewayResponse: result.body
      });
    }
    const watchError = watchErrorFromBody(result.body);
    if (watchError) {
      return jsonResult({
        error: watchError.code,
        message: watchError.message,
        mcpPayment: payment,
        request,
        retry:
          watchError.code === "WATCH_UNAUTHORIZED"
            ? { arg: "webhookSecret", header: "X-Canix-Watch-Secret" }
            : { arg: "paymentSignature", header: "PAYMENT-SIGNATURE" },
        gatewayResponse: result.body
      });
    }
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
        "List top aggregated Algorand DeFi opportunities ranked by risk then APY (GET /opportunities). Paid: ~0.01 USDC via x402. First call returns PAYMENT-REQUIRED metadata; retry with paymentSignature.", // pragma: allowlist secret
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
        includeInactive: z.boolean().optional(),
        protocol: ProtocolSchema.optional(),
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
          protocol: args.protocol
        };
        const result = await client.fetchPaid("/opportunities", {
          method: "GET",
          query,
          ...paidAuth(args)
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
    "canix_get_opportunity_history",
    {
      description:
        "Fetch a bounded APY/TVL history series for one opportunity (GET /opportunities/{opportunityId}/history?window=). Window is 1d, 7d, or 30d (default 30d). Empty points until snapshots exist — not a warehouse backfill. Includes a stability signal so snapshot APY cannot dominate plan sizing. Paid: ~0.01 USDC via x402 (research SKU).",
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
    "canix_check_eligibility",
    {
      description:
        "Check whether a wallet can enter selected opportunities before quoting (POST /eligibility). Pass address and opportunityIds (1–25). Returns canEnter, missingAssets, gates, capacity, suggestedSwap, and eligibilityFullyCheckable. NFD/creator gates stay unresolved — canEnter is never true until fully checkable. Quote-time on-chain checks remain authoritative. Paid: ~0.01 USDC via x402. Canix does not sign or submit transactions.",
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
        "Compile an allocation intent into an ordered unsigned plan (POST /plans). Pass address and budget { assetId, amount } (base units; 0 = ALGO). Optional constraints: maxProtocolWeightBps, noNewBorrows, executionReadyOnly, minTvlUsd, maxSourceAgeSeconds, maxAllocations. Optional opportunityIds pins the compiler. Optional swapSlippage (Haystack percent) for swap-aware compose. Returns eligibility, live Haystack opt-in/swap groups when requiredAssetIds differ from the budget asset, setup/enter quotes[] as independent unsigned groups (never merged), expected position delta, attached data.simulation when groups compiled, x402 + network fee totals, and expiry. Paid: ~0.25 USDC via x402. Canix does not sign or submit — Brownie and other agents should consume this SKU rather than forking a compiler.",
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
    "canix_get_rebalance_plan",
    {
      description:
        "Compile a delta rebalance plan (POST /plans/rebalance). Pass address plus targetWeights (bps summing to 10000) and/or harvestIdle to claim worth-claiming rewards and redeploy idle ALGO. Returns ordered unsigned groups — claims, partial exits, optional Haystack swap compose, and enters — only the legs that change the book (not a full unwind-and-rebuild). Reuses claim desk, eligibility, compose, and position exit/manage shapeKeys. Groups are never merged. Attaches data.simulation when compiled groups exist. Paid: ~0.25 USDC via x402. Canix does not sign or submit.",
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
        return formatPaidToolResult(result, "0.25", {
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
        "Validate a compiled plan or proposed quotes[] against an operator policy document (POST /policy/validate). Pass policy { schemaVersion: \"1.0.0\", maxProtocolWeightBps?, minAlgoReserveMicroAlgos?, minTvlUsd?, maxSourceAgeSeconds?, noNewBorrows?, executionReadyOnly? } plus plan and/or quotes[]. Returns { pass, reasons[] }. Reuses compiled fields and fails closed when a required field is missing — does not re-quote on-chain. Paid ~0.25 USDC. Canix does not sign or submit. Sample: protocol/docs/policy-brownie.sample.json.",
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
        return formatPaidToolResult(result, "0.25", {
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
        "Compose “I hold asset A, I want this opportunity” into sequenced unsigned groups (POST /execution/compose): opt-in → Haystack swap → enter, driven by requiredAssetIds. Groups are never merged. Haystack signer indexes and pre-signed members are preserved — sign only user legs and submit locally. Failure modes (stale quote, missing opt-in, slippage) appear on step warnings. Paid: ~0.10 USDC via x402. Prefer canix_get_plan for budget allocation; use this for a single opportunity.",
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
        return formatPaidToolResult(result, "0.1", {
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
        "List opportunities for a single protocol (GET /protocols/{protocol}/opportunities). Paid: ~0.01 USDC via x402.",
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
        const result = await client.fetchPaid(
          path,
          {
            method: "GET",
            query,
            ...paidAuth(args)
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
    "canix_simulate_execution",
    {
      description:
        "Simulate compiled unsigned groups without signing or submitting (POST /execution/simulate). Pass address and groups[] from a plan or canix_get_execution_quote (transactions and/or encodedTransactions). Returns predicted balance and position deltas. Fails closed with machine-readable reasons (stale-quote, not-opted-in, min-balance, health-factor-too-low, capacity). Paid ~0.10 USDC. POST /plans already attaches data.simulation when compiled groups are available. Canix does not sign or submit.",
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
        return formatPaidToolResult(result, "0.10", {
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
        "Compile one or more unsigned Algorand transaction groups for verified execution shapes (POST /execution/quotes). Pass quotes: [{ shapeKey, input }, ...] (min 1). Required input fields vary by shapeKey — call canix_list_execution_shapes and use each shape's requiredInputs (userAddress is always required). Response data is an ExecutableQuote array in the same order — groups are never merged. Paid: flat ~0.10 USDC via x402 per request (not per quote item). On failure, error.details includes quoteIndex and shapeKey. Canix does not sign or submit transactions. Do not guess pool discovery, opt-ins, min-balance, slippage, liquidity limits, or app upgrades — read protocol/docs/execution-shapes/protocol-caveats.md (also GET /execution/shapes meta.caveatsDocsPath) and each shape's docsPath.", // pragma: allowlist secret
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
    "canix_create_session",
    {
      description:
        "Buy a prepaid agent session (POST /sessions, ~0.25 USDC). One x402 payment mints a walletless receipt that unlocks N research calls and M quotes/plans until TTL. Sessions are receipts, not keys. Create/refresh cannot be paid with an existing session. After purchase, pass sessionReceipt (X-Canix-Session) on research/quote tools instead of spraying per-request payments.",
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
        return formatPaidToolResult(result, "0.25", {
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
        "Refresh a prepaid session (POST /sessions/refresh, ~0.25 USDC). Resets N/M and TTL on an existing session id, or mints a new receipt if the previous one is gone. One-shot only — do not send sessionReceipt.",
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
        return formatPaidToolResult(result, "0.25", {
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
        "Read remaining N/M and expiry for a prepaid session receipt (GET /sessions/{sessionId}). Free. Unknown or expired receipts return 402 SESSION_INVALID/SESSION_EXPIRED. Prefer this over the public indexer /transactions showcase.",
      inputSchema: {
        sessionId: z.string().min(1)
      }
    },
    async (args) => {
      try {
        const path = `/sessions/${encodeURIComponent(args.sessionId)}`;
        const result = await client.fetchPaid(path, { method: "GET" });
        if (result.status === 402) {
          return jsonResult(result.body);
        }
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
        "Register a paid wallet watch retainer (POST /watch, ~0.25 USDC). Pass address + thresholds (healthFactor, claimableUsd, apyDropBps, retiCapacity) and optional HTTPS webhookUrl. Returns a walletless receipt and HMAC secret once. Notifications fire on threshold crossings with X-Canix-Signature and an idempotency key. Canix never stores wallet keys. Refresh with canix_refresh_watch before TTL.",
      inputSchema: {
        address: z.string().min(58).max(58),
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
        return formatPaidToolResult(result, "0.25", {
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
        "Refresh a paid watch retainer (POST /watch/refresh, ~0.25 USDC). Extends TTL. Optionally rotateSecret to mint a new HMAC key (returned once). One-shot only — do not send sessionReceipt.",
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
        return formatPaidToolResult(result, "0.25", {
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
        "Read a watch receipt and recent threshold firings (GET /watch/{watchId}). Free. Does not return the HMAC secret. Unknown or expired receipts return 402 WATCH_INVALID/WATCH_EXPIRED.",
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
        "Rotate the watch webhook HMAC secret (POST /watch/{watchId}/rotate-secret). Free. Requires the current secret. The new secret is returned once. Does not extend retainer TTL.",
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
}