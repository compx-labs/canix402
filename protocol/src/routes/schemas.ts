import { Type, Static } from "@sinclair/typebox";

export const SupportedProtocolValues = [
  "tinyman",
  "pact",
  "folks-finance",
  "compx",
  "dorkfi",
  "myth-finance"
] as const;
export const SupportedOpportunityTypeValues = ["lp", "farm", "staking", "lending"] as const;

export const ProtocolSchema = Type.Union(
  SupportedProtocolValues.map((value) => Type.Literal(value))
);

export type Protocol = Static<typeof ProtocolSchema>;
export type OpportunityType = (typeof SupportedOpportunityTypeValues)[number];

export const AGGREGATE_OPPORTUNITIES_DEFAULT_LIMIT = 10;
export const PROTOCOL_OPPORTUNITIES_DEFAULT_LIMIT = 25;

function createPaginationQuerySchema(defaultLimit: number) {
  return Type.Object({
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: defaultLimit })),
    offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
    includeInactive: Type.Optional(Type.Boolean({ default: false }))
  });
}

export const PaginationQuerySchema = createPaginationQuerySchema(
  AGGREGATE_OPPORTUNITIES_DEFAULT_LIMIT
);

export const ProtocolPaginationQuerySchema = createPaginationQuerySchema(
  PROTOCOL_OPPORTUNITIES_DEFAULT_LIMIT
);

export const OpportunitiesQuerySchema = Type.Composite([
  PaginationQuerySchema,
  Type.Object({
    protocol: Type.Optional(ProtocolSchema)
  })
]);

export type OpportunitiesQuery = Static<typeof OpportunitiesQuerySchema>;

export const FilteredOpportunitiesDefaultLimit = 25;
export const FilteredOpportunitiesQuerySchema = Type.Object({
  platform: Type.Optional(Type.String()),
  type: Type.Optional(Type.String()),
  minApy: Type.Optional(Type.Number()),
  maxApy: Type.Optional(Type.Number()),
  minTvlUsd: Type.Optional(Type.Number({ minimum: 0 })),
  limit: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 200, default: FilteredOpportunitiesDefaultLimit })
  ),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
  includeInactive: Type.Optional(Type.Boolean({ default: false }))
});
export type FilteredOpportunitiesQuery = Static<typeof FilteredOpportunitiesQuerySchema>;

export const PERSONALIZED_OPPORTUNITIES_DEFAULT_LIMIT = 10;
export const PersonalizedOpportunitiesQuerySchema = Type.Object({
  address: Type.String({ minLength: 1 }),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 200,
      default: PERSONALIZED_OPPORTUNITIES_DEFAULT_LIMIT
    })
  ),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
  includeInactive: Type.Optional(Type.Boolean({ default: false }))
});
export type PersonalizedOpportunitiesQuery = Static<
  typeof PersonalizedOpportunitiesQuerySchema
>;

export const ProtocolOpportunitiesParamsSchema = Type.Object({
  protocol: ProtocolSchema
});

export const ProtocolOpportunitiesQuerySchema = ProtocolPaginationQuerySchema;

export type ProtocolOpportunitiesParams = Static<
  typeof ProtocolOpportunitiesParamsSchema
>;
export type ProtocolOpportunitiesQuery = Static<
  typeof ProtocolOpportunitiesQuerySchema
>;
