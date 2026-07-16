import { Static, Type } from "@sinclair/typebox";

const AssetIdSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });

export const PricingRequestSchema = Type.Object({
  assetIds: Type.Array(AssetIdSchema, {
    minItems: 1,
    maxItems: 100
  })
});

export const TokenPriceSchema = Type.Object({
  assetId: Type.String({ pattern: "^[0-9]+$" }),
  priceUsd: Type.Union([Type.Number({ minimum: 0 }), Type.Null()])
});

export const PricingResponseSchema = Type.Object({
  data: Type.Object({
    prices: Type.Array(TokenPriceSchema),
    source: Type.Literal("compx"),
    fetchedAt: Type.String({ format: "date-time" })
  }),
  meta: Type.Object({
    paymentRequired: Type.Literal(false),
    executionSubmitted: Type.Literal(false)
  })
});

export type PricingRequest = Static<typeof PricingRequestSchema>;
export type PricingResponse = Static<typeof PricingResponseSchema>;
