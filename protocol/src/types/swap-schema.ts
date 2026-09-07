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
  Type.Literal("Tinyman"),
  Type.Literal("Humble"),
  Type.Literal("TinymanV2"),
  Type.Literal("Algofi"),
  Type.Literal("Algomint"),
  Type.Literal("Pact"),
  Type.Literal("Folks"),
  Type.Literal("TAlgo")
]);

export const META_SWAP_ROUTER_IDS = [
  "haystack",
  "hogswap",
  "tinyman",
  "pact-smart-router",
  "folks-router",
  "asastats"
] as const;

export const MetaSwapRouterIdSchema = Type.Union([
  Type.Literal("haystack"),
  Type.Literal("hogswap"),
  Type.Literal("tinyman"),
  Type.Literal("pact-smart-router"),
  Type.Literal("folks-router"),
  Type.Literal("asastats")
]);

export const SwapQuoteRequestSchema = Type.Object({
  address: AlgorandAddressSchema,
  fromAssetId: AssetIdSchema,
  toAssetId: AssetIdSchema,
  amount: BaseUnitSchema,
  type: Type.Optional(
    Type.Union([Type.Literal("fixed-input"), Type.Literal("fixed-output")])
  ),
  /** Force a single adapter. Omit to quote every enabled router and pick the best net return. */
  router: Type.Optional(MetaSwapRouterIdSchema),
  /** Percent (0–100). Used at quote time for routers that bake slippage into min-out. Default 1. */
  slippage: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
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

export const MetaSwapScoreSchema = Type.Object({
  expectedNetOut: Type.String({ pattern: "^[0-9]+$" }),
  minOut: Type.String({ pattern: "^[0-9]+$" }),
  expectedIn: Type.String({ pattern: "^[0-9]+$" }),
  maxIn: Type.Optional(Type.String({ pattern: "^[0-9]+$" })),
  networkFeeMicroAlgos: Type.String({ pattern: "^[0-9]+$" }),
  feeAlreadyNetted: Type.Boolean()
});

export const MetaSwapAlternativeSchema = Type.Object({
  router: MetaSwapRouterIdSchema,
  status: Type.Union([
    Type.Literal("quoted"),
    Type.Literal("error"),
    Type.Literal("skipped"),
    Type.Literal("timeout")
  ]),
  expectedNetOut: Type.Optional(Type.String({ pattern: "^[0-9]+$" })),
  minOut: Type.Optional(Type.String({ pattern: "^[0-9]+$" })),
  networkFeeMicroAlgos: Type.Optional(Type.String({ pattern: "^[0-9]+$" })),
  reason: Type.Optional(Type.String())
});

/**
 * Multi-router swap quote. Pass this object unchanged to `/swaps/optin` and
 * `/swaps/transactions`. `payload` is opaque winner state — do not edit it.
 */
export const MetaSwapQuoteSchema = Type.Object({
  router: MetaSwapRouterIdSchema,
  address: AlgorandAddressSchema,
  fromAssetId: Type.String({ pattern: "^[0-9]+$" }),
  toAssetId: Type.String({ pattern: "^[0-9]+$" }),
  amount: Type.String({ pattern: "^[1-9][0-9]*$" }),
  type: Type.Union([Type.Literal("fixed-input"), Type.Literal("fixed-output")]),
  quotedAmount: Type.String({ pattern: "^[0-9]+$" }),
  minOut: Type.String({ pattern: "^[0-9]+$" }),
  networkFeeMicroAlgos: Type.String({ pattern: "^[0-9]+$" }),
  slippageBps: Type.Integer({ minimum: 0, maximum: 10_000 }),
  createdAt: Type.String({ format: "date-time" }),
  expiresAt: Type.String({ format: "date-time" }),
  score: MetaSwapScoreSchema,
  alternatives: Type.Array(MetaSwapAlternativeSchema),
  legs: Type.Array(Type.Unknown()),
  payload: Type.Unknown()
});

export const SwapQuoteResponseSchema = Type.Object({
  data: MetaSwapQuoteSchema,
  meta: Type.Object({
    paymentRequired: Type.Literal(false),
    executionSubmitted: Type.Literal(false)
  })
});

export const SwapOptInRequestSchema = Type.Object({
  address: AlgorandAddressSchema,
  quote: MetaSwapQuoteSchema
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
  quote: MetaSwapQuoteSchema,
  slippage: Type.Number({ minimum: 0, maximum: 100 })
});

export const SwapGroupTransactionSchema = Type.Object({
  index: Type.Integer({ minimum: 0 }),
  encodedTransaction: Type.String({ minLength: 1 }),
  signer: Type.Union([
    Type.Literal("user"),
    Type.Literal("haystack"),
    Type.Literal("protocol")
  ]),
  signedTransaction: Type.Optional(Type.String({ minLength: 1 }))
});

export const SwapTransactionsResponseSchema = Type.Object({
  data: Type.Object({
    router: MetaSwapRouterIdSchema,
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
export type MetaSwapRouterId = Static<typeof MetaSwapRouterIdSchema>;
export type MetaRouterId = MetaSwapRouterId;
export type MetaSwapQuote = Static<typeof MetaSwapQuoteSchema>;
export type MetaSwapScore = Static<typeof MetaSwapScoreSchema>;
export type MetaSwapAlternative = Static<typeof MetaSwapAlternativeSchema>;
export type SwapOptInRequest = Static<typeof SwapOptInRequestSchema>;
export type SwapTransactionsRequest = Static<typeof SwapTransactionsRequestSchema>;
export type SwapQuoteResponse = Static<typeof SwapQuoteResponseSchema>;
export type SwapOptInResponse = Static<typeof SwapOptInResponseSchema>;
export type SwapTransactionsResponse = Static<typeof SwapTransactionsResponseSchema>;

const FolksSwapTypeSchema = Type.Union([
  Type.Literal("fixed-input"),
  Type.Literal("fixed-output")
]);

export const FolksRouterDiscountTierSchema = Type.Object({
  minFolks: Type.Number({ minimum: 0 }),
  maxFolksExclusive: Type.Optional(Type.Number({ minimum: 0 })),
  discountPercent: Type.Integer({ minimum: 0, maximum: 50 })
});

export const FolksRouterDiscountSchema = Type.Object({
  sender: Type.Union([AlgorandAddressSchema, Type.Null()]), // pragma: allowlist secret
  userFeeDiscount: Type.Integer({ minimum: 0, maximum: 50 }),
  applied: Type.Boolean(),
  tiers: Type.Array(FolksRouterDiscountTierSchema, { minItems: 1 })
});

export const FolksSwapQuoteRequestSchema = Type.Object({
  address: Type.Optional(AlgorandAddressSchema), // pragma: allowlist secret
  fromAssetId: AssetIdSchema,
  toAssetId: AssetIdSchema,
  amount: BaseUnitSchema,
  type: Type.Optional(FolksSwapTypeSchema),
  maxGroupSize: Type.Optional(Type.Integer({ minimum: 3, maximum: 16 }))
});

export const FolksSwapQuoteSchema = Type.Object({
  source: Type.Literal("folks-router"),
  apiVersion: Type.Literal("v2"),
  routerAppId: Type.String({ pattern: "^[1-9][0-9]*$" }),
  address: Type.Optional(AlgorandAddressSchema), // pragma: allowlist secret
  fromAssetId: Type.String({ pattern: "^[0-9]+$" }),
  toAssetId: Type.String({ pattern: "^[0-9]+$" }),
  amount: Type.String({ pattern: "^[1-9][0-9]*$" }),
  type: FolksSwapTypeSchema,
  swapMode: Type.Union([Type.Literal("FIXED_INPUT"), Type.Literal("FIXED_OUTPUT")]),
  quotedAmount: Type.String({ pattern: "^[0-9]+$" }),
  createdAt: Type.String({ format: "date-time" }),
  expiresAt: Type.String({ format: "date-time" }),
  requiredAppOptIns: Type.Array(Type.String({ pattern: "^[1-9][0-9]*$" })),
  txnPayload: Type.String({ minLength: 1 }),
  priceImpact: Type.Number(),
  microalgoTxnsFee: Type.Integer({ minimum: 0 }),
  discount: FolksRouterDiscountSchema
});

export const FolksSwapQuoteResponseSchema = Type.Object({
  data: FolksSwapQuoteSchema,
  meta: Type.Object({
    paymentRequired: Type.Literal(false),
    executionSubmitted: Type.Literal(false)
  })
});

export const FolksSwapOptInRequestSchema = Type.Object({
  address: AlgorandAddressSchema, // pragma: allowlist secret
  quote: FolksSwapQuoteSchema
});

export const FolksSwapTransactionsRequestSchema = Type.Object({
  address: AlgorandAddressSchema, // pragma: allowlist secret
  quote: FolksSwapQuoteSchema,
  slippage: Type.Number({ minimum: 0, maximum: 100 })
});

export const FolksSwapGroupTransactionSchema = Type.Object({
  index: Type.Integer({ minimum: 0 }),
  encodedTransaction: Type.String({ minLength: 1 }),
  signer: Type.Literal("user")
});

export const FolksSwapTransactionsResponseSchema = Type.Object({
  data: Type.Object({
    source: Type.Literal("folks-router"),
    apiVersion: Type.Literal("v2"),
    routerAppId: Type.String({ pattern: "^[1-9][0-9]*$" }),
    routeKind: Type.Union([Type.Literal("direct"), Type.Literal("multi-hop")]),
    hopCount: Type.Integer({ minimum: 1 }),
    transactions: Type.Array(FolksSwapGroupTransactionSchema, { minItems: 1 }),
    userSignIndexes: Type.Array(Type.Integer({ minimum: 0 }), { minItems: 1 }),
    createdAt: Type.String({ format: "date-time" }),
    quoteExpiresAt: Type.String({ format: "date-time" })
  }),
  meta: Type.Object({
    paymentRequired: Type.Literal(true),
    executionSubmitted: Type.Literal(false)
  })
});

export type FolksSwapQuoteRequest = Static<typeof FolksSwapQuoteRequestSchema>;
export type FolksSwapQuote = Static<typeof FolksSwapQuoteSchema>;
export type FolksSwapQuoteResponse = Static<typeof FolksSwapQuoteResponseSchema>;
export type FolksSwapOptInRequest = Static<typeof FolksSwapOptInRequestSchema>;
export type FolksSwapTransactionsRequest = Static<typeof FolksSwapTransactionsRequestSchema>;
export type FolksSwapTransactionsResponse = Static<typeof FolksSwapTransactionsResponseSchema>;
export type FolksRouterDiscount = Static<typeof FolksRouterDiscountSchema>;
