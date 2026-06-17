import { Type, Static } from "@sinclair/typebox";

export const SupportedProtocolValues = [
  "tinyman",
  "pact",
  "folks-finance",
  "compx",
  "dorkfi",
  "haystack"
] as const;

export const ProtocolSchema = Type.Union(
  SupportedProtocolValues.map((value) => Type.Literal(value))
);

export type Protocol = Static<typeof ProtocolSchema>;

export const PaginationQuerySchema = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
  includeInactive: Type.Optional(Type.Boolean({ default: false }))
});

export const OpportunitiesQuerySchema = Type.Composite([
  PaginationQuerySchema,
  Type.Object({
    protocol: Type.Optional(ProtocolSchema)
  })
]);

export type OpportunitiesQuery = Static<typeof OpportunitiesQuerySchema>;

export const ProtocolOpportunitiesParamsSchema = Type.Object({
  protocol: ProtocolSchema
});

export const ProtocolOpportunitiesQuerySchema = PaginationQuerySchema;

export type ProtocolOpportunitiesParams = Static<
  typeof ProtocolOpportunitiesParamsSchema
>;
export type ProtocolOpportunitiesQuery = Static<
  typeof ProtocolOpportunitiesQuerySchema
>;
