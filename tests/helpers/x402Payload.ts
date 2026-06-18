export interface X402SplitQuote {
  quoteId: string;
  actionFingerprint: string;
  assetId: string;
  nonce: string;
  expiresAt: string;
  split: Array<{
    role: string;
    address: string;
    amount: string;
  }>;
}

export interface X402PaymentRequirements {
  scheme: string;
  network: string;
  asset: string;
  payTo: string;
  maxAmountRequired: string;
  resource: string;
  extra?: {
    avmSplitQuote?: X402SplitQuote;
  };
}

export interface X402PaymentPayload {
  paymentGroup: string[];
  paymentIndex: number;
}

export interface X402PaymentSignaturePayload {
  x402Version: number;
  paymentPayload: X402PaymentPayload;
  paymentRequirements: X402PaymentRequirements;
}

export interface X402HeaderValidationResult {
  ok: boolean;
  statusCode: 200 | 402;
  errorCode?:
    | "MISSING_PAYMENT_SIGNATURE"
    | "MALFORMED_PAYMENT_SIGNATURE"
    | "EXPIRED_PAYMENT_PROOF";
  message?: string;
  parsed?: X402PaymentSignaturePayload;
}

export function encodePaymentSignature(
  payload: X402PaymentSignaturePayload
): string {
  return Buffer.from(JSON.stringify(payload), "utf-8").toString("base64");
}

export function decodePaymentSignature(
  headerValue: string
): X402PaymentSignaturePayload {
  const decoded = Buffer.from(headerValue, "base64").toString("utf-8");
  const parsed = JSON.parse(decoded) as unknown;

  if (!isPaymentSignaturePayload(parsed)) {
    throw new Error("PAYMENT-SIGNATURE payload does not match required shape.");
  }

  return parsed;
}

export function validatePaymentSignatureHeader(
  headerValue: string | undefined,
  now: Date = new Date()
): X402HeaderValidationResult {
  if (!headerValue) {
    return {
      ok: false,
      statusCode: 402,
      errorCode: "MISSING_PAYMENT_SIGNATURE",
      message: "PAYMENT-SIGNATURE header is required for paid endpoints."
    };
  }

  let payload: X402PaymentSignaturePayload;
  try {
    payload = decodePaymentSignature(headerValue);
  } catch {
    return {
      ok: false,
      statusCode: 402,
      errorCode: "MALFORMED_PAYMENT_SIGNATURE",
      message: "PAYMENT-SIGNATURE header could not be decoded or validated."
    };
  }

  const expiresAt = payload.paymentRequirements.extra?.avmSplitQuote?.expiresAt;
  if (expiresAt) {
    const expiresAtDate = new Date(expiresAt);
    if (Number.isNaN(expiresAtDate.getTime()) || expiresAtDate <= now) {
      return {
        ok: false,
        statusCode: 402,
        errorCode: "EXPIRED_PAYMENT_PROOF",
        message: "The payment proof is expired."
      };
    }
  }

  return {
    ok: true,
    statusCode: 200,
    parsed: payload
  };
}

function isPaymentSignaturePayload(
  value: unknown
): value is X402PaymentSignaturePayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as {
    x402Version?: unknown;
    paymentPayload?: unknown;
    paymentRequirements?: unknown;
  };

  if (candidate.x402Version !== 2) {
    return false;
  }

  if (!isPaymentPayload(candidate.paymentPayload)) {
    return false;
  }

  if (!isPaymentRequirements(candidate.paymentRequirements)) {
    return false;
  }

  return true;
}

function isPaymentPayload(value: unknown): value is X402PaymentPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as {
    paymentGroup?: unknown;
    paymentIndex?: unknown;
  };

  return (
    Array.isArray(candidate.paymentGroup) &&
    candidate.paymentGroup.length > 0 &&
    candidate.paymentGroup.every((item) => typeof item === "string" && isValidBase64(item)) &&
    typeof candidate.paymentIndex === "number" &&
    Number.isInteger(candidate.paymentIndex) &&
    candidate.paymentIndex >= 0 &&
    candidate.paymentIndex < candidate.paymentGroup.length
  );
}

function isPaymentRequirements(value: unknown): value is X402PaymentRequirements {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as {
    scheme?: unknown;
    network?: unknown;
    asset?: unknown;
    payTo?: unknown;
    maxAmountRequired?: unknown;
    resource?: unknown;
  };

  return (
    typeof candidate.scheme === "string" &&
    candidate.scheme.length > 0 &&
    typeof candidate.network === "string" &&
    candidate.network.length > 0 &&
    typeof candidate.asset === "string" &&
    candidate.asset.length > 0 &&
    typeof candidate.payTo === "string" &&
    candidate.payTo.length > 0 &&
    typeof candidate.maxAmountRequired === "string" &&
    candidate.maxAmountRequired.length > 0 &&
    typeof candidate.resource === "string" &&
    candidate.resource.length > 0
  );
}

function isValidBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) {
    return false;
  }

  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}
