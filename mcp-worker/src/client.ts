import {
  decodePaymentRequiredHeader,
  type PaymentRequest
} from "@canix402/x402-client/protocol";

export interface GatewayClientConfig {
  gatewayUrl: string;
}

export interface PaidCallResult {
  status: number;
  body: unknown;
  paymentRequired: PaymentRequest | null;
  paymentRequiredHeader: string | null;
  paymentResponseHeader: string | null;
}

export class GatewayClientError extends Error {
  readonly status: number | undefined;
  readonly bodySnippet: string | undefined;

  constructor(message: string, status?: number, bodySnippet?: string) {
    super(message);
    this.name = "GatewayClientError";
    this.status = status;
    this.bodySnippet = bodySnippet;
  }
}

export type FetchFn = typeof fetch;

export class GatewayClient {
  constructor(
    private readonly config: GatewayClientConfig,
    private readonly fetchImpl: FetchFn = (...args) => fetch(...args)
  ) {}

  buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(path.startsWith("/") ? path : `/${path}`, `${this.config.gatewayUrl}/`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  async fetchFree(
    path: string,
    query?: Record<string, string | number | boolean | undefined>
  ): Promise<unknown> {
    const requestUrl = this.buildUrl(path, query);
    const response = await this.fetchImpl(requestUrl);
    const bodyText = await response.text();

    if (response.status !== 200) {
      throw new GatewayClientError(
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
      method?: "GET" | "POST";
      query?: Record<string, string | number | boolean | undefined>;
      body?: unknown;
      paymentSignature?: string;
    }
  ): Promise<PaidCallResult> {
    const method = options?.method ?? (options?.body === undefined ? "GET" : "POST");
    const requestUrl = this.buildUrl(path, options?.query);
    const headers: Record<string, string> = {};
    let serializedBody: string | undefined;

    if (options?.body !== undefined) {
      headers["content-type"] = "application/json";
      serializedBody = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    }

    if (options?.paymentSignature) {
      headers["PAYMENT-SIGNATURE"] = options.paymentSignature;
    }

    const response = await this.fetchImpl(requestUrl, {
      method,
      headers,
      ...(serializedBody === undefined ? {} : { body: serializedBody })
    });
    const bodyText = await response.text();

    if (response.status !== 200 && response.status !== 402) {
      throw new GatewayClientError(
        `${path}: expected 200 or 402, got ${response.status}`,
        response.status,
        bodyText.slice(0, 400)
      );
    }

    const paymentRequiredHeader = response.headers.get("payment-required");
    const paymentRequired = paymentRequiredHeader
      ? decodePaymentRequiredHeader(paymentRequiredHeader)
      : null;

    return {
      status: response.status,
      body: bodyText.length === 0 ? null : parseBodyOrText(bodyText),
      paymentRequired,
      paymentRequiredHeader,
      paymentResponseHeader: response.headers.get("payment-response")
    };
  }
}

function parseBodyOrText(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}
