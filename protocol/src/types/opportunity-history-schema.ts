import { Static, Type } from "@sinclair/typebox";

/** Bounded windows agents may request. Default is 30d — not a warehouse. */
export const OpportunityHistoryWindowValues = ["1d", "7d", "30d"] as const;
export const DEFAULT_OPPORTUNITY_HISTORY_WINDOW = "30d" as const;

export const OpportunityHistoryWindowSchema = Type.Union(
  OpportunityHistoryWindowValues.map((value) => Type.Literal(value))
);

export const OpportunityStabilityBucketSchema = Type.Union([
  Type.Literal("high"),
  Type.Literal("medium"),
  Type.Literal("low"),
  Type.Literal("unknown")
]);

export const OpportunityHistoryPointSchema = Type.Object(
  {
    ts: Type.String({ format: "date-time" }),
    apy: Type.Number(),
    tvlUsd: Type.Number()
  },
  { additionalProperties: false }
);

/**
 * APY stability derived from the bounded snapshot series.
 * `unknown` when sampleCount < 3 (do not invent a warehouse backfill).
 */
export const OpportunityHistoryStabilitySchema = Type.Object(
  {
    bucket: OpportunityStabilityBucketSchema,
    sampleCount: Type.Integer({ minimum: 0 }),
    /** Mean APY across points in the requested window. Omitted when sampleCount is 0. */
    apyMean: Type.Optional(Type.Number()),
    /** Sample standard deviation of APY. Omitted when sampleCount < 2. */
    apyStdev: Type.Optional(Type.Number())
  },
  { additionalProperties: false }
);

export const OpportunityHistoryQuerySchema = Type.Object({
  window: Type.Optional(
    Type.Union(
      OpportunityHistoryWindowValues.map((value) => Type.Literal(value)),
      { default: DEFAULT_OPPORTUNITY_HISTORY_WINDOW }
    )
  )
});

export const OpportunityHistoryParamsSchema = Type.Object({
  opportunityId: Type.String({ minLength: 1 })
});

export const OpportunityHistoryDataSchema = Type.Object(
  {
    opportunityId: Type.String({ minLength: 1 }),
    window: OpportunityHistoryWindowSchema,
    points: Type.Array(OpportunityHistoryPointSchema),
    stability: OpportunityHistoryStabilitySchema
  },
  { additionalProperties: false }
);

export const OpportunityHistoryMetaSchema = Type.Object(
  {
    paymentRequired: Type.Literal(true),
    windowSeconds: Type.Integer({ minimum: 1 }),
    snapshotRetentionDays: Type.Integer({ minimum: 1 }),
    snapshotCount: Type.Integer({ minimum: 0 })
  },
  { additionalProperties: false }
);

export const OpportunityHistoryResponseSchema = Type.Object({
  data: OpportunityHistoryDataSchema,
  meta: Type.Optional(OpportunityHistoryMetaSchema)
});

export type OpportunityHistoryWindow = Static<typeof OpportunityHistoryWindowSchema>;
export type OpportunityStabilityBucket = Static<typeof OpportunityStabilityBucketSchema>;
export type OpportunityHistoryPoint = Static<typeof OpportunityHistoryPointSchema>;
export type OpportunityHistoryStability = Static<typeof OpportunityHistoryStabilitySchema>;
export type OpportunityHistoryQuery = Static<typeof OpportunityHistoryQuerySchema>;
export type OpportunityHistoryParams = Static<typeof OpportunityHistoryParamsSchema>;
export type OpportunityHistoryData = Static<typeof OpportunityHistoryDataSchema>;
export type OpportunityHistoryResponse = Static<typeof OpportunityHistoryResponseSchema>;
