import { Static, Type } from "@sinclair/typebox";

import { OpportunityProtocolSchema } from "../routes/schemas.js";
import { OpportunityEligibilitySchema } from "./eligibility-schema.js";
import { OpportunityExecutionShapeSchema } from "./opportunity-schema.js";
import {
  PlanExpectedPositionDeltaSchema,
  PlanFeesSchema,
  PlanQuoteRequestSchema,
  PlanStepSchema
} from "./plan-schema.js";

/** Compiler SKU: same band as POST /execution/quotes (0.10 USDC). */
export const DEFAULT_COMPOSE_PRICE_USDC = "0.1";
/** Swap slippage percent (0–100). */
export const DEFAULT_COMPOSE_SLIPPAGE_PERCENT = 1;

export const ComposeRequestSchema = Type.Object(
  {
    address: Type.String({ minLength: 1 }),
    opportunityId: Type.String({ minLength: 1 }),
    /** Asset the wallet will spend (0 = ALGO). */
    fromAssetId: Type.Integer({ minimum: 0 }),
    /** Base-unit amount of fromAssetId (decimal string). */
    amount: Type.String({ minLength: 1, pattern: "^[0-9]+$" }),
    /** Swap slippage percent (0–100). Default 1. */
    slippage: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
    refresh: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
);

export const ComposeDataSchema = Type.Object(
  {
    opportunityId: Type.String({ minLength: 1 }),
    protocol: OpportunityProtocolSchema,
    opportunityType: Type.String({ minLength: 1 }),
    assetPair: Type.String(),
    fromAssetId: Type.Integer({ minimum: 0 }),
    toAssetId: Type.Integer({ minimum: 0 }),
    inputAmount: Type.String({ minLength: 1, pattern: "^[0-9]+$" }),
    enterAmount: Type.String({ minLength: 1, pattern: "^[0-9]+$" }),
    slippage: Type.Number({ minimum: 0, maximum: 100 }),
    eligibility: OpportunityEligibilitySchema,
    executionShapes: Type.Array(OpportunityExecutionShapeSchema),
    steps: Type.Array(PlanStepSchema),
    quotes: Type.Array(PlanQuoteRequestSchema),
    expectedPositionDelta: PlanExpectedPositionDeltaSchema,
    fees: PlanFeesSchema,
    expiresAt: Type.String({ format: "date-time" }),
    warnings: Type.Array(Type.String())
  },
  { additionalProperties: false }
);

export const ComposeResponseMetaSchema = Type.Object(
  {
    address: Type.String(),
    opportunityId: Type.String({ minLength: 1 }),
    fetchedAt: Type.String({ format: "date-time" }),
    paymentRequired: Type.Literal(true),
    executionSubmitted: Type.Literal(false),
    quoteTimeAuthoritative: Type.Literal(true),
    groupsMerged: Type.Literal(false)
  },
  { additionalProperties: false }
);

export const ComposeResponseSchema = Type.Object(
  {
    data: ComposeDataSchema,
    meta: ComposeResponseMetaSchema
  },
  { additionalProperties: false }
);

export type ComposeRequest = Static<typeof ComposeRequestSchema>;
export type ComposeData = Static<typeof ComposeDataSchema>;
export type ComposeResponse = Static<typeof ComposeResponseSchema>;
