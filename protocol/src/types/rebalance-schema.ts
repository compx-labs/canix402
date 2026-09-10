import { Static, Type } from "@sinclair/typebox";

import { ProtocolSchema } from "../routes/schemas.js";
import {
  PlanBlockedAllocationSchema,
  PlanConstraintsSchema,
  PlanExpectedPositionDeltaSchema,
  PlanFeesSchema,
  PlanQuoteRequestSchema,
  PlanStepSchema
} from "./plan-schema.js";
import { SimulationSummarySchema } from "./simulate-schema.js";

/** Compiler SKU: same band as POST /plans (0.25 USDC). */
export const DEFAULT_REBALANCE_PRICE_USDC = "0.25";
/** Leave this much ALGO in the wallet for fees / min-balance (microAlgos). */
export const DEFAULT_ALGO_RESERVE_MICRO = "1000000";
/** Ignore book vs target gaps smaller than this (50 = 0.50%). */
export const DEFAULT_MIN_DELTA_BPS = 50;
export const REBALANCE_MAX_TARGETS = 25;

export const RebalanceTargetWeightSchema = Type.Object(
  {
    opportunityId: Type.String({ minLength: 1 }),
    /** Share of the rebalance universe (10000 = 100%). */
    weightBps: Type.Integer({ minimum: 0, maximum: 10_000 })
  },
  { additionalProperties: false }
);

export const RebalanceRequestSchema = Type.Object(
  {
    address: Type.String({ minLength: 1 }),
    /**
     * Target weights for a subset of the book. Positions not listed are left
     * alone (deltas only — not a full unwind). Weights must sum to 10000.
     */
    targetWeights: Type.Optional(
      Type.Array(RebalanceTargetWeightSchema, {
        minItems: 1,
        maxItems: REBALANCE_MAX_TARGETS
      })
    ),
    /**
     * Claim worth-claiming rewards and treat idle ALGO (wallet ALGO minus
     * reserve) as capital to redeploy. Default false.
     */
    harvestIdle: Type.Optional(Type.Boolean()),
    /** Override claim inclusion. Default matches harvestIdle. */
    includeClaims: Type.Optional(Type.Boolean()),
    /** MicroAlgos to leave undeployed. Default 1000000 (1 ALGO). */
    algoReserveMicroAlgos: Type.Optional(
      Type.String({ minLength: 1, pattern: "^[0-9]+$" })
    ),
    /** Skip overweight/underweight legs below this gap. Default 50. */
    minDeltaBps: Type.Optional(Type.Integer({ minimum: 0, maximum: 10_000 })),
    constraints: Type.Optional(PlanConstraintsSchema),
    /** Swap slippage percent (0–100) for swap-aware enter compose. */
    swapSlippage: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
    refresh: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
);

export const RebalanceModeSchema = Type.Union([
  Type.Literal("target-weights"),
  Type.Literal("harvest-idle"),
  Type.Literal("combined")
]);

export const RebalanceBookWeightSchema = Type.Object(
  {
    opportunityId: Type.String({ minLength: 1 }),
    protocol: Type.Union([ProtocolSchema, Type.Null()]),
    usdValue: Type.Number({ minimum: 0 }),
    currentWeightBps: Type.Integer({ minimum: 0, maximum: 10_000 }),
    targetWeightBps: Type.Integer({ minimum: 0, maximum: 10_000 }),
    /** target − current. Positive = underweight. */
    deltaBps: Type.Integer({ minimum: -10_000, maximum: 10_000 })
  },
  { additionalProperties: false }
);

export const RebalanceBookSchema = Type.Object(
  {
    totalUsd: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
    idleAlgoMicroAlgos: Type.String({ minLength: 1, pattern: "^[0-9]+$" }),
    weights: Type.Array(RebalanceBookWeightSchema),
    unweightedUsd: Type.Union([Type.Number({ minimum: 0 }), Type.Null()])
  },
  { additionalProperties: false }
);

export const RebalanceDataSchema = Type.Object(
  {
    mode: RebalanceModeSchema,
    book: RebalanceBookSchema,
    steps: Type.Array(PlanStepSchema),
    quotes: Type.Array(PlanQuoteRequestSchema),
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

export const RebalanceResponseMetaSchema = Type.Object(
  {
    address: Type.String(),
    harvestIdle: Type.Boolean(),
    fetchedAt: Type.String({ format: "date-time" }),
    paymentRequired: Type.Literal(true),
    executionSubmitted: Type.Literal(false),
    quoteTimeAuthoritative: Type.Literal(true),
    groupsMerged: Type.Literal(false),
    eligibilityEndpoint: Type.Literal("/eligibility")
  },
  { additionalProperties: false }
);

export const RebalanceResponseSchema = Type.Object(
  {
    data: RebalanceDataSchema,
    meta: RebalanceResponseMetaSchema
  },
  { additionalProperties: false }
);

export type RebalanceTargetWeight = Static<typeof RebalanceTargetWeightSchema>;
export type RebalanceRequest = Static<typeof RebalanceRequestSchema>;
export type RebalanceMode = Static<typeof RebalanceModeSchema>;
export type RebalanceBookWeight = Static<typeof RebalanceBookWeightSchema>;
export type RebalanceBook = Static<typeof RebalanceBookSchema>;
export type RebalanceData = Static<typeof RebalanceDataSchema>;
export type RebalanceResponse = Static<typeof RebalanceResponseSchema>;
