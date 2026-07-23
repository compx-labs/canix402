# Normalized Opportunity Schema (V1)

This document defines the stable `OpportunityRecordV1` contract published by
`/opportunities*`, `/protocols/:protocol/opportunities`, and `/openapi.json`.

## Versioning

- Contract version: `1.3.0`
- Canonical schema sources:
  - `src/types/opportunity-schema.ts` (`OpportunityRecordSchema`)
  - `openapi/openapi.json` (`#/components/schemas/OpportunityRecord`)

## Field Glossary

### Required fields

- `protocol`: `tinyman | pact | folks-finance | compx | dorkfi | myth-finance | haystack | reti`
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

### Optional fields

- `assetIds`: on-chain Algorand asset ids backing the opportunity
- `apr`: secondary APR metric when source provides it
- `notes`: caveats about timestamp provenance, fallback identifiers, or estimate basis
- `entryRequirements`: machine-readable minimum stake / token gates (discovery metadata; quote-time recheck is authoritative)
- `capacity`: remaining staker slots / ALGO room and whether the venue is accepting stake

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

Amounts never appear in `inputHints`. Agents should filter on discovery, then treat
quote-time on-chain validation as the hard gate.

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

Fallback identifiers are allowed when source fields are missing; such rows include
a caveat in `notes`.

## Explicitly Deferred (Not in V1)

The following fields are intentionally out of scope for `OpportunityRecordV1`:

- `rewards` metadata blocks
- generic `market` object
- `tvlOrLiquidity` union fields
- manage shapes on opportunities (use positions / shape catalog)
- exit shapes on non–liquid-staking opportunities (use positions / shape catalog)
- full NFD resolution for personalized eligibility (publish gates; resolve later)

Any addition of these fields is a future contract revision and should be reflected
in both TypeBox and OpenAPI schema surfaces.
