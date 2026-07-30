import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DISABLED_HAYSTACK_PROTOCOLS,
  createHaystackService
} from "../../src/services/haystack-router.js";
import type { SwapQuoteResponse } from "../../src/types/swap-schema.js";
import {
  USDC_ASSET_ID,
  accountFromMnemonic
} from "../helpers/algorandExecution.js";
import {
  getProductionBaseUrl,
  loadLiveEnvFiles,
  requireClientMnemonic
} from "../helpers/x402LiveClient.js";

loadLiveEnvFiles();

/** Meld Gold (g) — GOLD$ */
const GOLD_ASSET_ID = 246516580;
/** ~0.400392 GOLD (6 decimals); amount that was failing in production. */
const GOLD_AMOUNT = "400392";
const HAYSTACK_API_BASE_URL =
  process.env.HAYSTACK_API_BASE_URL?.trim()
  || "https://hayrouter.txnlab.dev/api";
/** Free-tier key from Haystack SDK docs; overridden by HAYSTACK_API_KEY when set. */
const HAYSTACK_FREE_TIER_API_KEY = "1b72df7e-1131-4449-8ce1-29b79dd3f51e";

test(
  "quote GOLD to USDC through production /swaps/quote and compare with Haystack upstream",
  { timeout: 120_000 },
  async (t) => {
    if (process.env.X402_HAYSTACK_GOLD_QUOTE_LIVE !== "1") {
      t.skip(
        "Set X402_HAYSTACK_GOLD_QUOTE_LIVE=1 to probe GOLD→USDC quotes against production and Haystack."
      );
      return;
    }

    const baseUrl = getProductionBaseUrl();
    const mnemonic = requireClientMnemonic("npm run test:haystack-gold-quote");
    const address = accountFromMnemonic(mnemonic).addr.toString();
    const quoteBody = {
      address,
      fromAssetId: GOLD_ASSET_ID,
      toAssetId: USDC_ASSET_ID,
      amount: GOLD_AMOUNT,
      type: "fixed-input" as const
    };

    console.log(
      JSON.stringify(
        {
          probe: "gold-usdc-quote",
          baseUrl,
          address,
          fromAssetId: GOLD_ASSET_ID,
          toAssetId: USDC_ASSET_ID,
          amount: GOLD_AMOUNT,
          canixDefaultDisabled: [...DEFAULT_DISABLED_HAYSTACK_PROTOCOLS]
        },
        null,
        2
      )
    );

    const direct = await probeDirectHaystack(address);
    console.log(JSON.stringify({ directHaystack: summarizeProbe(direct) }, null, 2));

    const local = await probeLocalHaystackService(address);
    console.log(JSON.stringify({ localHaystackService: summarizeProbe(local) }, null, 2));

    const production = await probeProductionQuote(baseUrl, quoteBody);
    console.log(JSON.stringify({ productionCanix: summarizeProbe(production) }, null, 2));

    if (production.ok) {
      const quote = production.body as SwapQuoteResponse;
      assert.equal(quote.data.fromAssetId, String(GOLD_ASSET_ID));
      assert.equal(quote.data.toAssetId, String(USDC_ASSET_ID));
      assert.equal(quote.data.amount, GOLD_AMOUNT);
      assert.ok(BigInt(quote.data.quotedAmount) > 0n);
      assert.ok(quote.data.txnPayload);
      return;
    }

    const hints: string[] = [
      "GOLD→USDC production quote failed.",
      `production: ${formatProbeFailure(production)}`,
      `directHaystack: ${formatProbeFailure(direct)}`,
      `localHaystackService: ${formatProbeFailure(local)}`
    ];
    if (direct.ok && local.ok) {
      hints.push(
        "Upstream Haystack and local canix normalizeQuote succeed; production is still returning a gateway error. Deploy the null-quotes normalizeQuote fix (Haystack returns quotes:null for this route)."
      );
    } else if (direct.ok && !local.ok) {
      hints.push(
        "Haystack upstream succeeds but local createHaystackService fails — likely a canix quote normalization bug (e.g. quotes:null)."
      );
    }
    throw new Error(hints.join("\n"));
  }
);

interface ProbeResult {
  ok: boolean;
  elapsedMs: number;
  status?: number;
  body?: unknown;
  error?: string;
}

async function probeProductionQuote(
  baseUrl: string,
  body: Record<string, unknown>
): Promise<ProbeResult> {
  const started = Date.now();
  try {
    const response = await fetch(`${baseUrl}/swaps/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    const elapsedMs = Date.now() - started;
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // keep raw text
    }
    return {
      ok: response.status === 200,
      elapsedMs,
      status: response.status,
      body: parsed
    };
  } catch (error) {
    return {
      ok: false,
      elapsedMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function probeDirectHaystack(address: string): Promise<ProbeResult> {
  const apiKey =
    process.env.HAYSTACK_API_KEY?.trim() || HAYSTACK_FREE_TIER_API_KEY;
  const algodUrl = (
    process.env.X402_ALGOD_URL?.trim() || "https://mainnet-api.algonode.cloud"
  ).replace(/\/+$/, "");
  const url = new URL(`${HAYSTACK_API_BASE_URL.replace(/\/+$/, "")}/fetchQuote`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("algodUri", algodUrl);
  url.searchParams.set("algodToken", process.env.X402_ALGOD_TOKEN ?? "");
  url.searchParams.set("algodPort", "443");
  url.searchParams.set("feeBps", "10");
  url.searchParams.set("fromASAID", String(GOLD_ASSET_ID));
  url.searchParams.set("toASAID", String(USDC_ASSET_ID));
  url.searchParams.set("amount", GOLD_AMOUNT);
  url.searchParams.set("type", "fixed-input");
  url.searchParams.set(
    "disabledProtocols",
    [...DEFAULT_DISABLED_HAYSTACK_PROTOCOLS].join(",")
  );
  url.searchParams.set("maxGroupSize", "16");
  url.searchParams.set("maxDepth", "3");
  url.searchParams.set("optIn", "false");
  url.searchParams.set("address", address);

  const started = Date.now();
  try {
    const response = await fetch(url);
    const text = await response.text();
    const elapsedMs = Date.now() - started;
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // keep raw text
    }
    return {
      ok: response.status === 200,
      elapsedMs,
      status: response.status,
      body: parsed
    };
  } catch (error) {
    return {
      ok: false,
      elapsedMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function probeLocalHaystackService(address: string): Promise<ProbeResult> {
  if (!process.env.HAYSTACK_API_KEY?.trim()) {
    return {
      ok: false,
      elapsedMs: 0,
      error: "HAYSTACK_API_KEY not set; skipped local createHaystackService probe."
    };
  }

  const started = Date.now();
  try {
    const service = createHaystackService();
    const quote = await service.getQuote({
      address,
      fromAssetId: GOLD_ASSET_ID,
      toAssetId: USDC_ASSET_ID,
      amount: GOLD_AMOUNT,
      type: "fixed-input"
    });
    return {
      ok: true,
      elapsedMs: Date.now() - started,
      status: 200,
      body: {
        fromAssetId: quote.fromAssetId,
        toAssetId: quote.toAssetId,
        amount: quote.amount,
        quotedAmount: quote.quotedAmount,
        route: quote.route,
        usdIn: quote.usdIn,
        usdOut: quote.usdOut,
        userPriceImpact: quote.userPriceImpact
      }
    };
  } catch (error) {
    const details =
      error && typeof error === "object" && "details" in error
        ? (error as { details?: unknown }).details
        : undefined;
    return {
      ok: false,
      elapsedMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
      body: details
    };
  }
}

function summarizeProbe(result: ProbeResult): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    ok: result.ok,
    elapsedMs: result.elapsedMs
  };
  if (result.status !== undefined) summary.status = result.status;
  if (result.error !== undefined) summary.error = result.error;

  if (result.ok && result.body && typeof result.body === "object") {
    const body = result.body as Record<string, unknown>;
    const data = (body.data as Record<string, unknown> | undefined) ?? body;
    summary.quotedAmount = data.quotedAmount ?? data.quote;
    summary.usdIn = data.usdIn;
    summary.usdOut = data.usdOut;
    summary.userPriceImpact = data.userPriceImpact;
    summary.routeLength = Array.isArray(data.route) ? data.route.length : undefined;
  } else if (result.body !== undefined) {
    summary.body = truncate(JSON.stringify(result.body), 800);
  }
  return summary;
}

function formatProbeFailure(result: ProbeResult): string {
  if (result.ok) return `ok in ${result.elapsedMs}ms`;
  const parts = [`failed in ${result.elapsedMs}ms`];
  if (result.status !== undefined) parts.push(`status=${result.status}`);
  if (result.error) parts.push(`error=${result.error}`);
  if (result.body !== undefined) {
    parts.push(`body=${truncate(JSON.stringify(result.body), 800)}`);
  }
  return parts.join(" ");
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`;
}
