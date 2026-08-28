import { getWebMcpTool } from "./catalog";
import {
  decodePaymentRequiredHeader,
  microUsdcToUsdc,
  sessionErrorFromBody
} from "./payment";
import type { GatewayCallResult, WebMcpToolSpec } from "./types";

export interface ExecuteCanixToolOptions {
  gatewayBaseUrl: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

const AUTH_KEYS = new Set(["paymentSignature", "sessionReceipt"]);

export function stringifyToolResult(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

export function normalizeToolArgs(input: unknown): Record<string, unknown> {
  if (input == null) {
    return {};
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed === "") {
      return {};
    }
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw Object.assign(new Error("Tool arguments must be a JSON object."), {
        code: "INVALID_ARGUMENT"
      });
    }
    return parsed as Record<string, unknown>;
  }
  if (typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  throw Object.assign(new Error("Tool arguments must be a JSON object."), {
    code: "INVALID_ARGUMENT"
  });
}

export async function executeCanixWebMcpTool(
  name: string,
  rawArgs: unknown,
  options: ExecuteCanixToolOptions
): Promise<string> {
  try {
    return stringifyToolResult(await executeCanixWebMcpToolValue(name, rawArgs, options));
  } catch (error) {
    return stringifyToolResult(errorPayload(error));
  }
}

export async function executeCanixWebMcpToolValue(
  name: string,
  rawArgs: unknown,
  options: ExecuteCanixToolOptions
): Promise<unknown> {
  const tool = getWebMcpTool(name);
  if (!tool) {
    return {
      error: "UNKNOWN_TOOL",
      message: `Unknown Canix WebMCP tool: ${name}`
    };
  }

  const args = normalizeToolArgs(rawArgs);
  const request = buildGatewayRequest(tool, args, options.gatewayBaseUrl);
  if ("error" in request) {
    return request;
  }

  const result = await callGateway(request, {
    fetchImpl: options.fetchImpl ?? fetch,
    signal: options.signal
  });

  return mapGatewayResult(tool, result, request);
}

interface BuiltRequest {
  method: "GET" | "POST";
  path: string;
  url: string;
  query?: Record<string, string>;
  body?: unknown;
  headers: Record<string, string>;
}

function buildGatewayRequest(
  tool: WebMcpToolSpec,
  args: Record<string, unknown>,
  gatewayBaseUrl: string
): BuiltRequest | { error: string; message: string; argument?: string } {
  const paymentSignature =
    typeof args.paymentSignature === "string" && args.paymentSignature.length > 0
      ? args.paymentSignature
      : undefined;
  const sessionReceipt =
    typeof args.sessionReceipt === "string" && args.sessionReceipt.length > 0
      ? args.sessionReceipt
      : undefined;

  let path = tool.http.path;
  for (const param of tool.http.pathParams ?? []) {
    const value = args[param];
    if (value === undefined || value === null || String(value).length === 0) {
      return {
        error: "INVALID_ARGUMENT",
        message: `${param} is required.`,
        argument: param
      };
    }
    path = path.replaceAll(`{${param}}`, encodeURIComponent(String(value)));
  }

  const query: Record<string, string> = {};
  for (const key of tool.http.queryParams ?? []) {
    const value = args[key];
    if (value === undefined || value === null) {
      continue;
    }
    query[key] = String(value);
  }

  const reserved = new Set([
    ...AUTH_KEYS,
    ...(tool.http.pathParams ?? []),
    ...(tool.http.queryParams ?? [])
  ]);

  let body: unknown;
  if (tool.http.method === "POST") {
    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (reserved.has(key) || value === undefined) {
        continue;
      }
      payload[key] = value;
    }
    body = payload;
  }

  const headers: Record<string, string> = {};
  if (paymentSignature) {
    headers["PAYMENT-SIGNATURE"] = paymentSignature;
  } else if (tool.allowSessionReceipt && sessionReceipt) {
    headers["X-Canix-Session"] = sessionReceipt;
  }

  const url = new URL(path.startsWith("/") ? path : `/${path}`, `${gatewayBaseUrl.replace(/\/+$/, "")}/`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }

  return {
    method: tool.http.method,
    path,
    url: url.toString(),
    query: Object.keys(query).length > 0 ? query : undefined,
    body,
    headers
  };
}

async function callGateway(
  request: BuiltRequest,
  options: { fetchImpl: typeof fetch; signal?: AbortSignal }
): Promise<GatewayCallResult> {
  const headers = { ...request.headers };
  let serializedBody: string | undefined;
  if (request.body !== undefined && request.method === "POST") {
    headers["content-type"] = "application/json";
    serializedBody = JSON.stringify(request.body);
  }

  const response = await options.fetchImpl(request.url, {
    method: request.method,
    headers,
    signal: options.signal,
    ...(serializedBody === undefined ? {} : { body: serializedBody })
  });
  const bodyText = await response.text();
  const paymentRequiredHeader = response.headers.get("payment-required");

  return {
    status: response.status,
    body: bodyText.length === 0 ? null : parseBodyOrText(bodyText),
    paymentRequiredHeader,
    paymentResponseHeader: response.headers.get("payment-response"),
    paymentRequired: paymentRequiredHeader
      ? decodePaymentRequiredHeader(paymentRequiredHeader)
      : null
  };
}

function mapGatewayResult(
  tool: WebMcpToolSpec,
  result: GatewayCallResult,
  request: BuiltRequest
): unknown {
  if (result.status === 402) {
    const accepted = Array.isArray(result.paymentRequired?.accepts)
      ? (result.paymentRequired.accepts[0] as { maxAmountRequired?: string; amount?: string } | undefined)
      : undefined;
    const priceUsdc =
      microUsdcToUsdc(accepted?.maxAmountRequired ?? accepted?.amount) ??
      tool.fallbackPriceUsdc;

    const mcpPayment = {
      required: true,
      priceUsdc,
      paymentRequiredHeader: result.paymentRequiredHeader,
      paymentRequired: result.paymentRequired,
      paymentResponseHeader: result.paymentResponseHeader,
      paymentResponsePresent: Boolean(result.paymentResponseHeader)
    };
    const requestContext = {
      path: request.path,
      method: request.method,
      query: request.query,
      body: request.body
    };
    const sessionError = sessionErrorFromBody(result.body);
    if (sessionError) {
      return {
        error: sessionError.code,
        message: sessionError.message,
        mcpPayment,
        request: requestContext,
        retry: {
          omitHeader: "X-Canix-Session",
          arg: "paymentSignature",
          header: "PAYMENT-SIGNATURE"
        },
        gatewayResponse: result.body
      };
    }
    return {
      error: "PAYMENT_REQUIRED",
      message: "Sign PAYMENT-REQUIRED and retry this tool call with paymentSignature.",
      mcpPayment,
      request: requestContext,
      retry: {
        arg: "paymentSignature",
        header: "PAYMENT-SIGNATURE"
      },
      gatewayResponse: result.body
    };
  }

  if (result.status !== 200) {
    return {
      error: "GATEWAY_CLIENT_ERROR",
      message: `${request.path}: expected 200 or 402, got ${result.status}`,
      status: result.status,
      bodySnippet: snippet(result.body)
    };
  }

  if (tool.access === "paid") {
    const mcpPayment = {
      required: false,
      priceUsdc: tool.fallbackPriceUsdc,
      paymentRequiredHeader: result.paymentRequiredHeader,
      paymentRequired: result.paymentRequired,
      paymentResponseHeader: result.paymentResponseHeader,
      paymentResponsePresent: Boolean(result.paymentResponseHeader)
    };
    if (result.body && typeof result.body === "object" && !Array.isArray(result.body)) {
      return {
        ...(result.body as Record<string, unknown>),
        mcpPayment
      };
    }
    return {
      data: result.body,
      mcpPayment
    };
  }

  return result.body;
}

function parseBodyOrText(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function snippet(body: unknown): string {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return raw.slice(0, 400);
}

function errorPayload(error: unknown): Record<string, unknown> {
  if (error && typeof error === "object" && "code" in error) {
    const named = error as { code?: string; message?: string };
    if (named.code === "INVALID_ARGUMENT") {
      return {
        error: "INVALID_ARGUMENT",
        message: named.message ?? "Invalid tool arguments."
      };
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    error: "INTERNAL_ERROR",
    message
  };
}
