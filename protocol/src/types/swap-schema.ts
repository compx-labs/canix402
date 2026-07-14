import { Static, Type } from "@sinclair/typebox";

const BaseUnitSchema = Type.Union([
  Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  Type.String({ pattern: "^[1-9][0-9]*$" })
]);

const AssetIdSchema = Type.Union([
  Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  Type.String({ pattern: "^[0-9]+$" })
]);

const AlgorandAddressSchema = Type.String({ minLength: 58, maxLength: 58 });

const DisabledProtocolSchema = Type.Union([
  Type.Literal("TinymanV2"),
  Type.Literal("Algofi"),
  Type.Literal("Algomint"),
  Type.Literal("Pact"),
  Type.Literal("Folks"),
  Type.Literal("TAlgo")
]);

export const SwapQuoteRequestSchema = Type.Object({
  address: AlgorandAddressSchema,
  fromAssetId: AssetIdSchema,
  toAssetId: AssetIdSchema,
  amount: BaseUnitSchema,
  type: Type.Optional(
    Type.Union([Type.Literal("fixed-input"), Type.Literal("fixed-output")])
  ),
  disabledProtocols: Type.Optional(Type.Array(DisabledProtocolSchema, { uniqueItems: true })),
  maxGroupSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 16 })),
  maxDepth: Type.Optional(Type.Integer({ minimum: 1, maximum: 4 }))
});

export const HaystackTxnPayloadSchema = Type.Object({
  iv: Type.String(),
  data: Type.String({ minLength: 1 })
});

export const HaystackQuoteSchema = Type.Object({
  address: AlgorandAddressSchema,
  fromAssetId: Type.String({ pattern: "^[0-9]+$" }),
  toAssetId: Type.String({ pattern: "^[0-9]+$" }),
  amount: Type.String({ pattern: "^[1-9][0-9]*$" }),
  type: Type.Union([Type.Literal("fixed-input"), Type.Literal("fixed-output")]),
  quotedAmount: Type.String({ pattern: "^[0-9]+$" }),
  createdAt: Type.String({ format: "date-time" }),
  expiresAt: Type.String({ format: "date-time" }),
  requiredAppOptIns: Type.Array(Type.String({ pattern: "^[1-9][0-9]*$" })),
  txnPayload: Type.Union([HaystackTxnPayloadSchema, Type.Null()]),
  usdIn: Type.Optional(Type.Number()),
  usdOut: Type.Optional(Type.Number()),
  userPriceImpact: Type.Optional(Type.Number()),
  marketPriceImpact: Type.Optional(Type.Number()),
  priceBaseline: Type.Optional(Type.Number()),
  route: Type.Array(Type.Unknown()),
  quotes: Type.Array(Type.Unknown()),
  protocolFees: Type.Record(Type.String(), Type.Number())
});

export const SwapQuoteResponseSchema = Type.Object({
  data: HaystackQuoteSchema,
  meta: Type.Object({
    paymentRequired: Type.Literal(false),
    executionSubmitted: Type.Literal(false)
  })
});

export const SwapOptInRequestSchema = Type.Object({
  address: AlgorandAddressSchema,
  quote: HaystackQuoteSchema
});

export const OptInTransactionSchema = Type.Object({
  index: Type.Integer({ minimum: 0 }),
  kind: Type.Union([Type.Literal("asset-opt-in"), Type.Literal("application-opt-in")]),
  encodedTransaction: Type.String({ minLength: 1 }),
  signer: Type.Literal("user"),
  assetId: Type.Optional(Type.String({ pattern: "^[1-9][0-9]*$" })),
  appId: Type.Optional(Type.String({ pattern: "^[1-9][0-9]*$" }))
});

export const SwapOptInResponseSchema = Type.Object({
  data: Type.Object({
    required: Type.Boolean(),
    transactions: Type.Array(OptInTransactionSchema),
    userSignIndexes: Type.Array(Type.Integer({ minimum: 0 })),
    createdAt: Type.String({ format: "date-time" }),
    expiresAt: Type.String({ format: "date-time" })
  }),
  meta: Type.Object({
    paymentRequired: Type.Literal(false),
    executionSubmitted: Type.Literal(false)
  })
});

export const SwapTransactionsRequestSchema = Type.Object({
  address: AlgorandAddressSchema,
  quote: HaystackQuoteSchema,
  slippage: Type.Number({ minimum: 0, maximum: 100 })
});

export const SwapGroupTransactionSchema = Type.Object({
  index: Type.Integer({ minimum: 0 }),
  encodedTransaction: Type.String({ minLength: 1 }),
  signer: Type.Union([Type.Literal("user"), Type.Literal("haystack")]),
  signedTransaction: Type.Optional(Type.String({ minLength: 1 }))
});

export const SwapTransactionsResponseSchema = Type.Object({
  data: Type.Object({
    transactions: Type.Array(SwapGroupTransactionSchema, { minItems: 1 }),
    userSignIndexes: Type.Array(Type.Integer({ minimum: 0 })),
    createdAt: Type.String({ format: "date-time" }),
    quoteExpiresAt: Type.String({ format: "date-time" })
  }),
  meta: Type.Object({
    paymentRequired: Type.Literal(true),
    executionSubmitted: Type.Literal(false)
  })
});

export type SwapQuoteRequest = Static<typeof SwapQuoteRequestSchema>;
export type HaystackQuote = Static<typeof HaystackQuoteSchema>;
export type SwapOptInRequest = Static<typeof SwapOptInRequestSchema>;
export type SwapTransactionsRequest = Static<typeof SwapTransactionsRequestSchema>;
export type SwapQuoteResponse = Static<typeof SwapQuoteResponseSchema>;
export type SwapOptInResponse = Static<typeof SwapOptInResponseSchema>;
export type SwapTransactionsResponse = Static<typeof SwapTransactionsResponseSchema>;
