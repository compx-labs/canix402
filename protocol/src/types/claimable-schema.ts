import { Static, Type } from "@sinclair/typebox";

import { ProtocolSchema } from "../routes/schemas.js";
import { OpportunityExecutionInputHintsSchema } from "./opportunity-schema.js";
import {
  PositionTypeSchema,
  ProtocolPositionResultSchema,
  WalletPositionsQuerySchema
} from "./position-schema.js";

export const ClaimablePositionsQuerySchema = WalletPositionsQuerySchema;

export const ClaimableQuoteInputSchema = Type.Object(
  {
    userAddress: Type.String({ minLength: 1 }),
    programId: Type.Optional(Type.Integer({ minimum: 1 })),
    poolAddress: Type.Optional(Type.String({ minLength: 1 })),
    poolAppId: Type.Optional(Type.Integer({ minimum: 1 })),
    farmAppId: Type.Optional(Type.Integer({ minimum: 1 }))
  },
  { additionalProperties: true }
);

export const ClaimableQuoteRequestSchema = Type.Object({
  shapeKey: Type.String({ minLength: 1 }),
  input: ClaimableQuoteInputSchema
});

export const ClaimableRewardRecordSchema = Type.Object({
  protocol: ProtocolSchema,
  positionId: Type.String({ minLength: 1 }),
  opportunityId: Type.Union([Type.String(), Type.Null()]),
  positionType: PositionTypeSchema,
  assetId: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  assetSymbol: Type.Union([Type.String(), Type.Null()]),
  amountRaw: Type.String({ pattern: "^[0-9]+$" }),
  amount: Type.String({ pattern: "^[0-9]+(?:\\.[0-9]+)?$" }),
  usdValue: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
  claimKey: Type.String({ minLength: 1 }),
  compatibleClaimShapeKeys: Type.Array(Type.String({ minLength: 1 }), {
    minItems: 1
  }),
  quote: Type.Union([ClaimableQuoteRequestSchema, Type.Null()]),
  estimatedNetworkFeeMicroAlgos: Type.String({ pattern: "^[0-9]+$" }),
  estimatedNetworkFeeUsd: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
  worthClaiming: Type.Union([Type.Boolean(), Type.Null()]),
  submitMode: Type.Optional(Type.Literal("tinyman-analytics-claim")),
  caveats: Type.Optional(Type.Array(Type.String())),
  notes: Type.Optional(Type.String()),
  inputHints: Type.Optional(OpportunityExecutionInputHintsSchema),
  sourceTimestamp: Type.Optional(Type.String({ format: "date-time" }))
});

export const ClaimableRewardsResponseSchema = Type.Object({
  data: Type.Array(ClaimableRewardRecordSchema),
  protocols: Type.Array(ProtocolPositionResultSchema),
  totals: Type.Object({
    claimableUsd: Type.Union([Type.Number(), Type.Null()]),
    estimatedNetworkFeeUsd: Type.Union([Type.Number(), Type.Null()]),
    worthClaimingUsd: Type.Union([Type.Number(), Type.Null()])
  }),
  claimAllQuotes: Type.Object({
    quotes: Type.Array(ClaimableQuoteRequestSchema)
  }),
  meta: Type.Object({
    address: Type.String(),
    fetchedAt: Type.String({ format: "date-time" }),
    algoUsd: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
    paymentRequired: Type.Literal(true)
  })
});

export type ClaimablePositionsQuery = Static<typeof ClaimablePositionsQuerySchema>;
export type ClaimableRewardsResponseSchemaType = Static<
  typeof ClaimableRewardsResponseSchema
>;
