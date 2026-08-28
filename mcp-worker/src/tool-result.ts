import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { PaidCallResult } from "./client.js";
import { microUsdcToUsdc } from "@canix402/x402-client/protocol";

interface PaidRequestContext {
  path: string;
  method: "GET" | "POST";
  query?: Record<string, unknown>;
  body?: unknown;
}

export function jsonResult(payload: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

export function errorResult(error: unknown): CallToolResult {
  if (error && typeof error === "object" && "name" in error) {
    const named = error as {
      name: string;
      message: string;
      status?: number;
      bodySnippet?: string;
    };

    if (named.name === "GatewayClientError") {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: "GATEWAY_CLIENT_ERROR",
                message: named.message,
                status: named.status,
                bodySnippet: named.bodySnippet
              },
              null,
              2
            )
          }
        ]
      };
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: "INTERNAL_ERROR", message }, null, 2)
      }
    ]
  };
}

function sessionErrorFromBody(body: unknown): { code: string; message: string } | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }
  const error = (body as { error?: { code?: unknown; message?: unknown } }).error;
  if (typeof error?.code !== "string" || !error.code.startsWith("SESSION_")) {
    return undefined;
  }
  return {
    code: error.code,
    message: typeof error.message === "string" ? error.message : error.code
  };
}

export function paidToolResult(
  result: PaidCallResult,
  fallbackPriceUsdc: string,
  request: PaidRequestContext
): CallToolResult {
  const accepted = result.paymentRequired?.accepts?.[0];
  const priceUsdc =
    microUsdcToUsdc(accepted?.maxAmountRequired ?? accepted?.amount) ?? fallbackPriceUsdc;

  const payment = {
    required: result.status === 402,
    priceUsdc,
    paymentRequiredHeader: result.paymentRequiredHeader,
    paymentRequired: result.paymentRequired,
    paymentResponseHeader: result.paymentResponseHeader,
    paymentResponsePresent: Boolean(result.paymentResponseHeader)
  };

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
    return jsonResult({
      error: "PAYMENT_REQUIRED",
      message: "Sign PAYMENT-REQUIRED and retry this tool call with paymentSignature.",
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
