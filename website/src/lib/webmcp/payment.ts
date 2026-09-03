export interface PaymentRequestAccept {
  scheme: string;
  network: string;
  asset: string;
  payTo: string;
  amount?: string;
  maxAmountRequired?: string;
  extra?: unknown;
  [key: string]: unknown;
}

export interface PaymentRequest {
  x402Version?: number;
  accepts: PaymentRequestAccept[];
  resource?: {
    url?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export function decodePaymentRequiredHeader(headerValue: string): PaymentRequest | null {
  try {
    const normalized = headerValue.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(decoded) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const candidate = parsed as Partial<PaymentRequest>;
    if (!Array.isArray(candidate.accepts) || candidate.accepts.length === 0) {
      return null;
    }
    return candidate as PaymentRequest;
  } catch {
    return null;
  }
}

export function microUsdcToUsdc(rawAmount: string | undefined): string | undefined {
  if (!rawAmount) {
    return undefined;
  }
  if (rawAmount.includes(".")) {
    return rawAmount;
  }
  try {
    const micro = BigInt(rawAmount);
    const whole = micro / 1_000_000n;
    const fraction = (micro % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
    return fraction.length > 0 ? `${whole.toString()}.${fraction}` : whole.toString();
  } catch {
    return rawAmount;
  }
}

export function sessionErrorFromBody(body: unknown): { code: string; message: string } | undefined {
  return typedApiErrorFromBody(body, "SESSION_");
}

export function watchErrorFromBody(body: unknown): { code: string; message: string } | undefined {
  return typedApiErrorFromBody(body, "WATCH_");
}

export function typedApiErrorFromBody(
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
