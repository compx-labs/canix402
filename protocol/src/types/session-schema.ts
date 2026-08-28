import { Static, Type } from "@sinclair/typebox";

export const DEFAULT_SESSION_PRICE_USDC = "0.25";
export const DEFAULT_SESSION_RESEARCH_BUDGET = 50;
export const DEFAULT_SESSION_QUOTE_BUDGET = 10;
export const DEFAULT_SESSION_TTL_SECONDS = 14_400;

export const SessionBudgetSchema = Type.Object(
  {
    research: Type.Integer({ minimum: 0 }),
    quotes: Type.Integer({ minimum: 0 })
  },
  { additionalProperties: false }
);

export const SessionReceiptSchema = Type.Object(
  {
    uri: Type.String({ minLength: 1 }),
    sessionId: Type.String({ minLength: 1 }),
    createdAt: Type.String({ format: "date-time" }),
    expiresAt: Type.String({ format: "date-time" }),
    ttlSeconds: Type.Integer({ minimum: 1 }),
    budget: SessionBudgetSchema,
    remaining: SessionBudgetSchema,
    consumed: SessionBudgetSchema,
    status: Type.Union([
      Type.Literal("active"),
      Type.Literal("expired"),
      Type.Literal("exhausted")
    ])
  },
  { additionalProperties: false }
);

export const SessionResponseMetaSchema = Type.Object(
  {
    paymentRequired: Type.Boolean(),
    access: Type.Union([Type.Literal("session"), Type.Literal("receipt")]),
    receiptUri: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

export const SessionResponseSchema = Type.Object(
  {
    data: SessionReceiptSchema,
    meta: SessionResponseMetaSchema
  },
  { additionalProperties: false }
);

export const SessionRefreshRequestSchema = Type.Object(
  {
    sessionId: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

export type SessionReceiptDto = Static<typeof SessionReceiptSchema>;
export type SessionResponse = Static<typeof SessionResponseSchema>;
export type SessionRefreshRequest = Static<typeof SessionRefreshRequestSchema>;
