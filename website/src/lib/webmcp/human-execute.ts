import { getWebMcpTool } from "./catalog";
import {
  executeCanixWebMcpToolValue,
  normalizeToolArgs,
  type ExecuteCanixToolOptions
} from "./execute";
import {
  isSessionExhausted,
  isSessionExpired,
  receiptFromToolResult,
  type WebMcpSessionStore
} from "./session-store";
import type { SessionQuota } from "./types";

export interface ExecuteAsHumanOptions extends ExecuteCanixToolOptions {
  sessionStore: WebMcpSessionStore;
  execute?: typeof executeCanixWebMcpToolValue;
}

export async function executeAsHuman(
  name: string,
  rawArgs: unknown,
  options: ExecuteAsHumanOptions
): Promise<unknown> {
  const tool = getWebMcpTool(name);
  if (!tool) {
    return {
      error: "UNKNOWN_TOOL",
      message: `Unknown Canix WebMCP tool: ${name}`
    };
  }

  const args = { ...normalizeToolArgs(rawArgs) };
  delete args.paymentSignature;

  if (name === "canix_create_session" || name === "canix_refresh_session") {
    return {
      error: "HUMAN_CHECKOUT_REQUIRED",
      message: "Humans buy or refresh a session with the connected wallet. This page does not use per-request USDC."
    };
  }

  if (tool.access === "paid") {
    if (!tool.allowSessionReceipt) {
      return {
        error: "SESSION_REQUIRED",
        message: "This paid tool is not session-eligible. Humans on this page only use a prepaid session receipt."
      };
    }
    const receipt = options.sessionStore.get();
    if (!receipt?.sessionId) {
      return {
        error: "SESSION_REQUIRED",
        message: "Buy a prepaid session on this page. Humans do not use per-request USDC here."
      };
    }
    if (isSessionExpired(receipt)) {
      return {
        error: "SESSION_EXPIRED",
        message: "Prepaid session has expired. Refresh or buy a new session.",
        sessionId: receipt.sessionId
      };
    }
    const bucket = sessionBucketForPath(tool.http.path);
    if (isSessionExhausted(receipt) || bucketQuotaExhausted(receipt.remaining, bucket)) {
      return {
        error: "SESSION_EXHAUSTED",
        message: "Prepaid session quota is exhausted. Refresh the session or wait for a new purchase.",
        sessionId: receipt.sessionId,
        remaining: receipt.remaining
      };
    }
    args.sessionReceipt = receipt.sessionId;
  } else if (name === "canix_get_session" && (args.sessionId === undefined || args.sessionId === "")) {
    const receipt = options.sessionStore.get();
    if (!receipt?.sessionId) {
      return {
        error: "SESSION_REQUIRED",
        message: "No prepaid session receipt on this page. Buy a session first."
      };
    }
    args.sessionId = receipt.sessionId;
  }

  const execute = options.execute ?? executeCanixWebMcpToolValue;
  const result = await execute(name, args, {
    gatewayBaseUrl: options.gatewayBaseUrl,
    fetchImpl: options.fetchImpl,
    signal: options.signal
  });

  persistHumanResult(result, options.sessionStore);
  return result;
}

function persistHumanResult(result: unknown, sessionStore: WebMcpSessionStore): void {
  const current = sessionStore.get();
  const receipt = receiptFromToolResult(result);
  if (receipt) {
    sessionStore.set(receipt);
    return;
  }
  if (!current) {
    return;
  }
  const error = toolErrorCode(result);
  if (error === "SESSION_EXPIRED") {
    sessionStore.set({ ...current, status: "expired" });
    return;
  }
  if (error === "SESSION_EXHAUSTED") {
    sessionStore.set({ ...current, status: "exhausted" });
    return;
  }
  if (error === "SESSION_INVALID") {
    sessionStore.clear();
    return;
  }
  const quota = readSessionQuota(result);
  if (quota) {
    sessionStore.applyQuota(quota);
  }
}

function readSessionQuota(result: unknown): SessionQuota | undefined {
  if (!result || typeof result !== "object") {
    return undefined;
  }
  const quota = (result as { sessionQuota?: SessionQuota }).sessionQuota;
  if (!quota) {
    return undefined;
  }
  if (!Number.isFinite(quota.remainingResearch) || !Number.isFinite(quota.remainingQuotes)) {
    return undefined;
  }
  return quota;
}

function toolErrorCode(result: unknown): string | undefined {
  if (!result || typeof result !== "object") {
    return undefined;
  }
  const error = (result as { error?: unknown }).error;
  return typeof error === "string" ? error : undefined;
}

function sessionBucketForPath(path: string): "research" | "quotes" | null {
  if (path.startsWith("/plans") || path.startsWith("/execution") || path.startsWith("/swaps/transactions")) {
    return "quotes";
  }
  if (
    path.startsWith("/opportunities") ||
    path.includes("/opportunities") ||
    path.startsWith("/positions") ||
    path.startsWith("/eligibility")
  ) {
    return "research";
  }
  return null;
}

function bucketQuotaExhausted(
  remaining: { research: number; quotes: number },
  bucket: "research" | "quotes" | null
): boolean {
  if (bucket === "research") {
    return remaining.research <= 0;
  }
  if (bucket === "quotes") {
    return remaining.quotes <= 0;
  }
  return remaining.research <= 0 && remaining.quotes <= 0;
}
