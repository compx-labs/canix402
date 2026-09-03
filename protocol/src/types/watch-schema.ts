import { Static, Type } from "@sinclair/typebox";

export const DEFAULT_WATCH_PRICE_USDC = "0.25";
export const DEFAULT_WATCH_TTL_SECONDS = 86_400;
export const DEFAULT_WATCH_POLL_SECONDS = 300;
export const MAX_WATCH_FIRINGS = 20;

export const WatchRetiCapacityThresholdSchema = Type.Object(
  {
    minStakerSlotsRemaining: Type.Optional(Type.Integer({ minimum: 0 })),
    minAlgoRoomMicroAlgos: Type.Optional(
      Type.String({ minLength: 1, pattern: "^[0-9]+$" })
    )
  },
  { additionalProperties: false }
);

export const WatchThresholdsSchema = Type.Object(
  {
    healthFactor: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
    claimableUsd: Type.Optional(Type.Number({ minimum: 0 })),
    apyDropBps: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
    retiCapacity: Type.Optional(
      Type.Union([Type.Literal(true), WatchRetiCapacityThresholdSchema])
    )
  },
  { additionalProperties: false, minProperties: 1 }
);

export const WatchCreateRequestSchema = Type.Object(
  {
    address: Type.String({ minLength: 58, maxLength: 58 }),
    thresholds: WatchThresholdsSchema,
    webhookUrl: Type.Optional(Type.String({ minLength: 8, maxLength: 2048 }))
  },
  { additionalProperties: false }
);

export const WatchRefreshRequestSchema = Type.Object(
  {
    watchId: Type.String({ minLength: 1 }),
    rotateSecret: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
);

export const WatchRotateSecretRequestSchema = Type.Object({}, { additionalProperties: false });

export const WatchFiringSchema = Type.Object(
  {
    firingId: Type.String({ minLength: 1 }),
    idempotencyKey: Type.String({ minLength: 1 }),
    kind: Type.Union([
      Type.Literal("healthFactor"),
      Type.Literal("claimableUsd"),
      Type.Literal("apyDrop"),
      Type.Literal("retiCapacity")
    ]),
    firedAt: Type.String({ format: "date-time" }),
    threshold: Type.Union([Type.Number(), Type.String(), Type.Boolean()]),
    previous: Type.Union([Type.Number(), Type.String(), Type.Boolean(), Type.Null()]),
    current: Type.Union([Type.Number(), Type.String(), Type.Boolean(), Type.Null()]),
    opportunityId: Type.Optional(Type.String({ minLength: 1 })),
    delivered: Type.Boolean(),
    deliveryStatus: Type.Union([
      Type.Literal("pending"),
      Type.Literal("delivered"),
      Type.Literal("failed"),
      Type.Literal("stored")
    ])
  },
  { additionalProperties: false }
);

export const WatchReceiptSchema = Type.Object(
  {
    uri: Type.String({ minLength: 1 }),
    watchId: Type.String({ minLength: 1 }),
    address: Type.String({ minLength: 58, maxLength: 58 }),
    thresholds: WatchThresholdsSchema,
    webhookUrl: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    createdAt: Type.String({ format: "date-time" }),
    expiresAt: Type.String({ format: "date-time" }),
    ttlSeconds: Type.Integer({ minimum: 1 }),
    status: Type.Union([Type.Literal("active"), Type.Literal("expired")]),
    firings: Type.Array(WatchFiringSchema),
    webhookSecret: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

export const WatchResponseMetaSchema = Type.Object(
  {
    paymentRequired: Type.Boolean(),
    access: Type.Union([
      Type.Literal("watch"),
      Type.Literal("receipt"),
      Type.Literal("rotate")
    ]),
    receiptUri: Type.String({ minLength: 1 }),
    secretShown: Type.Boolean()
  },
  { additionalProperties: false }
);

export const WatchResponseSchema = Type.Object(
  {
    data: WatchReceiptSchema,
    meta: WatchResponseMetaSchema
  },
  { additionalProperties: false }
);

export type WatchCreateRequest = Static<typeof WatchCreateRequestSchema>;
export type WatchRefreshRequest = Static<typeof WatchRefreshRequestSchema>;
export type WatchReceiptDto = Static<typeof WatchReceiptSchema>;
export type WatchResponse = Static<typeof WatchResponseSchema>;
export type WatchThresholdsDto = Static<typeof WatchThresholdsSchema>;
