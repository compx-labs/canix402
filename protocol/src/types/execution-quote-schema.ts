import { Static, Type } from "@sinclair/typebox";

const BaseUnitAmountSchema = Type.Union([
  Type.Integer({ minimum: 1 }),
  Type.String({ minLength: 1 })
]);

export const ExecutionQuoteInputSchema = Type.Object({
  userAddress: Type.String({ minLength: 1 }),
  // Tinyman LP fields (validated per shape)
  assetAId: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.String()])),
  assetAAmount: Type.Optional(BaseUnitAmountSchema),
  assetBId: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.String()])),
  assetBAmount: Type.Optional(BaseUnitAmountSchema),
  poolTokenAmount: Type.Optional(BaseUnitAmountSchema),
  depositAssetId: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.String()])),
  depositAmount: Type.Optional(BaseUnitAmountSchema),
  outputAssetId: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.String()])),
  maxSlippageBps: Type.Optional(
    Type.Union([Type.Integer({ minimum: 0, maximum: 10_000 }), Type.String()])
  ),
  // Folks Finance lending fields (validated per shape)
  assetId: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.String()])),
  assetAmount: Type.Optional(BaseUnitAmountSchema),
  amount: Type.Optional(BaseUnitAmountSchema),
  amountDenomination: Type.Optional(
    Type.Union([
      Type.Literal("asset"),
      Type.Literal("fAsset"),
      Type.Literal("base"),
      Type.Literal("lst"),
      Type.Literal("ntoken"),
      Type.Literal("asa")
    ])
  ),
  escrowAddress: Type.Optional(Type.String({ minLength: 58, maxLength: 58 })),
  includeOpUp: Type.Optional(Type.Boolean()),
  // Shared traceability / pool selectors (validated per shape)
  poolAppId: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.String()])),
  poolId: Type.Optional(Type.String({ minLength: 1 })),
  // CompX lending fields (validated per shape)
  marketAppId: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.String()])),
  // Tinyman farm fields (validated per shape)
  programId: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.String()])),
  programAccount: Type.Optional(Type.String({ minLength: 58, maxLength: 58 })),
  liquidityAssetId: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.String()])),
  commitAmount: Type.Optional(BaseUnitAmountSchema),
  requiredAssetId: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.String()]))
});

export const ExecutionQuoteRequestSchema = Type.Object({
  quotes: Type.Array(
    Type.Object({
      shapeKey: Type.String({ minLength: 1 }),
      input: ExecutionQuoteInputSchema
    }),
    { minItems: 1 }
  )
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
  noteBase64: Type.Optional(Type.String()),
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
  data: Type.Array(ExecutableQuoteSchema, { minItems: 1 }),
  meta: Type.Object({
    paymentRequired: Type.Literal(true),
    executionSubmitted: Type.Literal(false),
    quoteCount: Type.Integer({ minimum: 1 })
  })
});

export type ExecutionQuoteRequest = Static<typeof ExecutionQuoteRequestSchema>;
export type ExecutionQuoteResponse = Static<typeof ExecutionQuoteResponseSchema>;
