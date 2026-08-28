import { executeCanixWebMcpToolValue, type ExecuteCanixToolOptions } from "./execute";
import type { PaymentRequest } from "./payment";
import { receiptFromToolResult, type WebMcpSessionStore } from "./session-store";
import type { SessionReceipt } from "./types";
import {
  assemblePaymentSignature,
  buildUnsignedPaymentGroup,
  selectPaymentAccept,
  type SignTransactionsFn,
  type SuggestedTxnParams
} from "./x402-wallet-payment";

export type SessionCheckoutMode = "create" | "refresh";

export interface BuyPrepaidSessionOptions extends ExecuteCanixToolOptions {
  sender: string;
  signTransactions: SignTransactionsFn;
  fetchSuggestedParams: () => Promise<SuggestedTxnParams>;
  sessionStore: WebMcpSessionStore;
  mode?: SessionCheckoutMode;
  execute?: typeof executeCanixWebMcpToolValue;
}

export async function buyPrepaidSession(
  options: BuyPrepaidSessionOptions
): Promise<unknown> {
  const execute = options.execute ?? executeCanixWebMcpToolValue;
  const toolName = options.mode === "refresh" ? "canix_refresh_session" : "canix_create_session";
  const existing = options.sessionStore.get();
  const baseArgs: Record<string, unknown> =
    toolName === "canix_refresh_session" && existing?.sessionId
      ? { sessionId: existing.sessionId }
      : {};

  const preflight = await execute(toolName, baseArgs, {
    gatewayBaseUrl: options.gatewayBaseUrl,
    fetchImpl: options.fetchImpl,
    signal: options.signal
  });

  const preflightError = toolError(preflight);
  if (!preflightError) {
    return persistCheckoutResult(preflight, options.sessionStore);
  }
  if (preflightError.error !== "PAYMENT_REQUIRED") {
    return preflight;
  }

  const paymentRequired = readPaymentRequired(preflight);
  const accepted = selectPaymentAccept(paymentRequired);
  if ("error" in accepted) {
    return accepted;
  }
  if (!paymentRequired) {
    return {
      error: "PAYMENT_INVALID",
      message: "Create session preflight did not include paymentRequired."
    };
  }

  let suggestedParams: SuggestedTxnParams;
  try {
    suggestedParams = await options.fetchSuggestedParams();
  } catch (error) {
    return {
      error: "PAYMENT_FAILED",
      message: error instanceof Error ? error.message : "Could not fetch transaction parameters."
    };
  }

  const group = buildUnsignedPaymentGroup({
    sender: options.sender,
    accepted,
    suggestedParams
  });
  if ("error" in group) {
    return group;
  }

  let signed: Array<Uint8Array | null>;
  try {
    signed = await options.signTransactions(group.encodedTransactions, [group.paymentIndex]);
  } catch (error) {
    return {
      error: "PAYMENT_REJECTED",
      message: error instanceof Error ? error.message : "Wallet rejected the USDC payment."
    };
  }

  let paymentSignature: string;
  try {
    paymentSignature = assemblePaymentSignature({
      paymentRequired,
      accepted,
      encodedUnsigned: group.encodedTransactions,
      signedTransactions: signed,
      paymentIndex: group.paymentIndex
    });
  } catch (error) {
    return {
      error: "PAYMENT_REJECTED",
      message: error instanceof Error ? error.message : "Wallet did not sign the USDC payment."
    };
  }

  const paid = await execute(
    toolName,
    { ...baseArgs, paymentSignature },
    {
      gatewayBaseUrl: options.gatewayBaseUrl,
      fetchImpl: options.fetchImpl,
      signal: options.signal
    }
  );

  const paidError = toolError(paid);
  if (paidError) {
    if (paidError.error === "PAYMENT_REQUIRED") {
      return {
        ...paidError,
        error: "PAYMENT_FAILED",
        message: "USDC payment was not accepted. Session was not minted."
      };
    }
    return paid;
  }

  return persistCheckoutResult(paid, options.sessionStore);
}

export async function refreshSessionRemaining(
  options: ExecuteCanixToolOptions & { sessionStore: WebMcpSessionStore; execute?: typeof executeCanixWebMcpToolValue }
): Promise<unknown> {
  const receipt = options.sessionStore.get();
  if (!receipt?.sessionId) {
    return {
      error: "SESSION_REQUIRED",
      message: "No prepaid session receipt on this page. Buy a session first."
    };
  }
  const execute = options.execute ?? executeCanixWebMcpToolValue;
  const result = await execute(
    "canix_get_session",
    { sessionId: receipt.sessionId },
    {
      gatewayBaseUrl: options.gatewayBaseUrl,
      fetchImpl: options.fetchImpl,
      signal: options.signal
    }
  );
  const error = toolError(result);
  if (error) {
    if (error.error.startsWith("SESSION_")) {
      options.sessionStore.set({
        ...receipt,
        status: error.error === "SESSION_EXPIRED" ? "expired" : receipt.status
      });
    }
    return result;
  }
  return persistCheckoutResult(result, options.sessionStore);
}

function persistCheckoutResult(result: unknown, sessionStore: WebMcpSessionStore): unknown {
  const receipt = receiptFromToolResult(result);
  if (!receipt) {
    return {
      error: "SESSION_INVALID",
      message: "Session create succeeded but did not return a 13.8 receipt.",
      gatewayResponse: result
    };
  }
  const stored = sessionStore.set(receipt);
  return attachStoredReceipt(result, stored);
}

function attachStoredReceipt(result: unknown, receipt: SessionReceipt): unknown {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return {
      ...(result as Record<string, unknown>),
      sessionReceipt: receipt,
      sessionQuota: {
        remainingResearch: receipt.remaining.research,
        remainingQuotes: receipt.remaining.quotes,
        expiresAt: receipt.expiresAt
      }
    };
  }
  return {
    data: receipt,
    sessionReceipt: receipt,
    sessionQuota: {
      remainingResearch: receipt.remaining.research,
      remainingQuotes: receipt.remaining.quotes,
      expiresAt: receipt.expiresAt
    }
  };
}

function toolError(result: unknown): { error: string; message: string } | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  const record = result as { error?: unknown; message?: unknown };
  if (typeof record.error !== "string") {
    return null;
  }
  return {
    error: record.error,
    message: typeof record.message === "string" ? record.message : record.error
  };
}

function readPaymentRequired(result: unknown): PaymentRequest | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  const mcpPayment = (result as { mcpPayment?: { paymentRequired?: unknown } }).mcpPayment;
  const candidate = mcpPayment?.paymentRequired;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }
  const paymentRequired = candidate as PaymentRequest;
  if (!Array.isArray(paymentRequired.accepts) || paymentRequired.accepts.length === 0) {
    return null;
  }
  return paymentRequired;
}
