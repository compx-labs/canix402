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
    "alpha-arcade",
    "stamm"
  ]
};

const swapType = {
  type: "string",
  enum: ["fixed-input", "fixed-output"]
};

const swapRouter = {
  type: "string",
  enum: [
    "haystack",
    "hogswap",
    "tinyman",
    "pact-smart-router",
    "folks-router",
    "asastats"
  ]
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

const watchThresholds = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    healthFactor: { type: "number", exclusiveMinimum: 0 },
    claimableUsd: { type: "number", minimum: 0 },
    apyDropBps: { type: "integer", minimum: 1, maximum: 100000 },
    retiCapacity: {
      anyOf: [
        { type: "boolean", const: true },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            minStakerSlotsRemaining: { type: "integer", minimum: 0 },
            minAlgoRoomMicroAlgos: { type: "string", pattern: "^[0-9]+$" }
          }
        }
      ]
    }
  }
};

const quote = {
  type: "object",
  required: [
    "router",
    "address",
    "fromAssetId",
    "toAssetId",
    "amount",
    "type",
    "quotedAmount",
    "minOut",
    "networkFeeMicroAlgos",
    "slippageBps",
    "createdAt",
    "expiresAt",
    "score",
    "alternatives",
    "legs",
    "payload"
  ],
  properties: {
    router: swapRouter,
    address: algoAddress,
    fromAssetId: { type: "string", pattern: "^[0-9]+$" },
    toAssetId: { type: "string", pattern: "^[0-9]+$" },
    amount: { type: "string", pattern: "^[1-9][0-9]*$" },
    type: swapType,
    quotedAmount: { type: "string", pattern: "^[0-9]+$" },
    minOut: { type: "string", pattern: "^[0-9]+$" },
    networkFeeMicroAlgos: { type: "string", pattern: "^[0-9]+$" },
    slippageBps: { type: "integer", minimum: 0, maximum: 10_000 },
    createdAt: { type: "string", format: "date-time" },
    expiresAt: { type: "string", format: "date-time" },
    score: {
      type: "object",
      required: [
        "expectedNetOut",
        "minOut",
        "expectedIn",
        "networkFeeMicroAlgos",
        "feeAlreadyNetted"
      ],
      properties: {
        expectedNetOut: { type: "string", pattern: "^[0-9]+$" },
        minOut: { type: "string", pattern: "^[0-9]+$" },
        expectedIn: { type: "string", pattern: "^[0-9]+$" },
        maxIn: { type: "string", pattern: "^[0-9]+$" },
        networkFeeMicroAlgos: { type: "string", pattern: "^[0-9]+$" },
        feeAlreadyNetted: { type: "boolean" }
      }
    },
    alternatives: {
      type: "array",
      items: {
        type: "object",
        required: ["router", "status"],
        properties: {
          router: swapRouter,
          status: {
            type: "string",
            enum: ["quoted", "error", "skipped", "timeout"]
          },
          expectedNetOut: { type: "string", pattern: "^[0-9]+$" },
          minOut: { type: "string", pattern: "^[0-9]+$" },
          networkFeeMicroAlgos: { type: "string", pattern: "^[0-9]+$" },
          reason: { type: "string" }
        }
      }
    },
    legs: { type: "array", items: {} },
    payload: {}
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
  swapRouter,
  disabledProtocol,
  pagination,
  constraints,
  watchThresholds,
  quote
};
