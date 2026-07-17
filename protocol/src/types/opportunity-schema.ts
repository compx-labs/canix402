import { Static, Type } from "@sinclair/typebox";

import {
  ProtocolSchema,
  SupportedOpportunityTypeValues
} from "../routes/schemas.js";

export const YieldBasisSchema = Type.Union([
  Type.Literal("apy"),
  Type.Literal("apr")
]);

export const OpportunityTypeSchema = Type.Union(
  SupportedOpportunityTypeValues.map((value) => Type.Literal(value))
);

/**
 * Allowlisted selector hints derived from an opportunity. Amounts never appear.
 */
export const OpportunityExecutionInputHintsSchema = Type.Object(
  {
    assetId: Type.Optional(Type.Integer({ minimum: 0 })),
    assetAId: Type.Optional(Type.Integer({ minimum: 0 })),
    assetBId: Type.Optional(Type.Integer({ minimum: 0 })),
    depositAssetId: Type.Optional(Type.Integer({ minimum: 0 })),
    poolAppId: Type.Optional(Type.Integer({ minimum: 1 })),
    marketAppId: Type.Optional(Type.Integer({ minimum: 1 })),
    poolId: Type.Optional(Type.String({ minLength: 1 })),
    programId: Type.Optional(Type.Integer({ minimum: 1 })),
    liquidityAssetId: Type.Optional(Type.Integer({ minimum: 0 })),
    escrowAddress: Type.Optional(Type.String({ minLength: 58, maxLength: 58 }))
  },
  { additionalProperties: false }
);

export const OpportunityExecutionShapeSchema = Type.Object({
  shapeKey: Type.String({ minLength: 1 }),
  protocol: Type.String({ minLength: 1 }),
  protocolVersion: Type.String({ minLength: 1 }),
  action: Type.String({ minLength: 1 }),
  variant: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1 }),
  summary: Type.String({ minLength: 1 }),
  order: Type.Integer({ minimum: 0 }),
  prerequisiteShapeKeys: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  requiredInputs: Type.Array(Type.String({ minLength: 1 })),
  requiredAssetIds: Type.Array(Type.Integer({ minimum: 0 })),
  inputHints: Type.Optional(OpportunityExecutionInputHintsSchema)
});

/** Market-data fields produced by protocol adapters (before execution enrichment). */
export const OpportunityMarketRecordSchema = Type.Object({
  protocol: ProtocolSchema,
  opportunityType: OpportunityTypeSchema,
  opportunityId: Type.String(),
  assetPair: Type.String(),
  assetIds: Type.Optional(Type.Array(Type.Integer({ minimum: 0 }))),
  apy: Type.Number(),
  yieldBasis: YieldBasisSchema,
  tvlUsd: Type.Number(),
  apr: Type.Optional(Type.Number()),
  sourceTimestamp: Type.String({ format: "date-time" }),
  fetchedAt: Type.String({ format: "date-time" }),
  notes: Type.Optional(Type.String())
});

export const OpportunityRecordSchema = Type.Object({
  protocol: ProtocolSchema,
  opportunityType: OpportunityTypeSchema,
  opportunityId: Type.String(),
  assetPair: Type.String(),
  assetIds: Type.Optional(Type.Array(Type.Integer({ minimum: 0 }))),
  apy: Type.Number(),
  yieldBasis: YieldBasisSchema,
  tvlUsd: Type.Number(),
  apr: Type.Optional(Type.Number()),
  sourceTimestamp: Type.String({ format: "date-time" }),
  fetchedAt: Type.String({ format: "date-time" }),
  notes: Type.Optional(Type.String()),
  executionReady: Type.Boolean(),
  executionShapes: Type.Array(OpportunityExecutionShapeSchema)
});

export const OpportunitiesListMetaSchema = Type.Object({
  limit: Type.Integer(),
  offset: Type.Integer(),
  includeInactive: Type.Boolean(),
  paymentRequired: Type.Boolean()
});

export const OpportunitiesListResponseSchema = Type.Object({
  data: Type.Array(OpportunityRecordSchema),
  meta: Type.Optional(OpportunitiesListMetaSchema)
});

export const PersonalizedOpportunitiesListMetaSchema = Type.Composite([
  OpportunitiesListMetaSchema,
  Type.Object({
    address: Type.String(),
    heldAssetCount: Type.Integer()
  })
]);

export const PersonalizedOpportunitiesListResponseSchema = Type.Object({
  data: Type.Array(OpportunityRecordSchema),
  meta: Type.Optional(PersonalizedOpportunitiesListMetaSchema)
});

export type OpportunityMarketRecord = Static<typeof OpportunityMarketRecordSchema>;
export type OpportunityExecutionInputHints = Static<
  typeof OpportunityExecutionInputHintsSchema
>;
export type OpportunityExecutionShape = Static<typeof OpportunityExecutionShapeSchema>;
export type OpportunityRecordV1 = Static<typeof OpportunityRecordSchema>;
export type YieldBasis = Static<typeof YieldBasisSchema>;
