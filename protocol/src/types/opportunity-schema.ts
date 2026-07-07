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
  notes: Type.Optional(Type.String())
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

export type OpportunityRecordV1 = Static<typeof OpportunityRecordSchema>;
export type YieldBasis = Static<typeof YieldBasisSchema>;
