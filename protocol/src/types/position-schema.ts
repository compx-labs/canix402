import { Static, Type } from "@sinclair/typebox";

import { ProtocolSchema } from "../routes/schemas.js";
import { OpportunityExecutionInputHintsSchema } from "./opportunity-schema.js";
import { POSITION_TYPES } from "./position.js";

export const PositionTypeSchema = Type.Union(
  POSITION_TYPES.map((value) => Type.Literal(value))
);

export const PositionRecordSchema = Type.Object({
  protocol: ProtocolSchema,
  positionType: PositionTypeSchema,
  positionId: Type.String({ minLength: 1 }),
  opportunityId: Type.Union([Type.String(), Type.Null()]),
  assetId: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  assetSymbol: Type.Union([Type.String(), Type.Null()]),
  amountRaw: Type.String({ pattern: "^[0-9]+$" }),
  amount: Type.String({ pattern: "^[0-9]+(?:\\.[0-9]+)?$" }),
  usdValue: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
  healthFactor: Type.Optional(
    Type.Union([Type.Number({ minimum: 0 }), Type.Null()])
  ),
  sourceTimestamp: Type.Optional(Type.String({ format: "date-time" })),
  caveats: Type.Optional(Type.Array(Type.String())),
  notes: Type.Optional(Type.String()),
  inputHints: Type.Optional(OpportunityExecutionInputHintsSchema),
  compatibleExitShapeKeys: Type.Array(Type.String({ minLength: 1 })),
  compatibleManageShapeKeys: Type.Array(Type.String({ minLength: 1 }))
});

export const ProtocolPositionStatusSchema = Type.Union([
  Type.Literal("ok"),
  Type.Literal("partial"),
  Type.Literal("unavailable")
]);

export const ProtocolPositionResultSchema = Type.Object({
  protocol: ProtocolSchema,
  status: ProtocolPositionStatusSchema,
  positionCount: Type.Integer({ minimum: 0 }),
  message: Type.Union([Type.String(), Type.Null()])
});

export const WalletPositionsQuerySchema = Type.Object({
  address: Type.String({ minLength: 1 })
});

export const WalletPositionsResponseSchema = Type.Object({
  data: Type.Array(PositionRecordSchema),
  protocols: Type.Array(ProtocolPositionResultSchema),
  totals: Type.Object({
    suppliedUsd: Type.Union([Type.Number(), Type.Null()]),
    borrowedUsd: Type.Union([Type.Number(), Type.Null()]),
    rewardsUsd: Type.Union([Type.Number(), Type.Null()]),
    netUsd: Type.Union([Type.Number(), Type.Null()])
  }),
  meta: Type.Object({
    address: Type.String(),
    fetchedAt: Type.String({ format: "date-time" })
  })
});

export type PositionRecordV1Schema = Static<typeof PositionRecordSchema>;
export type WalletPositionsQuery = Static<typeof WalletPositionsQuerySchema>;
export type WalletPositionsResponseSchemaType = Static<
  typeof WalletPositionsResponseSchema
>;
