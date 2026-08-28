import { Static, Type } from "@sinclair/typebox";

import { ProtocolSchema } from "../routes/schemas.js";
import {
  EligibilitySuggestedSwapSchema,
  OpportunityEligibilitySchema
} from "./eligibility-schema.js";
import {
  ExecutableQuoteSchema,
  ExecutionQuoteInputSchema
} from "./execution-quote-schema.js";
import { OpportunityExecutionShapeSchema } from "./opportunity-schema.js";
import { SimulationSummarySchema } from "./simulate-schema.js";

export const PLAN_MAX_OPPORTUNITY_IDS = 25;
export const PLAN_MAX_ALLOCATIONS = 10;
/** Compiler SKU: dearer than POST /execution/quotes (0.10 USDC). */
export const DEFAULT_PLAN_PRICE_USDC = "0.25";

export const PlanBudgetSchema = Type.Object(
  {
    assetId: Type.Integer({ minimum: 0 }),
    /** Base-unit amount (decimal string). */
    amount: Type.String({ minLength: 1, pattern: "^[0-9]+$" })
  },
  { additionalProperties: false }
);

export const PlanConstraintsSchema = Type.Object(
  {
    /** Cap any single protocol at this share of the budget (10000 = 100%). */
    maxProtocolWeightBps: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
    /** Skip borrow shapes / loan-credit enters. Default true. */
    noNewBorrows: Type.Optional(Type.Boolean()),
    /** Only opportunities with executionReady enter shapes. Default true. */
    executionReadyOnly: Type.Optional(Type.Boolean()),
    minTvlUsd: Type.Optional(Type.Number({ minimum: 0 })),
    /** Drop opportunities whose sourceTimestamp is older than this. */
    maxSourceAgeSeconds: Type.Optional(Type.Integer({ minimum: 0 })),
    maxAllocations: Type.Optional(
      Type.Integer({ minimum: 1, maximum: PLAN_MAX_ALLOCATIONS })
    )
  },
  { additionalProperties: false }
);

export const PlanRequestSchema = Type.Object(
  {
    address: Type.String({ minLength: 1 }),
    budget: PlanBudgetSchema,
    constraints: Type.Optional(PlanConstraintsSchema),
    /** Pin the compiler to these ids (still gated by eligibility + constraints). */
    opportunityIds: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        minItems: 1,
        maxItems: PLAN_MAX_OPPORTUNITY_IDS
      })
    ),
    /** Haystack slippage percent (0–100) for swap-aware compose. Default 1. */
    swapSlippage: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
    refresh: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
);

export const PlanQuoteRequestSchema = Type.Object(
  {
    shapeKey: Type.String({ minLength: 1 }),
    input: ExecutionQuoteInputSchema
  },
  { additionalProperties: false }
);

export const PlanStepKindSchema = Type.Union([
  Type.Literal("eligibility"),
  Type.Literal("claim"),
  Type.Literal("exit"),
  Type.Literal("opt-in"),
  Type.Literal("swap"),
  Type.Literal("setup"),
  Type.Literal("enter")
]);

export const PlanCompileStatusSchema = Type.Union([
  Type.Literal("compiled"),
  Type.Literal("deferred"),
  Type.Literal("blocked"),
  Type.Literal("hint")
]);

export const PlanStepSchema = Type.Object(
  {
    kind: PlanStepKindSchema,
    order: Type.Integer({ minimum: 0 }),
    compileStatus: PlanCompileStatusSchema,
    shapeKey: Type.Optional(Type.String({ minLength: 1 })),
    prerequisiteShapeKeys: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    quoteRequest: Type.Optional(PlanQuoteRequestSchema),
    quote: Type.Optional(ExecutableQuoteSchema),
    suggestedSwap: Type.Optional(
      Type.Union([EligibilitySuggestedSwapSchema, Type.Null()])
    ),
    warnings: Type.Array(Type.String())
  },
  { additionalProperties: false }
);

export const PlanAllocationSchema = Type.Object(
  {
    opportunityId: Type.String({ minLength: 1 }),
    protocol: ProtocolSchema,
    opportunityType: Type.String({ minLength: 1 }),
    assetPair: Type.String(),
    apy: Type.Number(),
    allocatedAmount: Type.String({ minLength: 1, pattern: "^[0-9]+$" }),
    allocatedAssetId: Type.Integer({ minimum: 0 }),
    weightBps: Type.Integer({ minimum: 0, maximum: 10_000 }),
    /** Copied from the opportunity so POST /policy/validate can fail closed without re-quoting. */
    tvlUsd: Type.Optional(Type.Number()),
    sourceTimestamp: Type.Optional(Type.String({ format: "date-time" })),
    executionReady: Type.Optional(Type.Boolean()),
    eligibility: OpportunityEligibilitySchema,
    executionShapes: Type.Array(OpportunityExecutionShapeSchema),
    steps: Type.Array(PlanStepSchema),
    quotes: Type.Array(PlanQuoteRequestSchema)
  },
  { additionalProperties: false }
);

export const PlanBlockedAllocationSchema = Type.Object(
  {
    opportunityId: Type.String({ minLength: 1 }),
    protocol: Type.Union([ProtocolSchema, Type.Null()]),
    eligibility: OpportunityEligibilitySchema,
    reasons: Type.Array(Type.String())
  },
  { additionalProperties: false }
);

export const PlanPositionDeltaEntrySchema = Type.Object(
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

export const PlanExpectedPositionDeltaSchema = Type.Object(
  {
    summary: Type.String(),
    entries: Type.Array(PlanPositionDeltaEntrySchema)
  },
  { additionalProperties: false }
);

export const PlanFeesSchema = Type.Object(
  {
    x402Usdc: Type.String({ minLength: 1 }),
    estimatedNetworkFeeMicroAlgos: Type.String({ minLength: 1, pattern: "^[0-9]+$" }),
    estimatedNetworkFeeUsd: Type.Union([Type.Number({ minimum: 0 }), Type.Null()])
  },
  { additionalProperties: false }
);

export const PlanDataSchema = Type.Object(
  {
    allocations: Type.Array(PlanAllocationSchema),
    blocked: Type.Array(PlanBlockedAllocationSchema),
    expectedPositionDelta: PlanExpectedPositionDeltaSchema,
    fees: PlanFeesSchema,
    expiresAt: Type.String({ format: "date-time" }),
    warnings: Type.Array(Type.String()),
    /** Fail-closed dry-run of compiled groups when present. Never signed or submitted. */
    simulation: Type.Optional(SimulationSummarySchema)
  },
  { additionalProperties: false }
);

export const PlanResponseMetaSchema = Type.Object(
  {
    address: Type.String(),
    budget: PlanBudgetSchema,
    fetchedAt: Type.String({ format: "date-time" }),
    paymentRequired: Type.Literal(true),
    executionSubmitted: Type.Literal(false),
    quoteTimeAuthoritative: Type.Literal(true),
    eligibilityEndpoint: Type.Literal("/eligibility")
  },
  { additionalProperties: false }
);

export const PlanResponseSchema = Type.Object(
  {
    data: PlanDataSchema,
    meta: PlanResponseMetaSchema
  },
  { additionalProperties: false }
);

export type PlanBudget = Static<typeof PlanBudgetSchema>;
export type PlanConstraints = Static<typeof PlanConstraintsSchema>;
export type PlanRequest = Static<typeof PlanRequestSchema>;
export type PlanQuoteRequest = Static<typeof PlanQuoteRequestSchema>;
export type PlanStepKind = Static<typeof PlanStepKindSchema>;
export type PlanCompileStatus = Static<typeof PlanCompileStatusSchema>;
export type PlanStep = Static<typeof PlanStepSchema>;
export type PlanAllocation = Static<typeof PlanAllocationSchema>;
export type PlanBlockedAllocation = Static<typeof PlanBlockedAllocationSchema>;
export type PlanExpectedPositionDelta = Static<typeof PlanExpectedPositionDeltaSchema>;
export type PlanFees = Static<typeof PlanFeesSchema>;
export type PlanData = Static<typeof PlanDataSchema>;
export type PlanResponse = Static<typeof PlanResponseSchema>;
