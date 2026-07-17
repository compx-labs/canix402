# Normalized Opportunity Schema (V1)

This document defines the stable `OpportunityRecordV1` contract published by
`/opportunities*`, `/protocols/:protocol/opportunities`, and `/openapi.json`.

## Versioning

- Contract version: `1.1.0`
- Canonical schema sources:
  - `src/types/opportunity-schema.ts` (`OpportunityRecordSchema`)
  - `openapi/openapi.json` (`#/components/schemas/OpportunityRecord`)

## Field Glossary

### Required fields

- `protocol`: `tinyman | pact | folks-finance | compx | dorkfi`
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

### Optional fields

- `assetIds`: on-chain Algorand asset ids backing the opportunity
- `apr`: secondary APR metric when source provides it
- `notes`: caveats about timestamp provenance, fallback identifiers, or estimate basis

## Execution shapes on opportunities

Opportunities describe yield **opens**. Exit/manage shapes are not listed here;
agents discover those via `compatibleExitShapeKeys` / `compatibleManageShapeKeys`
on positions, or via `canix_list_execution_shapes`.

### Empty / research-only contract

When no enter shapes are wired for a protocol/type:

- `executionShapes` is always `[]`
- `executionReady` is always `false`

Agents must treat this as research-only and **must not invent** `shapeKey` values.

### `executionShapes[]` object fields

| Field | Meaning |
|---|---|
| `shapeKey` | Stable key for `POST /execution/quotes` |
| `protocol` / `protocolVersion` / `action` / `variant` | Shape identity |
| `title` / `summary` | Human-readable description |
| `order` | Step order for multi-step opens (alternatives share `0`) |
| `prerequisiteShapeKeys` | Optional explicit dependency graph (e.g. Folks setup → opt → deposit) |
| `requiredInputs` | Field names the agent must supply at quote time |
| `requiredAssetIds` | ASA ids the wallet must hold (or acquire via swap) before entry; ALGO is `0` |
| `inputHints` | Allowlisted selectors derived from the opportunity (never amounts) |

### `inputHints` allowlist

Only these keys may appear: `assetId`, `assetAId`, `assetBId`, `depositAssetId`,
`poolAppId`, `marketAppId`, `poolId`, `programId`, `liquidityAssetId`,
`escrowAddress`.

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

## Identifier Patterns

`opportunityId` is stable per protocol/type:

- Tinyman: `<poolAddress>:lp` or `<poolAddress>:farm`
- Pact: `<poolId>:lp` and `<farmId>:farm` (farm falls back to pool id when needed)
- Folks: `folks-lending-<poolAppId>`
- CompX: `compx-lending-<marketAppId>`, `compx-staking-<poolAppId>`
- Dork.fi: `dorkfi:algorand:<appIdOrFallback>:<assetIdOrSlug>:<opportunityType>`

Fallback identifiers are allowed when source fields are missing; such rows include
a caveat in `notes`.

## Explicitly Deferred (Not in V1)

The following fields are intentionally out of scope for `OpportunityRecordV1`:

- `rewards` metadata blocks
- generic `market` object
- `tvlOrLiquidity` union fields
- exit/manage shapes on opportunities (use positions / shape catalog)

Any addition of these fields is a future contract revision and should be reflected
in both TypeBox and OpenAPI schema surfaces.
