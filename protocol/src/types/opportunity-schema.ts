import { Static, Type } from "@sinclair/typebox";

import {
  OpportunityProtocolSchema,
  SupportedOpportunityTypeValues
} from "../routes/schemas.js";
import { OpportunityStabilityBucketSchema } from "./opportunity-history-schema.js";

export const YieldBasisSchema = Type.Union([
  Type.Literal("apy"),
  Type.Literal("apr")
]);

/** Settlement chain for a catalog row. Required on the public opportunity surface. */
export const OpportunityChainValues = ["algorand", "base"] as const;
export const OpportunityChainSchema = Type.Union(
  OpportunityChainValues.map((value) => Type.Literal(value))
);

export const OpportunityTypeSchema = Type.Union(
  SupportedOpportunityTypeValues.map((value) => Type.Literal(value))
);

/**
 * Allowlisted selector hints derived from an opportunity. Amounts never appear.
 */
export const OpportunityExecutionInputHintsSchema = Type.Object(
  {
    assetId: Type.Optional(Type.Integer({ minimum: 0 })),
    assetAId: Type.Optional(Type.Integer({ minimum: 0 })),
    assetBId: Type.Optional(Type.Integer({ minimum: 0 })),
    depositAssetId: Type.Optional(Type.Integer({ minimum: 0 })),
    poolAppId: Type.Optional(Type.Integer({ minimum: 1 })),
    marketAppId: Type.Optional(Type.Integer({ minimum: 1 })),
    poolId: Type.Optional(Type.String({ minLength: 1 })),
    programId: Type.Optional(Type.Integer({ minimum: 1 })),
    liquidityAssetId: Type.Optional(Type.Integer({ minimum: 0 })),
    escrowAddress: Type.Optional(Type.String({ minLength: 58, maxLength: 58 })),
    farmAppId: Type.Optional(Type.Integer({ minimum: 1 })),
    escrowAppId: Type.Optional(Type.Integer({ minimum: 1 })),
    validatorId: Type.Optional(Type.Integer({ minimum: 1 })),
    /** Folks Finance loan application id (distinct from pool app id). */
    loanAppId: Type.Optional(Type.Integer({ minimum: 1 })),
    /** STAMM fee-tier index (0–5) when the LP ASA is a STAMM tier token. */
    tierIndex: Type.Optional(Type.Integer({ minimum: 0 })),
    /** Underlying ERC-20 address for EVM venues. Never an Algorand asset id. */
    assetAddress: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

/** Minimum deposit / stake amount in base units (decimal string). */
export const OpportunityAmountRequirementSchema = Type.Object(
  {
    assetId: Type.Integer({ minimum: 0 }),
    amount: Type.String({ minLength: 1, pattern: "^[0-9]+$" })
  },
  { additionalProperties: false }
);

/**
 * Machine-readable entry gates. Réti uses OR across ASA gates (`gateMatch: "any"`).
 * NFD / creator gates are published even when personalized matching cannot resolve them.
 */
export const OpportunityEntryGateSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("asa"),
      assetId: Type.Integer({ minimum: 0 }),
      minBalance: Type.Optional(Type.String({ minLength: 1, pattern: "^[0-9]+$" }))
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      kind: Type.Literal("asa-creator"),
      creator: Type.String({ minLength: 58, maxLength: 58 }),
      minBalance: Type.Optional(Type.String({ minLength: 1, pattern: "^[0-9]+$" }))
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      kind: Type.Literal("nfd-linked-creators"),
      nfd: Type.String({ minLength: 1 })
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      kind: Type.Literal("nfd-root-segment"),
      nfdRoot: Type.String({ minLength: 1 })
    },
    { additionalProperties: false }
  )
]);

export const OpportunityEntryRequirementsSchema = Type.Object(
  {
    minAmount: Type.Optional(OpportunityAmountRequirementSchema),
    gates: Type.Optional(Type.Array(OpportunityEntryGateSchema)),
    gateMatch: Type.Optional(
      Type.Union([Type.Literal("any"), Type.Literal("all")])
    ),
    /**
     * False when gates include kinds personalized matching cannot resolve
     * (NFD / creator). Agents must not treat the wallet as confirmed-eligible.
     */
    eligibilityFullyCheckable: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
);

export const OpportunityCapacitySchema = Type.Object(
  {
    stakerSlotsRemaining: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    algoRoomMicroAlgos: Type.Union([
      Type.String({ minLength: 1, pattern: "^[0-9]+$" }),
      Type.Null()
    ]),
    acceptingStake: Type.Boolean()
  },
  { additionalProperties: false }
);

/**
 * Snapshot freshness derived from `fetchedAt` (and cache age when known).
 * Unknown when timestamps cannot be parsed. Adapters must not invent this.
 */
export const OpportunityRiskConfidenceSchema = Type.Union([
  Type.Literal("high"),
  Type.Literal("medium"),
  Type.Literal("low"),
  Type.Literal("unknown")
]);

/**
 * LP / farm volatility bucket. `unknown` when the adapter has no designed
 * signal (do not invent IL percentages).
 */
export const OpportunityVolatilityBucketSchema = Type.Union([
  Type.Literal("stable"),
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
  Type.Literal("unknown")
]);

/**
 * Designed risk block for opportunity schema V2. Optional numeric fields are
 * omitted when the adapter does not know them — never guessed.
 */
export const OpportunityRiskSchema = Type.Object(
  {
    /** Lending utilization in percentage points (0–100+). */
    utilization: Type.Optional(Type.Number({ minimum: 0 })),
    /** Liquidation threshold in percentage points (0–100). */
    liquidationThreshold: Type.Optional(Type.Number({ minimum: 0 })),
    /** Loan-to-value in percentage points (0–100). */
    ltv: Type.Optional(Type.Number({ minimum: 0 })),
    /**
     * Borrow-side APR cost when the venue supports borrowing. Mirrors
     * top-level `borrowApr` when present so the risk block is self-contained.
     */
    borrowApr: Type.Optional(Type.Number()),
    /**
     * Wallet health factor for this lending venue when `address` is in
     * context. Omitted on anonymous catalog rows. Null when positions were
     * loaded but this venue has no HF snapshot.
     */
    healthFactor: Type.Optional(Type.Union([Type.Number({ minimum: 0 }), Type.Null()])),
    /** LP IL / volatility bucket. Omit or `unknown` when there is no signal. */
    volatilityBucket: Type.Optional(OpportunityVolatilityBucketSchema),
    /** Human-readable IL hint when a designed signal exists (never a guessed %). */
    ilHint: Type.Optional(Type.String({ minLength: 1 })),
    /** Farm/staking remaining rewards in base units (decimal string). */
    rewardRunwayRemaining: Type.Optional(
      Type.String({ minLength: 1, pattern: "^[0-9]+$" })
    ),
    /** Confidence from snapshot freshness / cache age. */
    confidence: OpportunityRiskConfidenceSchema,
    /** Seconds between `sourceTimestamp` and evaluation time. */
    sourceAgeSeconds: Type.Optional(Type.Integer({ minimum: 0 })),
    /**
     * APY stability from the bounded history series (stdev / sample count).
     * `unknown` when fewer than 3 snapshots exist. Omitted until history is attached.
     */
    stability: Type.Optional(OpportunityStabilityBucketSchema),
    /** Sample standard deviation of APY over the retained window. */
    apyStdev: Type.Optional(Type.Number({ minimum: 0 })),
    /** Number of history snapshots used for `stability` / `apyStdev`. */
    historySampleCount: Type.Optional(Type.Integer({ minimum: 0 }))
  },
  { additionalProperties: false }
);

/** Adapter-supplied risk fields; `confidence` is filled at the response boundary. */
export const OpportunityAdapterRiskSchema = Type.Partial(OpportunityRiskSchema);

export const OpportunityExecutionShapeSchema = Type.Object({
  shapeKey: Type.String({ minLength: 1 }),
  protocol: Type.String({ minLength: 1 }),
  protocolVersion: Type.String({ minLength: 1 }),
  action: Type.String({ minLength: 1 }),
  variant: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1 }),
  summary: Type.String({ minLength: 1 }),
  order: Type.Integer({ minimum: 0 }),
  prerequisiteShapeKeys: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  requiredInputs: Type.Array(Type.String({ minLength: 1 })),
  requiredAssetIds: Type.Array(Type.Integer({ minimum: 0 })),
  inputHints: Type.Optional(OpportunityExecutionInputHintsSchema)
});

/** Market-data fields produced by protocol adapters (before execution enrichment). */
export const OpportunityMarketRecordSchema = Type.Object({
  protocol: OpportunityProtocolSchema,
  opportunityType: OpportunityTypeSchema,
  opportunityId: Type.String(),
  assetPair: Type.String(),
  /** Settlement chain. Adapters may omit; the public enricher defaults to algorand. */
  chain: Type.Optional(OpportunityChainSchema),
  assetIds: Type.Optional(Type.Array(Type.Integer({ minimum: 0 }))),
  /** ERC-20 addresses for EVM venues. Do not put 0x values in assetIds. */
  assetAddresses: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  /**
   * Underlying AMM / lending pool application id when distinct from the
   * opportunity id (e.g. Pact farm app vs Pact pool app). Used to build
   * execution inputHints; omitted from the public OpportunityRecord surface.
   */
  poolAppId: Type.Optional(Type.Integer({ minimum: 1 })),
  /**
   * LP ASA id when distinct from `assetIds` underlyings (STAMM tier token).
   * Adapter-only; omitted from the public OpportunityRecord surface.
   */
  liquidityAssetId: Type.Optional(Type.Integer({ minimum: 0 })),
  /**
   * String pool / vault selector when distinct from integer poolAppId
   * (e.g. Morpho vault address). Adapter-only; omitted from the public surface.
   */
  poolId: Type.Optional(Type.String({ minLength: 1 })),
  apy: Type.Number(),
  yieldBasis: YieldBasisSchema,
  tvlUsd: Type.Number(),
  apr: Type.Optional(Type.Number()),
  /** Borrow-side APR cost when the venue supports borrowing against this market. */
  borrowApr: Type.Optional(Type.Number()),
  sourceTimestamp: Type.String({ format: "date-time" }),
  fetchedAt: Type.String({ format: "date-time" }),
  notes: Type.Optional(Type.String()),
  entryRequirements: Type.Optional(OpportunityEntryRequirementsSchema),
  capacity: Type.Optional(OpportunityCapacitySchema),
  /** Adapter-known risk fields. Confidence is finalized at the public boundary. */
  risk: Type.Optional(OpportunityAdapterRiskSchema)
});

export const OpportunityRecordSchema = Type.Object({
  protocol: OpportunityProtocolSchema,
  opportunityType: OpportunityTypeSchema,
  opportunityId: Type.String(),
  assetPair: Type.String(),
  chain: OpportunityChainSchema,
  assetIds: Type.Optional(Type.Array(Type.Integer({ minimum: 0 }))),
  /** ERC-20 addresses for EVM venues. Omitted on Algorand rows. */
  assetAddresses: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  apy: Type.Number(),
  yieldBasis: YieldBasisSchema,
  tvlUsd: Type.Number(),
  apr: Type.Optional(Type.Number()),
  /** Borrow-side APR cost when the venue supports borrowing against this market. */
  borrowApr: Type.Optional(Type.Number()),
  sourceTimestamp: Type.String({ format: "date-time" }),
  fetchedAt: Type.String({ format: "date-time" }),
  notes: Type.Optional(Type.String()),
  entryRequirements: Type.Optional(OpportunityEntryRequirementsSchema),
  capacity: Type.Optional(OpportunityCapacitySchema),
  /**
   * Designed risk block (schema V2). Always present on public rows; optional
   * numeric fields are omitted when unknown rather than invented.
   */
  risk: OpportunityRiskSchema,
  executionReady: Type.Boolean(),
  executionShapes: Type.Array(OpportunityExecutionShapeSchema),
  compatibleExitShapes: Type.Array(OpportunityExecutionShapeSchema)
});

export const OpportunitiesListMetaSchema = Type.Object({
  limit: Type.Integer(),
  offset: Type.Integer(),
  includeInactive: Type.Boolean(),
  paymentRequired: Type.Boolean(),
  cacheEnabled: Type.Boolean(),
  cacheHit: Type.Boolean(),
  cachedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  cacheAgeMs: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  cacheTtlSec: Type.Integer({ minimum: 0 })
});

export const OpportunitiesListResponseSchema = Type.Object({
  data: Type.Array(OpportunityRecordSchema),
  meta: Type.Optional(OpportunitiesListMetaSchema)
});

export const PersonalizedOpportunitiesListMetaSchema = Type.Composite([
  OpportunitiesListMetaSchema,
  Type.Object({
    address: Type.String(),
    heldAssetCount: Type.Integer(),
    eligibilityApplied: Type.Literal(true),
    eligibilityEndpoint: Type.Literal("/eligibility")
  })
]);

export const PersonalizedOpportunityRecordSchema = Type.Object({
  ...OpportunityRecordSchema.properties,
  canEnter: Type.Boolean(),
  eligibilityFullyCheckable: Type.Boolean()
});

export const PersonalizedOpportunitiesListResponseSchema = Type.Object({
  data: Type.Array(PersonalizedOpportunityRecordSchema),
  meta: Type.Optional(PersonalizedOpportunitiesListMetaSchema)
});

export type OpportunityChain = Static<typeof OpportunityChainSchema>;
export type OpportunityMarketRecord = Static<typeof OpportunityMarketRecordSchema>;
export type OpportunityExecutionInputHints = Static<
  typeof OpportunityExecutionInputHintsSchema
>;
export type OpportunityExecutionShape = Static<typeof OpportunityExecutionShapeSchema>;
export type OpportunityRecordV1 = Static<typeof OpportunityRecordSchema>;
export type YieldBasis = Static<typeof YieldBasisSchema>;
export type OpportunityAmountRequirement = Static<
  typeof OpportunityAmountRequirementSchema
>;
export type OpportunityEntryGate = Static<typeof OpportunityEntryGateSchema>;
export type OpportunityEntryRequirements = Static<
  typeof OpportunityEntryRequirementsSchema
>;
export type OpportunityCapacity = Static<typeof OpportunityCapacitySchema>;
export type OpportunityRiskConfidence = Static<typeof OpportunityRiskConfidenceSchema>;
export type OpportunityVolatilityBucket = Static<
  typeof OpportunityVolatilityBucketSchema
>;
export type OpportunityRisk = Static<typeof OpportunityRiskSchema>;
export type OpportunityAdapterRisk = Static<typeof OpportunityAdapterRiskSchema>;
export type PersonalizedOpportunityRecord = Static<
  typeof PersonalizedOpportunityRecordSchema
>;
