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
  extensions?: Record<string, unknown>;
  [key: string]: unknown;
}

export function decodePaymentRequiredHeader(headerValue: string): PaymentRequest {
  const normalized = headerValue.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const decoded = new TextDecoder().decode(bytes);
  const parsed = JSON.parse(decoded) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("PAYMENT-REQUIRED payload is not a JSON object.");
  }

  const candidate = parsed as Partial<PaymentRequest>;
  if (!Array.isArray(candidate.accepts) || candidate.accepts.length === 0) {
    throw new Error("PAYMENT-REQUIRED payload is missing accepts.");
  }

  return candidate as PaymentRequest;
}

export function tryGetAlgorandAccept(
  paymentRequest: PaymentRequest
): PaymentRequestAccept | undefined {
  return paymentRequest.accepts.find((accept) => {
    const network = accept.network.toLowerCase();
    return network === "algorand-mainnet" || network.startsWith("algorand:");
  });
}

export function getAlgorandAccept(paymentRequest: PaymentRequest): PaymentRequestAccept {
  const accepted = tryGetAlgorandAccept(paymentRequest);
  if (!accepted) {
    throw new Error(
      `PAYMENT-REQUIRED does not contain an Algorand accept option. Networks: ${paymentRequest.accepts
        .map((accept) => accept.network)
        .join(", ")}`
    );
  }
  return accepted;
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
