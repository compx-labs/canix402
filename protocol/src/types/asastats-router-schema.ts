import { Static, Type } from "@sinclair/typebox";

const BaseUnitSchema = Type.String({ pattern: "^[0-9]+$" });
const AssetIdSchema = Type.String({ pattern: "^[0-9]+$" });
const WalletAddressSchema = Type.String({ minLength: 58, maxLength: 58 }); // pragma: allowlist secret

export const AsaStatsSwapModeSchema = Type.Union([
  Type.Literal("sell"),
  Type.Literal("buy")
]);

export const AsaStatsSwapTypeSchema = Type.Union([
  Type.Literal("fixed-input"),
  Type.Literal("fixed-output")
]);

/**
 * Opaque engine quote. Sent back to `router:group` so the engine re-derives
 * allocation against current reserves instead of replaying a stale split.
 */
export const AsaStatsEngineQuoteSchema = Type.Record(Type.String(), Type.Unknown());

export const AsaStatsQuoteRequestSchema = Type.Object({
  address: WalletAddressSchema,
  fromAssetId: Type.Union([
    Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    AssetIdSchema
  ]),
  toAssetId: Type.Union([
    Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    AssetIdSchema
  ]),
  amount: Type.Union([
    Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    Type.String({ pattern: "^[1-9][0-9]*$" })
  ]),
  type: Type.Optional(AsaStatsSwapTypeSchema),
  slippagePct: Type.Optional(Type.Number({ minimum: 0, maximum: 100 }))
});

export const AsaStatsQuoteSchema = Type.Object({
  router: Type.Literal("asastats"),
  address: WalletAddressSchema,
  fromAssetId: AssetIdSchema,
  toAssetId: AssetIdSchema,
  amount: Type.String({ pattern: "^[1-9][0-9]*$" }),
  type: AsaStatsSwapTypeSchema,
  mode: AsaStatsSwapModeSchema,
  amountIn: BaseUnitSchema,
  amountOut: BaseUnitSchema,
  minimumReceived: Type.Optional(BaseUnitSchema),
  maximumSent: Type.Optional(BaseUnitSchema),
  quotedAmount: BaseUnitSchema,
  priceImpactPct: Type.Union([Type.Number(), Type.Null()]),
  routeLabel: Type.String(),
  routeVenues: Type.Array(Type.String()),
  /** Network µALGO (`fees_total`). Not the 5 bps platform fee. */
  networkFeeMicroAlgos: BaseUnitSchema,
  /** List price. Holder discounts are applied by ASA Stats, not requested. */
  platformFeeBps: Type.Literal(5),
  /** `amount_out` is already net of the ALGO-skimmed platform fee. */
  platformFeeAlreadyNetted: Type.Literal(true),
  slippagePct: Type.Number({ minimum: 0, maximum: 100 }),
  valueUsdc: Type.Optional(Type.Number()),
  appId: Type.String({ pattern: "^[1-9][0-9]*$" }),
  createdAt: Type.String({ format: "date-time" }),
  expiresAt: Type.String({ format: "date-time" }),
  raw: AsaStatsEngineQuoteSchema
});

export const AsaStatsGroupTransactionSchema = Type.Object({
  index: Type.Integer({ minimum: 0 }),
  encodedTransaction: Type.String({ minLength: 1 }),
  signer: Type.Union([Type.Literal("user"), Type.Literal("protocol")]),
  signedTransaction: Type.Optional(Type.String({ minLength: 1 }))
});

export const AsaStatsGroupSchema = Type.Object({
  router: Type.Literal("asastats"),
  transactions: Type.Array(AsaStatsGroupTransactionSchema, { minItems: 1 }),
  userSignIndexes: Type.Array(Type.Integer({ minimum: 0 })),
  quoteSignerIndex: Type.Optional(Type.Integer({ minimum: 0 })),
  createdAt: Type.String({ format: "date-time" }),
  quoteExpiresAt: Type.String({ format: "date-time" }),
  quote: AsaStatsQuoteSchema
});

export const AsaStatsSwapMetaSchema = Type.Object({
  paymentRequired: Type.Literal(false),
  executionSubmitted: Type.Literal(false)
});

export const AsaStatsQuoteResponseSchema = Type.Object({
  data: AsaStatsQuoteSchema,
  meta: AsaStatsSwapMetaSchema
});

export const AsaStatsGroupResponseSchema = Type.Object({
  data: AsaStatsGroupSchema,
  meta: AsaStatsSwapMetaSchema
});

export const AsaStatsRouterScoreSchema = Type.Object({
  router: Type.Literal("asastats"),
  mode: AsaStatsSwapModeSchema,
  amountInBaseUnits: BaseUnitSchema,
  /** Already net of the 5 bps (or discounted) platform fee. */
  expectedNetOutBaseUnits: BaseUnitSchema,
  minOutBaseUnits: Type.Union([BaseUnitSchema, Type.Null()]),
  maxInBaseUnits: Type.Union([BaseUnitSchema, Type.Null()]),
  networkFeeMicroAlgos: BaseUnitSchema,
  platformFeeBps: Type.Literal(5),
  platformFeeAlreadyNetted: Type.Literal(true),
  /** Scoring must not haircut `expectedNetOutBaseUnits` by platformFeeBps. */
  subtractPlatformFee: Type.Literal(false)
});

export type AsaStatsQuoteRequest = Static<typeof AsaStatsQuoteRequestSchema>;
export type AsaStatsQuote = Static<typeof AsaStatsQuoteSchema>;
export type AsaStatsGroupTransaction = Static<typeof AsaStatsGroupTransactionSchema>;
export type AsaStatsGroup = Static<typeof AsaStatsGroupSchema>;
export type AsaStatsQuoteResponse = Static<typeof AsaStatsQuoteResponseSchema>;
export type AsaStatsGroupResponse = Static<typeof AsaStatsGroupResponseSchema>;
export type AsaStatsRouterScore = Static<typeof AsaStatsRouterScoreSchema>;
