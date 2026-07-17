import { Type, Static } from "@sinclair/typebox";

/** Protocol-fixed share of strategy compile access fees paid to the NFT holder. */
export const STRATEGY_HOLDER_FEE_SHARE_BPS = 5_000;

/** Weight sum required across legs (100%). */
export const STRATEGY_WEIGHT_BPS_TOTAL = 10_000;

/** Minimum interval between successful revises for a given strategyId. */
export const STRATEGY_REVISE_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

export const StrategyStatusSchema = Type.Union([
  Type.Literal("published"),
  Type.Literal("suspended"),
  Type.Literal("degraded"),
  Type.Literal("archived")
]);

export const StrategyLegSchema = Type.Object(
  {
    shapeKey: Type.String({ minLength: 1 }),
    opportunityId: Type.Optional(Type.String({ minLength: 1 })),
    venueIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })),
    weightBps: Type.Integer({ minimum: 1, maximum: STRATEGY_WEIGHT_BPS_TOTAL })
  },
  { additionalProperties: false }
);

export const StrategyDocumentSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    strategyId: Type.Integer({ minimum: 1 }),
    creatorAddress: Type.String({ minLength: 58, maxLength: 58 }),
    createdAt: Type.String({ format: "date-time" }),
    lastRevisedAt: Type.String({ format: "date-time" }),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    description: Type.String({ minLength: 1, maxLength: 4000 }),
    tags: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 32 }),
    status: StrategyStatusSchema,
    legs: Type.Array(StrategyLegSchema, { minItems: 1, maxItems: 32 }),
    holderFeeShareBps: Type.Literal(STRATEGY_HOLDER_FEE_SHARE_BPS)
  },
  { additionalProperties: false }
);

export const StrategyPublishBodySchema = Type.Object(
  {
    creatorAddress: Type.String({ minLength: 58, maxLength: 58 }),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    description: Type.String({ minLength: 1, maxLength: 4000 }),
    tags: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 32 })
    ),
    legs: Type.Array(StrategyLegSchema, { minItems: 1, maxItems: 32 })
  },
  { additionalProperties: false }
);

export const StrategyReviseBodySchema = Type.Object(
  {
    holderAddress: Type.String({ minLength: 58, maxLength: 58 }),
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 4000 })),
    tags: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 32 })
    ),
    legs: Type.Array(StrategyLegSchema, { minItems: 1, maxItems: 32 })
  },
  { additionalProperties: false }
);

export const StrategyCompileBodySchema = Type.Object(
  {
    userAddress: Type.String({ minLength: 58, maxLength: 58 }),
    /**
     * Total capital budget (base units of whatever the agent is allocating).
     * Split across legs by weightBps; agents that need per-leg asset amounts
     * should pass overrides via legInputs after assembling the right balances.
     */
    amount: Type.String({ minLength: 1, pattern: "^[0-9]+$" }),
    /** Optional per-leg input overrides merged after weight scaling. */
    legInputs: Type.Optional(
      Type.Array(
        Type.Object({
          legIndex: Type.Integer({ minimum: 0 }),
          input: Type.Record(Type.String(), Type.Unknown())
        })
      )
    )
  },
  { additionalProperties: false }
);

export const StrategyListQuerySchema = Type.Object({
  status: Type.Optional(StrategyStatusSchema),
  tag: Type.Optional(Type.String({ minLength: 1 })),
  creatorAddress: Type.Optional(Type.String({ minLength: 58, maxLength: 58 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 }))
});

export const StrategyIdParamsSchema = Type.Object({
  strategyId: Type.Integer({ minimum: 1 })
});

export type StrategyStatus = Static<typeof StrategyStatusSchema>;
export type StrategyLeg = Static<typeof StrategyLegSchema>;
export type StrategyDocument = Static<typeof StrategyDocumentSchema>;
export type StrategyPublishBody = Static<typeof StrategyPublishBodySchema>;
export type StrategyReviseBody = Static<typeof StrategyReviseBodySchema>;
export type StrategyCompileBody = Static<typeof StrategyCompileBodySchema>;
export type StrategyListQuery = Static<typeof StrategyListQuerySchema>;
