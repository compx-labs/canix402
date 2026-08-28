import type { JsonSchemaObject } from "./types";

const paymentSignature = {
  type: "string",
  minLength: 1,
  description:
    "Optional PAYMENT-SIGNATURE base64 payload. Omit on first call to receive PAYMENT-REQUIRED metadata."
};

const sessionReceipt = {
  type: "string",
  minLength: 1,
  description:
    "Prepaid session receipt (X-Canix-Session). Omit to pay per request with paymentSignature. If this header was sent, Caddy skipped x402; a 402 SESSION_* means drop the header and retry with paymentSignature."
};

const algoAddress = {
  type: "string",
  minLength: 58,
  maxLength: 58,
  description: "58-character account address."
};

const address = {
  type: "string",
  minLength: 1,
  description: "Account address."
};

const assetId = {
  anyOf: [
    { type: "integer", minimum: 0 },
    { type: "string", pattern: "^[0-9]+$" }
  ]
};

const amount = {
  anyOf: [
    { type: "integer", minimum: 1 },
    { type: "string", pattern: "^[1-9][0-9]*$" }
  ]
};

const protocol = {
  type: "string",
  enum: [
    "tinyman",
    "pact",
    "folks-finance",
    "compx",
    "dorkfi",
    "myth-finance",
    "haystack",
    "reti",
    "alpha-arcade"
  ]
};

const swapType = {
  type: "string",
  enum: ["fixed-input", "fixed-output"]
};

const disabledProtocol = {
  type: "string",
  enum: ["Tinyman", "Humble", "TinymanV2", "Algofi", "Algomint", "Pact", "Folks", "TAlgo"]
};

const pagination = {
  limit: { type: "integer", minimum: 1, maximum: 200 },
  offset: { type: "integer", minimum: 0 },
  includeInactive: { type: "boolean" }
};

const constraints = {
  type: "object",
  additionalProperties: false,
  properties: {
    maxProtocolWeightBps: { type: "integer", minimum: 1, maximum: 10_000 },
    noNewBorrows: { type: "boolean" },
    executionReadyOnly: { type: "boolean" },
    minTvlUsd: { type: "number", minimum: 0 },
    maxSourceAgeSeconds: { type: "integer", minimum: 0 },
    maxAllocations: { type: "integer", minimum: 1, maximum: 10 }
  }
};

const quote = {
  type: "object",
  required: [
    "address",
    "fromAssetId",
    "toAssetId",
    "amount",
    "type",
    "quotedAmount",
    "createdAt",
    "expiresAt",
    "requiredAppOptIns",
    "txnPayload",
    "route",
    "quotes",
    "protocolFees"
  ],
  properties: {
    address: algoAddress,
    fromAssetId: { type: "string", pattern: "^[0-9]+$" },
    toAssetId: { type: "string", pattern: "^[0-9]+$" },
    amount: { type: "string", pattern: "^[1-9][0-9]*$" },
    type: swapType,
    quotedAmount: { type: "string", pattern: "^[0-9]+$" },
    createdAt: { type: "string", format: "date-time" },
    expiresAt: { type: "string", format: "date-time" },
    requiredAppOptIns: {
      type: "array",
      items: { type: "string", pattern: "^[1-9][0-9]*$" }
    },
    txnPayload: {
      anyOf: [
        {
          type: "object",
          required: ["iv", "data"],
          properties: {
            iv: { type: "string" },
            data: { type: "string", minLength: 1 }
          }
        },
        { type: "null" }
      ]
    },
    usdIn: { type: "number" },
    usdOut: { type: "number" },
    userPriceImpact: { type: "number" },
    marketPriceImpact: { type: "number" },
    priceBaseline: { type: "number" },
    route: { type: "array", items: {} },
    quotes: { type: "array", items: {} },
    protocolFees: { type: "object", additionalProperties: { type: "number" } }
  }
};

function emptyObject(): JsonSchemaObject {
  return { type: "object", properties: {} };
}

function objectSchema(
  properties: Record<string, unknown>,
  required?: string[]
): JsonSchemaObject {
  return required && required.length > 0
    ? { type: "object", properties, required }
    : { type: "object", properties };
}

function withPaidAuth(
  properties: Record<string, unknown>,
  required?: string[],
  includeSessionReceipt = true
): JsonSchemaObject {
  return objectSchema(
    {
      ...properties,
      paymentSignature,
      ...(includeSessionReceipt ? { sessionReceipt } : {})
    },
    required
  );
}

export const schemas = {
  emptyObject,
  objectSchema,
  withPaidAuth,
  paymentSignature,
  sessionReceipt,
  algoAddress,
  address,
  assetId,
  amount,
  protocol,
  swapType,
  disabledProtocol,
  pagination,
  constraints,
  quote
};
