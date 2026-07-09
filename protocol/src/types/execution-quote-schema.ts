import { Static, Type } from "@sinclair/typebox";

export const ExecutionQuoteInputSchema = Type.Object({
  userAddress: Type.String({ minLength: 1 }),
  assetAId: Type.Union([Type.Integer({ minimum: 0 }), Type.String()]),
  assetAAmount: Type.Optional(
    Type.Union([Type.Integer({ minimum: 1 }), Type.String({ minLength: 1 })])
  ),
  assetBId: Type.Union([Type.Integer({ minimum: 0 }), Type.String()]),
  assetBAmount: Type.Optional(
    Type.Union([Type.Integer({ minimum: 1 }), Type.String({ minLength: 1 })])
  ),
  poolTokenAmount: Type.Optional(
    Type.Union([Type.Integer({ minimum: 1 }), Type.String({ minLength: 1 })])
  ),
  depositAssetId: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.String()])),
  depositAmount: Type.Optional(
    Type.Union([Type.Integer({ minimum: 1 }), Type.String({ minLength: 1 })])
  ),
  outputAssetId: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.String()])),
  maxSlippageBps: Type.Union([Type.Integer({ minimum: 0, maximum: 10_000 }), Type.String()]),
  poolId: Type.Optional(Type.String({ minLength: 1 }))
});

export const ExecutionQuoteRequestSchema = Type.Object({
  shapeKey: Type.String({ minLength: 1 }),
  input: ExecutionQuoteInputSchema
});

export const SerializedPaymentFieldsSchema = Type.Object({
  receiver: Type.String(),
  amount: Type.String(),
  closeRemainderTo: Type.Optional(Type.String())
});

export const SerializedAssetTransferFieldsSchema = Type.Object({
  assetIndex: Type.String(),
  amount: Type.String(),
  receiver: Type.String(),
  assetSender: Type.Optional(Type.String()),
  closeRemainderTo: Type.Optional(Type.String())
});

export const SerializedBoxReferenceSchema = Type.Object({
  appIndex: Type.String(),
  nameBase64: Type.String()
});

export const SerializedApplicationCallFieldsSchema = Type.Object({
  appIndex: Type.String(),
  onComplete: Type.Integer(),
  appArgsBase64: Type.Array(Type.String()),
  appArgsText: Type.Array(Type.Union([Type.String(), Type.Null()])),
  accounts: Type.Array(Type.String()),
  foreignApps: Type.Array(Type.String()),
  foreignAssets: Type.Array(Type.String()),
  boxes: Type.Array(SerializedBoxReferenceSchema)
});

export const SerializedTransactionSchema = Type.Object({
  type: Type.String(),
  sender: Type.String(),
  fee: Type.String(),
  groupPresent: Type.Boolean(),
  payment: Type.Optional(SerializedPaymentFieldsSchema),
  assetTransfer: Type.Optional(SerializedAssetTransferFieldsSchema),
  applicationCall: Type.Optional(SerializedApplicationCallFieldsSchema)
});

export const TransactionShapeIdentitySchema = Type.Object({
  network: Type.Union([Type.Literal("mainnet"), Type.Literal("testnet")]),
  protocol: Type.String(),
  protocolVersion: Type.String(),
  action: Type.String(),
  variant: Type.String()
});

export const ExecutableQuoteSchema = Type.Object({
  shapeKey: Type.String(),
  shapeVersion: Type.String(),
  identity: TransactionShapeIdentitySchema,
  createdAt: Type.String({ format: "date-time" }),
  expiresAt: Type.String({ format: "date-time" }),
  transactions: Type.Array(SerializedTransactionSchema),
  encodedTransactions: Type.Array(Type.String()),
  warnings: Type.Array(Type.String()),
  metadata: Type.Record(Type.String(), Type.Unknown())
});

export const ExecutionQuoteResponseSchema = Type.Object({
  data: ExecutableQuoteSchema,
  meta: Type.Object({
    paymentRequired: Type.Literal(true),
    executionSubmitted: Type.Literal(false)
  })
});

export type ExecutionQuoteRequest = Static<typeof ExecutionQuoteRequestSchema>;
export type ExecutionQuoteResponse = Static<typeof ExecutionQuoteResponseSchema>;
