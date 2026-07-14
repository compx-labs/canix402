import type { McpConfig } from "./config.js";

import {
  decodePaymentRequiredHeader,
  type PaymentRequest
} from "@canix402/x402-client/protocol";

export type {
  PaymentRequest,
  PaymentRequestAccept
} from "@canix402/x402-client/protocol";

export {
  decodePaymentRequiredHeader,
  microUsdcToUsdc
} from "@canix402/x402-client/protocol";

export interface PaidCallResult {
  status: number;
  body: unknown;
  paymentResponseHeader: string | null;
  paymentRequired: PaymentRequest | null;
  paymentRequiredHeader: string | null;
}

export class X402ClientError extends Error {
  readonly status: number | undefined;
  readonly bodySnippet: string | undefined;

  constructor(message: string, status?: number, bodySnippet?: string) {
    super(message);
    this.name = "X402ClientError";
    this.status = status;
    this.bodySnippet = bodySnippet;
  }
}

export type FetchFn = typeof fetch;
export type QueryParams = Record<string, string | number | boolean | undefined>;

export interface FreeCallOptions {
  method?: "GET" | "POST";
  query?: QueryParams;
  body?: unknown;
}

export class X402Client {
  constructor(
    private readonly config: McpConfig,
    private readonly fetchImpl: FetchFn = fetch
  ) {}

  buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(path.startsWith("/") ? path : `/${path}`, `${this.config.apiUrl}/`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) {
          continue;
        }
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  async fetchFree(
    path: string,
    queryOrOptions?: QueryParams | FreeCallOptions
  ): Promise<unknown> {
    const options = normalizeFreeCallOptions(queryOrOptions);
    const method = options?.method ?? (options?.body === undefined ? "GET" : "POST");
    const requestUrl = this.buildUrl(path, options?.query);
    const headers: Record<string, string> = {};
    let serializedBody: string | undefined;

    if (options?.body !== undefined) {
      headers["content-type"] = "application/json";
      serializedBody =
        typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    }

    const response = await this.fetchImpl(requestUrl, {
      method,
      headers,
      ...(serializedBody === undefined ? {} : { body: serializedBody })
    });
    const bodyText = await response.text();

    if (response.status !== 200) {
      throw new X402ClientError(
        `${path}: expected 200, got ${response.status}`,
        response.status,
        bodyText.slice(0, 400)
      );
    }

    return bodyText.length === 0 ? null : (JSON.parse(bodyText) as unknown);
  }

  async fetchPaid(
    path: string,
    options?: {
      method?: "GET" | "POST" | "PUT" | "PATCH";
      query?: Record<string, string | number | boolean | undefined>;
      body?: unknown;
      headers?: Record<string, string>;
      paymentSignature?: string;
    }
  ): Promise<PaidCallResult> {
    const method = options?.method ?? (options?.body === undefined ? "GET" : "POST");
    const requestUrl = this.buildUrl(path, options?.query);
    const headers: Record<string, string> = { ...(options?.headers ?? {}) };
    if (options?.paymentSignature) {
      headers["PAYMENT-SIGNATURE"] = options.paymentSignature;
    }
    let serializedBody: string | undefined;

    if (options?.body !== undefined) {
      headers["content-type"] = headers["content-type"] ?? "application/json";
      serializedBody =
        typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    }

    const preflight = await this.fetchImpl(requestUrl, {
      method,
      headers,
      ...(serializedBody === undefined ? {} : { body: serializedBody })
    });

    if (preflight.status === 200) {
      const bodyText = await preflight.text();
      return {
        status: 200,
        body: bodyText.length === 0 ? null : (JSON.parse(bodyText) as unknown),
        paymentResponseHeader: preflight.headers.get("payment-response"),
        paymentRequired: null,
        paymentRequiredHeader: null
      };
    }

    const bodyText = await preflight.text();
    if (preflight.status !== 402) {
      throw new X402ClientError(
        `${path}: expected status 200 or 402, got ${preflight.status}`,
        preflight.status,
        bodyText.slice(0, 400)
      );
    }

    const paymentRequiredHeader = preflight.headers.get("payment-required");
    const paymentRequired = paymentRequiredHeader
      ? decodePaymentRequiredHeader(paymentRequiredHeader)
      : null;

    const parsedBody = bodyText.length === 0 ? null : parseBodyOrText(bodyText);

    return {
      status: 402,
      body: parsedBody,
      paymentResponseHeader: preflight.headers.get("payment-response"),
      paymentRequired,
      paymentRequiredHeader
    };
  }
}

function normalizeFreeCallOptions(
  queryOrOptions: QueryParams | FreeCallOptions | undefined
): FreeCallOptions | undefined {
  if (
    queryOrOptions
    && ("method" in queryOrOptions || "query" in queryOrOptions || "body" in queryOrOptions)
  ) {
    return queryOrOptions as FreeCallOptions;
  }
  return queryOrOptions ? { query: queryOrOptions as QueryParams } : undefined;
}

function parseBodyOrText(bodyText: string): unknown {
  try {
    return JSON.parse(bodyText) as unknown;
  } catch {
    return bodyText;
  }
}
