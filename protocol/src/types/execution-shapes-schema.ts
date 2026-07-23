import { Static, Type } from "@sinclair/typebox";

export const ExecutionShapeSourceSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("sdk"),
      Type.Literal("api"),
      Type.Literal("docs"),
      Type.Literal("arc56")
    ]),
    description: Type.String({ minLength: 1 }),
    url: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

export const ExecutionShapeCatalogEntrySchema = Type.Object(
  {
    shapeKey: Type.String({ minLength: 1 }),
    network: Type.String({ minLength: 1 }),
    protocol: Type.String({ minLength: 1 }),
    protocolVersion: Type.String({ minLength: 1 }),
    action: Type.String({ minLength: 1 }),
    variant: Type.String({ minLength: 1 }),
    shapeVersion: Type.String({ minLength: 1 }),
    title: Type.String({ minLength: 1 }),
    description: Type.String({ minLength: 1 }),
    summary: Type.String({ minLength: 1 }),
    opportunityRole: Type.Union([
      Type.Literal("enter"),
      Type.Literal("exit"),
      Type.Literal("manage")
    ]),
    supportedOpportunityTypes: Type.Array(Type.String({ minLength: 1 })),
    requiredInputs: Type.Array(Type.String({ minLength: 1 })),
    sources: Type.Array(ExecutionShapeSourceSchema),
    docsPath: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

export const ExecutionShapesListResponseSchema = Type.Object(
  {
    data: Type.Array(ExecutionShapeCatalogEntrySchema),
    meta: Type.Object(
      {
        paymentRequired: Type.Literal(false),
        shapeCount: Type.Integer({ minimum: 0 }),
        note: Type.Optional(Type.String())
      },
      { additionalProperties: true }
    )
  },
  { additionalProperties: false }
);

export type ExecutionShapeCatalogEntryDto = Static<
  typeof ExecutionShapeCatalogEntrySchema
>;
export type ExecutionShapesListResponse = Static<
  typeof ExecutionShapesListResponseSchema
>;
