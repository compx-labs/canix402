# Normalized Opportunity Schema (V1)

This document defines the stable `OpportunityRecordV1` contract published by
`/opportunities*`, `/protocols/:protocol/opportunities`, and `/openapi.json`.

## Versioning

- Contract version: `1.0.0`
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

### Optional fields

- `assetIds`: on-chain Algorand asset ids backing the opportunity
- `apr`: secondary APR metric when source provides it
- `notes`: caveats about timestamp provenance, fallback identifiers, or estimate basis

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

Any addition of these fields is a future contract revision and should be reflected
in both TypeBox and OpenAPI schema surfaces.
