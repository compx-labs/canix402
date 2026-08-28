import { Static, Type } from "@sinclair/typebox";

import { ProtocolSchema } from "../routes/schemas.js";
import {
  SerializedTransactionSchema,
  TransactionShapeIdentitySchema
} from "./execution-quote-schema.js";
import { OpportunityCapacitySchema } from "./opportunity-schema.js";

/** Compiler SKU: same band as POST /execution/quotes (0.10 USDC). */
export const DEFAULT_SIMULATE_PRICE_USDC = "0.1";
export const SIMULATE_MAX_GROUPS = 25;

export const SimulationReasonCodeSchema = Type.Union([
  Type.Literal("stale-quote"),
  Type.Literal("not-opted-in"),
  Type.Literal("min-balance"),
  Type.Literal("health-factor-too-low"),
  Type.Literal("capacity"),
  Type.Literal("insufficient-balance"),
  Type.Literal("malformed-group"),
  Type.Literal("holdings-unavailable")
]);

export const SimulationReasonSchema = Type.Object(
  {
    code: SimulationReasonCodeSchema,
    message: Type.String({ minLength: 1 }),
    groupIndex: Type.Integer({ minimum: 0 }),
    assetId: Type.Optional(Type.Integer({ minimum: 0 })),
    details: Type.Optional(Type.Record(Type.String(), Type.Union([
      Type.String(),
      Type.Number(),
      Type.Boolean(),
      Type.Null()
    ])))
  },
  { additionalProperties: false }
);

export const SimulationBalanceDeltaSchema = Type.Object(
  {
    address: Type.String({ minLength: 1 }),
    assetId: Type.Integer({ minimum: 0 }),
    before: Type.String({ pattern: "^-?[0-9]+$" }),
    after: Type.String({ pattern: "^-?[0-9]+$" }),
    delta: Type.String({ pattern: "^-?[0-9]+$" })
  },
  { additionalProperties: false }
);

export const SimulationGroupInputSchema = Type.Object(
  {
    shapeKey: Type.Optional(Type.String({ minLength: 1 })),
    expiresAt: Type.Optional(Type.String({ minLength: 1 })),
    opportunityId: Type.Optional(Type.String({ minLength: 1 })),
    identity: Type.Optional(TransactionShapeIdentitySchema),
    transactions: Type.Optional(Type.Array(SerializedTransactionSchema)),
    encodedTransactions: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    warnings: Type.Optional(Type.Array(Type.String())),
    metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    capacity: Type.Optional(OpportunityCapacitySchema)
  },
  { additionalProperties: false }
);

export const SimulationRequestSchema = Type.Object(
  {
    address: Type.String({ minLength: 1 }),
    groups: Type.Array(SimulationGroupInputSchema, {
      minItems: 1,
      maxItems: SIMULATE_MAX_GROUPS
    })
  },
  { additionalProperties: false }
);

export const SimulationPositionDeltaEntrySchema = Type.Object(
  {
    opportunityId: Type.String({ minLength: 1 }),
    protocol: ProtocolSchema,
    assetId: Type.Integer({ minimum: 0 }),
    amount: Type.String({ minLength: 1, pattern: "^[0-9]+$" }),
    action: Type.Union([
      Type.Literal("enter"),
      Type.Literal("exit"),
      Type.Literal("claim")
    ])
  },
  { additionalProperties: false }
);

export const SimulationExpectedPositionDeltaSchema = Type.Object(
  {
    summary: Type.String(),
    entries: Type.Array(SimulationPositionDeltaEntrySchema)
  },
  { additionalProperties: false }
);

export const SimulationGroupResultSchema = Type.Object(
  {
    index: Type.Integer({ minimum: 0 }),
    shapeKey: Type.Optional(Type.String({ minLength: 1 })),
    opportunityId: Type.Optional(Type.String({ minLength: 1 })),
    wouldSucceed: Type.Boolean(),
    reasons: Type.Array(SimulationReasonSchema),
    balanceDeltas: Type.Array(SimulationBalanceDeltaSchema),
    expectedPositionDelta: SimulationExpectedPositionDeltaSchema
  },
  { additionalProperties: false }
);

export const SimulationSummarySchema = Type.Object(
  {
    wouldSucceed: Type.Boolean(),
    reasons: Type.Array(SimulationReasonSchema),
    balanceDeltas: Type.Array(SimulationBalanceDeltaSchema),
    expectedPositionDelta: SimulationExpectedPositionDeltaSchema,
    groups: Type.Array(SimulationGroupResultSchema),
    signed: Type.Literal(false),
    submitted: Type.Literal(false)
  },
  { additionalProperties: false }
);

export const SimulationResponseMetaSchema = Type.Object(
  {
    address: Type.String(),
    fetchedAt: Type.String({ format: "date-time" }),
    paymentRequired: Type.Literal(true),
    executionSubmitted: Type.Literal(false),
    signed: Type.Literal(false)
  },
  { additionalProperties: false }
);

export const SimulationResponseSchema = Type.Object(
  {
    data: SimulationSummarySchema,
    meta: SimulationResponseMetaSchema
  },
  { additionalProperties: false }
);

export type SimulationReasonCode = Static<typeof SimulationReasonCodeSchema>;
export type SimulationReason = Static<typeof SimulationReasonSchema>;
export type SimulationBalanceDelta = Static<typeof SimulationBalanceDeltaSchema>;
export type SimulationGroupInput = Static<typeof SimulationGroupInputSchema>;
export type SimulationRequest = Static<typeof SimulationRequestSchema>;
export type SimulationGroupResult = Static<typeof SimulationGroupResultSchema>;
export type SimulationSummary = Static<typeof SimulationSummarySchema>;
export type SimulationResponse = Static<typeof SimulationResponseSchema>;
