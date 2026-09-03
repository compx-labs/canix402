import { Static, Type } from "@sinclair/typebox";

import { ProtocolSchema } from "../routes/schemas.js";
import { OpportunityCapacitySchema } from "./opportunity-schema.js";

export const ELIGIBILITY_MAX_OPPORTUNITY_IDS = 25;

export const EligibilityRequestSchema = Type.Object(
  {
    address: Type.String({ minLength: 1 }),
    opportunityIds: Type.Array(Type.String({ minLength: 1 }), {
      minItems: 1,
      maxItems: ELIGIBILITY_MAX_OPPORTUNITY_IDS
    }),
    /** Bypass Redis and refetch adapters; still writes a fresh cache entry. */
    refresh: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
);

export const EligibilityGateStatusSchema = Type.Union([
  Type.Literal("pass"),
  Type.Literal("fail"),
  Type.Literal("unresolved")
]);

export const EligibilityReasonSchema = Type.Union([
  Type.Literal("opportunity-not-found"),
  Type.Literal("capacity-not-accepting"),
  Type.Literal("capacity-no-slots"),
  Type.Literal("capacity-no-algo-room"),
  Type.Literal("below-min-amount"),
  Type.Literal("missing-asa-gate"),
  Type.Literal("unresolved-nfd-gate"),
  Type.Literal("unresolved-creator-gate"),
  Type.Literal("missing-required-asset")
]);

export const EligibilityMissingAssetSchema = Type.Object(
  {
    assetId: Type.Integer({ minimum: 0 }),
    requiredAmount: Type.String({ minLength: 1, pattern: "^[0-9]+$" }),
    heldAmount: Type.String({ minLength: 1, pattern: "^[0-9]+$" }),
    shortfall: Type.String({ minLength: 1, pattern: "^[0-9]+$" }),
    role: Type.Union([
      Type.Literal("min-amount"),
      Type.Literal("asa-gate"),
      Type.Literal("required-asset")
    ])
  },
  { additionalProperties: false }
);

const optionalHeldAmount = Type.Optional(
  Type.String({ minLength: 1, pattern: "^[0-9]+$" })
);
const optionalMinBalance = Type.Optional(
  Type.String({ minLength: 1, pattern: "^[0-9]+$" })
);

export const EligibilityGateResultSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("asa"),
      assetId: Type.Integer({ minimum: 0 }),
      minBalance: optionalMinBalance,
      status: EligibilityGateStatusSchema,
      heldAmount: optionalHeldAmount,
      reason: Type.Optional(EligibilityReasonSchema)
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      kind: Type.Literal("asa-creator"),
      creator: Type.String({ minLength: 58, maxLength: 58 }),
      minBalance: optionalMinBalance,
      status: EligibilityGateStatusSchema,
      heldAmount: optionalHeldAmount,
      reason: Type.Optional(EligibilityReasonSchema)
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      kind: Type.Literal("nfd-linked-creators"),
      nfd: Type.String({ minLength: 1 }),
      status: EligibilityGateStatusSchema,
      heldAmount: optionalHeldAmount,
      reason: Type.Optional(EligibilityReasonSchema)
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      kind: Type.Literal("nfd-root-segment"),
      nfdRoot: Type.String({ minLength: 1 }),
      status: EligibilityGateStatusSchema,
      heldAmount: optionalHeldAmount,
      reason: Type.Optional(EligibilityReasonSchema)
    },
    { additionalProperties: false }
  )
]);

export const EligibilitySuggestedSwapSchema = Type.Object(
  {
    fromAssetId: Type.Integer({ minimum: 0 }),
    toAssetId: Type.Integer({ minimum: 0 }),
    amount: Type.String({ minLength: 1, pattern: "^[0-9]+$" }),
    reason: Type.Union([
      Type.Literal("missing-asa-gate"),
      Type.Literal("missing-min-amount"),
      Type.Literal("missing-required-asset")
    ]),
    note: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

export const OpportunityEligibilitySchema = Type.Object(
  {
    opportunityId: Type.String({ minLength: 1 }),
    protocol: Type.Union([ProtocolSchema, Type.Null()]),
    found: Type.Boolean(),
    canEnter: Type.Boolean(),
    eligibilityFullyCheckable: Type.Boolean(),
    missingAssets: Type.Array(EligibilityMissingAssetSchema),
    gates: Type.Array(EligibilityGateResultSchema),
    capacity: Type.Union([OpportunityCapacitySchema, Type.Null()]),
    suggestedSwap: Type.Union([EligibilitySuggestedSwapSchema, Type.Null()]),
    reasons: Type.Array(EligibilityReasonSchema),
    /**
     * Wallet health factor for this lending venue when positions already expose
     * it. Omitted when no snapshot exists; never invented.
     */
    healthFactor: Type.Optional(Type.Union([Type.Number({ minimum: 0 }), Type.Null()]))
  },
  { additionalProperties: false }
);

export const EligibilityResponseSchema = Type.Object(
  {
    data: Type.Array(OpportunityEligibilitySchema),
    meta: Type.Object(
      {
        address: Type.String(),
        fetchedAt: Type.String({ format: "date-time" }),
        paymentRequired: Type.Literal(true),
        quoteTimeAuthoritative: Type.Literal(true)
      },
      { additionalProperties: false }
    )
  },
  { additionalProperties: false }
);

export type EligibilityRequest = Static<typeof EligibilityRequestSchema>;
export type EligibilityGateStatus = Static<typeof EligibilityGateStatusSchema>;
export type EligibilityReason = Static<typeof EligibilityReasonSchema>;
export type EligibilityMissingAsset = Static<typeof EligibilityMissingAssetSchema>;
export type EligibilityGateResult = Static<typeof EligibilityGateResultSchema>;
export type EligibilitySuggestedSwap = Static<typeof EligibilitySuggestedSwapSchema>;
export type OpportunityEligibility = Static<typeof OpportunityEligibilitySchema>;
export type EligibilityResponse = Static<typeof EligibilityResponseSchema>;
