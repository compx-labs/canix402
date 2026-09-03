# Normalized Opportunity Schema (V1.4 / risk V2)

This document defines the stable `OpportunityRecordV1` contract published by
`/opportunities*`, `/protocols/:protocol/opportunities`, and `/openapi.json`.

## Versioning

- Contract version: `1.4.0` (adds required `risk` block; previously `1.3.0`)
- Canonical schema sources:
  - `src/types/opportunity-schema.ts` (`OpportunityRecordSchema`, `OpportunityRiskSchema`)
  - `openapi/openapi.json` (`#/components/schemas/OpportunityRecord`, `#/components/schemas/OpportunityRisk`)

## Field Glossary

### Required fields

- `protocol`: `tinyman | pact | folks-finance | compx | dorkfi | myth-finance | haystack | reti | alpha-arcade`
- `opportunityType`: `lp | farm | staking | lending`
- `opportunityId`: stable protocol-local identifier
- `assetPair`: market label (pair or single-asset label)
- `apy`: primary yield number exposed for ranking and filtering
- `yieldBasis`: `apy | apr` describing what the `apy` value represents
- `tvlUsd`: liquidity/TVL in USD
- `sourceTimestamp`: upstream/on-chain row update time when available, otherwise fetch time
- `fetchedAt`: service ingestion timestamp
- `executionReady`: `true` when at least one enter execution shape is attached
- `executionShapes`: enter-only shapes for opening this yield opportunity (may be empty)
- `compatibleExitShapes`: exit shapes for closing this opportunity when known (may be empty)
- `risk`: designed risk block (schema V2). `confidence` is always present; other fields are omitted when unknown.

### Optional fields

- `assetIds`: on-chain Algorand asset ids backing the opportunity
- `apr`: secondary APR metric when source provides it
- `notes`: caveats about timestamp provenance, fallback identifiers, or estimate basis
- `entryRequirements`: machine-readable minimum stake / token gates (discovery metadata; quote-time recheck is authoritative)
- `capacity`: remaining staker slots / ALGO room and whether the venue is accepting stake
- `risk.utilization` / `risk.liquidationThreshold` / `risk.ltv` / `risk.borrowApr`: lending metrics when the adapter knows them
- `risk.volatilityBucket` / `risk.ilHint`: LP IL signal when a designed source exists (Tinyman `is_stable`); otherwise omitted or `unknown`
- `risk.rewardRunwayRemaining`: farm/staking remaining rewards in base units when known (CompX `rewardsRemaining`)
- `risk.healthFactor`: wallet health factor for lending venues when `address` is in context (personalized, plans, eligibility) and positions already expose it
- `risk.sourceAgeSeconds`: seconds between `sourceTimestamp` and evaluation time
- `risk.stability` / `risk.apyStdev` / `risk.historySampleCount`: APY stability from the bounded `GET /opportunities/:id/history` series. Omitted until history is attached. `unknown` when fewer than 3 snapshots exist.

## Risk object (`risk`)

Machine-readable risk so `/plans`, personalized ranking, and `analyze-opportunity`
prefer constraints over raw `apy`. This is the deferred V1 `rewards` / `market`
work, designed rather than dumped as protocol JSON. Canix stays walletless: data
only; it does not sign or submit.

| Field | Meaning |
|---|---|
| `confidence` | Snapshot freshness from `fetchedAt` (or cache age when known). `high` ≤ 3 minutes (default opportunities cache TTL), `medium` ≤ 1 hour, otherwise `low`. `unknown` when timestamps cannot be parsed. |
| `sourceAgeSeconds` | Seconds between `sourceTimestamp` and evaluation time |
| `utilization` | Lending utilization in percentage points when the adapter knows it (CompX `utilizationRate`; Folks borrows / deposits) |
| `liquidationThreshold` | Liquidation threshold in percentage points (CompX `liquidationThreshold` bps / 100) |
| `ltv` | Loan-to-value in percentage points (CompX `ltv` bps / 100) |
| `borrowApr` | Borrow-side APR cost; mirrors top-level `borrowApr` when present |
| `healthFactor` | Wallet HF for this lending venue when `address` is in context. Taken from existing `/positions` snapshots (matched by `opportunityId`, else protocol-level for lending). Omitted on anonymous catalog rows. Never invented. |
| `volatilityBucket` | LP IL / volatility bucket. Tinyman `is_stable === true` → `stable`. Otherwise `unknown` or omitted — adapters do not invent IL percentages. |
| `ilHint` | Human-readable IL hint when a designed signal exists |
| `rewardRunwayRemaining` | Remaining farm/staking rewards in base units (decimal string), e.g. CompX `rewardsRemaining` |
| `stability` | APY stability bucket from the rolling ~30d snapshot series (`high` / `medium` / `low` / `unknown`). Derived from APY sample stdev vs mean. `unknown` when sample count < 3. Omitted until history is attached. |
| `apyStdev` | Sample standard deviation of APY over the retained window. Omitted when sample count < 2. |
| `historySampleCount` | Number of hourly snapshots used for `stability` / `apyStdev`. |

Ranking applies a designed penalty (confidence, utilization ≥ 80/95%, volatility
bucket `medium`/`high`, wallet HF below 2.0/1.5/1.0 when present, zero reward
runway, **APY stability** — volatile series and missing history are penalized
before raw APY) **before** raw APY, then TVL. Equal-risk rows still sort by APY
descending. `/plans` uses the same comparator for enterable allocations and
attaches `snapshot-apy-unstable` on steps when `risk.stability` is `low`.

## Historical series (`GET /opportunities/:id/history`)

Paid research SKU (~0.01 USDC). Bounded APY/TVL points for `window=1d|7d|30d`
(default 30d). Snapshots are hourly Redis buckets with ~30 day TTL — not a
warehouse, and not backfilled from explorers. Empty `points` until the snapshot
job has run. Response `stability` is the same signal attached on `risk` / plans.

## Entry requirements and capacity

Réti is the first protocol that publishes structured eligibility. Other protocols
may omit these fields.

### `entryRequirements`

| Field | Meaning |
|---|---|
| `minAmount` | `{ assetId, amount }` minimum deposit in base units (`amount` is a decimal string) |
| `gates` | Token / NFD gates (`asa`, `asa-creator`, `nfd-linked-creators`, `nfd-root-segment`) |
| `gateMatch` | How multiple ASA gates combine (`any` \| `all`). Réti uses `any`. |
| `eligibilityFullyCheckable` | `false` when gates include NFD/creator kinds personalized matching cannot resolve |

Amounts never appear in `inputHints`. Agents should filter on discovery, call
`POST /eligibility` before quote, then treat quote-time on-chain validation as
the hard gate.

### `capacity`

| Field | Meaning |
|---|---|
| `stakerSlotsRemaining` | Remaining ledger seats across pools, or `null` if unknown |
| `algoRoomMicroAlgos` | Remaining ALGO headroom (microAlgos decimal string), or `null` |
| `acceptingStake` | Whether new stake can currently be accepted |

## Execution shapes on opportunities

Opportunities primarily describe yield **opens** via `executionShapes`.

Liquid-staking opportunities may also list known exits on `compatibleExitShapes`
(e.g. Folks xALGO unstake, Tinyman tALGO burn). For other protocols, or when
`compatibleExitShapes` is empty, agents discover exits via
`compatibleExitShapeKeys` / `compatibleManageShapeKeys` on positions, or via
`canix_list_execution_shapes` (backed by free `GET /execution/shapes`). Manage shapes are not attached on opportunities.

### Empty / research-only contract

When no enter shapes are wired for a protocol/type:

- `executionShapes` is always `[]`
- `executionReady` is always `false`
- `compatibleExitShapes` may still be empty (independent of enter readiness)

Agents must treat research-only rows as research-only and **must not invent**
`shapeKey` values.

### `executionShapes[]` / `compatibleExitShapes[]` object fields

| Field | Meaning |
|---|---|
| `shapeKey` | Stable key for `POST /execution/quotes` |
| `protocol` / `protocolVersion` / `action` / `variant` | Shape identity |
| `title` / `summary` | Human-readable description |
| `order` | Step order for multi-step opens (alternatives share `0`) |
| `prerequisiteShapeKeys` | Optional explicit dependency graph (e.g. Folks setup → opt → deposit) |
| `requiredInputs` | Field names the agent must supply at quote time |
| `requiredAssetIds` | ASA ids the wallet must hold (or acquire via swap); ALGO is `0`. Enter shapes use the deposit asset; exit shapes use the receipt token when applicable |
| `inputHints` | Allowlisted selectors derived from the opportunity (never amounts) |

### `inputHints` allowlist

Only these keys may appear: `assetId`, `assetAId`, `assetBId`, `depositAssetId`,
`poolAppId`, `marketAppId`, `poolId`, `programId`, `liquidityAssetId`,
`escrowAddress`, `farmAppId`, `escrowAppId`, `validatorId`.

For Pact farms, `farmAppId` is the farm application and `poolAppId` is the
underlying AMM pool (from farm→pool join metadata). Do not treat the farm id as
`poolAppId`.

### Amount convention

Any `requiredInputs` entry matching `/Amount$/` or exactly `amount` /
`commitAmount` is agent-supplied at quote time. Amounts are never copied into
`inputHints`.

### Multi-step example (Folks lending)

| order | shape | prerequisites |
|---|---|---|
| 0 | `mainnet:folks-finance:v2:setup:depositEscrow` | — |
| 1 | `mainnet:folks-finance:v2:setup:optEscrowAsset` | setup deposit escrow |
| 2 | `mainnet:folks-finance:v2:deposit:escrow` | setup opt escrow asset |

Tinyman LP lists three **alternative** add-liquidity shapes, all at `order: 0`
with no prerequisites.

### Liquid-staking enter + exit example

| Field | Folks xALGO | Tinyman tALGO |
|---|---|---|
| Enter (`executionShapes`) | `...:stake:immediate` | `...:mint:tAlgo` |
| Exit (`compatibleExitShapes`) | `...:unstake:immediate` | `...:burn:tAlgo` |

Enter hints/required assets use ALGO (`0`); exit hints/required assets use the
receipt ASA (xALGO / tALGO).

## `yieldBasis` Semantics

`yieldBasis` describes how to interpret the `apy` number on each row:

- `apy`: `apy` is a compound APY-style value from the source.
- `apr`: `apy` carries an APR-derived/simple APR value for contract consistency.

Per-protocol policy:

| Protocol/type | `yieldBasis` | Notes |
|---|---|---|
| Tinyman `lp`, `farm` | `apy` | Upstream APY fields mapped directly |
| Pact `lp`, `farm` | `apr` | 7-day APR metrics normalized into `apy` |
| Folks Finance `lending` | `apy` | Deposit interest yield |
| CompX `lending` | `apr` | `supplyApy` is APR-derived |
| CompX `staking` | `apr` | `getPoolApr()` estimate |
| Dork.fi all supported types | `apy` | Source field is `apy` |
| Myth Finance dualSTAKE | `apr` | Consensus APR net of fees (+ farm APR when present) |
| Réti staking | `apr` | Consensus APR net of validator commission |
| Alpha Arcade staking | `apr` | Trailing ~7d USDC fee inflows annualized vs ALPHA TVL |

## Identifier Patterns

`opportunityId` is stable per protocol/type:

- Tinyman: `<poolAddress>:lp` or `<poolAddress>:farm`
- Pact: `<poolId>:lp` and `<farmId>:farm` (farm falls back to pool id when needed)
- Folks: `folks-lending-<poolAppId>`
- CompX: `compx-lending-<marketAppId>`, `compx-staking-<poolAppId>`
- Dork.fi: `dorkfi:algorand:<poolAppIdOrFallback>:<assetIdOrSlug>:<opportunityType>`
  (pool app id, not market app id; markets share a pool and are distinguished by asset id)
- Myth: `myth-staking-<appId>`, `myth-farm-<appId>`
- Réti: `reti-staking-<validatorId>` (one row per validator; pools allocate under that validator)
- Alpha Arcade: `alpha-arcade-staking-alpha`

Fallback identifiers are allowed when source fields are missing; such rows include
a caveat in `notes`.

## Explicitly Deferred (Not in V1)

The following fields are intentionally out of scope for `OpportunityRecordV1`:

- generic `rewards` metadata blocks beyond `risk.rewardRunwayRemaining`
- generic `market` object (lending/LP fields live on `risk` instead)
- `tvlOrLiquidity` union fields
- manage shapes on opportunities (use positions / shape catalog)
- exit shapes on non–liquid-staking opportunities (use positions / shape catalog)
- full NFD resolution for personalized eligibility (publish unresolved gates on
  `POST /eligibility`; `canEnter` stays false until `eligibilityFullyCheckable`)
- invented IL percentages or health factors when the adapter/positions snapshot
  does not expose them

Any addition of these fields is a future contract revision and should be reflected
in both TypeBox and OpenAPI schema surfaces.

Operator risk caps that used to live only in Brownie (protocol weight, ALGO reserve,
TVL/freshness floors, no-new-borrows, execution-ready) are now a shared
policy-as-a-service contract: see `docs/policy-schema.md` and `POST /policy/validate`.
