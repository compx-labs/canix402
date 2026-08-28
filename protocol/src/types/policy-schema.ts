import { Static, Type } from "@sinclair/typebox";

import { ProtocolSchema } from "../routes/schemas.js";

/** Compiler SKU: same band as POST /plans (0.25 USDC). */
export const DEFAULT_POLICY_VALIDATE_PRICE_USDC = "0.25";
export const POLICY_SCHEMA_VERSION = "1.0.0" as const;
export const POLICY_MAX_QUOTES = 25;

export const PolicyDocumentSchema = Type.Object(
  {
    /** Versioned contract id. Unknown versions fail closed. */
    schemaVersion: Type.Literal(POLICY_SCHEMA_VERSION),
    /** Cap any single protocol at this share of the subject (10000 = 100%). */
    maxProtocolWeightBps: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
    /** Wallet ALGO that must remain after the subject (microAlgos decimal string). */
    minAlgoReserveMicroAlgos: Type.Optional(
      Type.String({ minLength: 1, pattern: "^[0-9]+$" })
    ),
    minTvlUsd: Type.Optional(Type.Number({ minimum: 0 })),
    /** Drop / fail rows whose sourceTimestamp is older than this. */
    maxSourceAgeSeconds: Type.Optional(Type.Integer({ minimum: 0 })),
    /** Reject borrow shapes / loan-credit enters. */
    noNewBorrows: Type.Optional(Type.Boolean()),
    /** Reject rows that are not execution-ready. */
    executionReadyOnly: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
);

export const PolicyQuoteSubjectSchema = Type.Object(
  {
    shapeKey: Type.Optional(Type.String({ minLength: 1 })),
    opportunityId: Type.Optional(Type.String({ minLength: 1 })),
    protocol: Type.Optional(ProtocolSchema),
    opportunityType: Type.Optional(Type.String({ minLength: 1 })),
    weightBps: Type.Optional(Type.Integer({ minimum: 0, maximum: 10_000 })),
    allocatedAmount: Type.Optional(Type.String({ minLength: 1, pattern: "^[0-9]+$" })),
    allocatedAssetId: Type.Optional(Type.Integer({ minimum: 0 })),
    tvlUsd: Type.Optional(Type.Number()),
    sourceTimestamp: Type.Optional(Type.String({ minLength: 1 })),
    executionReady: Type.Optional(Type.Boolean()),
    eligibility: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    identity: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    quote: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    input: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
  },
  { additionalProperties: true }
);

export const PolicyValidateRequestSchema = Type.Object(
  {
    policy: PolicyDocumentSchema,
    /**
     * Compiled POST /plans (or /plans/rebalance) payload. Accepts the full
     * `{ data, meta }` envelope or the inner `data` object.
     */
    plan: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    /** Proposed quotes[] when a compiled plan envelope is not available. */
    quotes: Type.Optional(
      Type.Array(PolicyQuoteSubjectSchema, {
        minItems: 1,
        maxItems: POLICY_MAX_QUOTES
      })
    ),
    /**
     * Wallet ALGO balance in microAlgos (decimal string). Required when
     * `minAlgoReserveMicroAlgos` is set — Canix does not look up holdings.
     */
    walletAlgoMicroAlgos: Type.Optional(Type.String({ pattern: "^[0-9]+$" })),
    /** Override evaluation clock for freshness (ISO-8601). */
    evaluatedAt: Type.Optional(Type.String({ format: "date-time" }))
  },
  { additionalProperties: false }
);

export const PolicyReasonCodeSchema = Type.Union([
  Type.Literal("empty-subject"),
  Type.Literal("protocol-weight"),
  Type.Literal("missing-protocol"),
  Type.Literal("missing-weight"),
  Type.Literal("below-reserve"),
  Type.Literal("missing-reserve"),
  Type.Literal("below-tvl-floor"),
  Type.Literal("missing-tvl"),
  Type.Literal("source-not-fresh"),
  Type.Literal("missing-freshness"),
  Type.Literal("new-borrow"),
  Type.Literal("execution-not-ready"),
  Type.Literal("missing-execution-ready"),
  Type.Literal("blocked-eligibility"),
  Type.Literal("eligibility-not-fully-checkable")
]);

export const PolicyReasonSchema = Type.Object(
  {
    code: PolicyReasonCodeSchema,
    message: Type.String({ minLength: 1 }),
    opportunityId: Type.Optional(Type.String({ minLength: 1 })),
    protocol: Type.Optional(Type.String({ minLength: 1 })),
    details: Type.Optional(
      Type.Record(
        Type.String(),
        Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()])
      )
    )
  },
  { additionalProperties: false }
);

export const PolicyValidateDataSchema = Type.Object(
  {
    pass: Type.Boolean(),
    reasons: Type.Array(PolicyReasonSchema),
    policySchemaVersion: Type.Literal(POLICY_SCHEMA_VERSION),
    evaluatedAt: Type.String({ format: "date-time" }),
    signed: Type.Literal(false),
    submitted: Type.Literal(false)
  },
  { additionalProperties: false }
);

export const PolicyValidateResponseMetaSchema = Type.Object(
  {
    fetchedAt: Type.String({ format: "date-time" }),
    paymentRequired: Type.Literal(true),
    executionSubmitted: Type.Literal(false),
    signed: Type.Literal(false),
    quoteTimeAuthoritative: Type.Literal(true)
  },
  { additionalProperties: false }
);

export const PolicyValidateResponseSchema = Type.Object(
  {
    data: PolicyValidateDataSchema,
    meta: PolicyValidateResponseMetaSchema
  },
  { additionalProperties: false }
);

export type PolicyDocument = Static<typeof PolicyDocumentSchema>;
export type PolicyQuoteSubject = Static<typeof PolicyQuoteSubjectSchema>;
export type PolicyValidateRequest = Static<typeof PolicyValidateRequestSchema>;
export type PolicyReasonCode = Static<typeof PolicyReasonCodeSchema>;
export type PolicyReason = Static<typeof PolicyReasonSchema>;
export type PolicyValidateData = Static<typeof PolicyValidateDataSchema>;
export type PolicyValidateResponse = Static<typeof PolicyValidateResponseSchema>;
