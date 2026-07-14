# Tinyman Data Source

This document defines the current Tinyman adapter contract used by canix402.

## Source Strategy

- Mode: API-first
- Adapter file: `src/adapters/tinyman.ts`
- Base URL: `TINYMAN_API_BASE_URL`
- Endpoint used: `GET /pools/`
- Default query profile matches Tinyman app pool listing behavior:
  - `with_statistics=true`
  - `version__in=2.0` (override with `TINYMAN_POOL_VERSIONS`)
  - `limit=100` (override with `TINYMAN_POOL_LIMIT`)
  - verified-only filtering in adapter (`TINYMAN_ONLY_VERIFIED=true` by default)

## Environment Variables

- `TINYMAN_API_BASE_URL` (required in production)
- `TINYMAN_API_KEY` (optional; sent as bearer token when provided)
- `TINYMAN_POOL_VERSIONS` (optional CSV, default `2.0`)
- `TINYMAN_ONLY_VERIFIED` (optional boolean, default `true`)
- `TINYMAN_POOL_LIMIT` (optional integer-like string, default `100`)

## Normalized Output Fields

Each Tinyman row is normalized into `OpportunityRecordV1` with required user
fields:

- `apy`
- `tvlUsd`

Other emitted fields:

- `protocol`
- `opportunityType`
- `opportunityId`
- `assetPair`
- `yieldBasis` (`apy` for both LP and farm outputs)
- `apr` (optional when upstream provides it)
- `sourceTimestamp`
- `fetchedAt`
- `notes` (only when fallback identifiers are used)

When farm incentives are present, one upstream pool can emit **two** normalized
opportunities:

- `lp` for the base pool position
- `farm` for staking/farming incentives on that same pair

## Field Mapping

| Tinyman field | Normalized field | Notes |
|---|---|---|
| `address` | `opportunityId` | Suffixes `:lp` or `:farm` for uniqueness |
| `asset_1.unit_name` + `asset_2.unit_name` | `assetPair` | Falls back to `unknown/unknown` if missing |
| `annual_percentage_yield` | `apy` (`lp`) | Decimal fraction -> percentage points; required for LP output |
| (adapter policy) | `yieldBasis` | Always `apy` |
| `staking_total_annual_percentage_yield` | `apy` (`farm`) | Decimal fraction -> percentage points; farm output emitted when > 0 |
| `liquidity_in_usd` | `tvlUsd` | Required; record dropped when invalid |
| `annual_percentage_rate` | `apr` (`lp`) | Decimal fraction -> percentage points; optional |
| `staking_total_annual_percentage_rate` | `apr` (`farm`) | Decimal fraction -> percentage points; optional |
| fetch timestamp | `sourceTimestamp` | Source currently does not expose per-row update timestamp |
| incentive presence (`staking_total_annual_percentage_*`) | `opportunityType` | Emits `farm` in addition to `lp` |

## Error and Data Quality Behavior

- Non-2xx response from Tinyman API -> adapter throws `TinymanAdapterError`.
- Invalid JSON/transport timeout -> adapter throws `TinymanAdapterError`.
- Rows missing either APY or TVL (USD) are filtered out, not partially emitted.
- Rows are filtered to verified pools by default (`TINYMAN_ONLY_VERIFIED=true`).

## Rate-Limit and Reliability Notes

- Adapter currently performs on-demand fetches per request.
- No retry loop is implemented in this phase.
- No persistent cache is used yet (future phases will add cache strategy).
- Wallet positions do not scan the opportunity catalog. `/positions` sends the
  positive ASA ids from its shared indexer snapshot as `liquidity_asset_ids` and
  values only the LP tokens returned by that targeted query.

## Known Caveats

- Endpoint/field names are controlled by Tinyman and may evolve.
- Pool endpoint data maps to `lp`; farming incentives are emitted as separate
  `farm` opportunities when staking fields are present.
- `tvlUsd` and `apy` are trusted from source; cross-protocol normalization
  tolerances will be refined as additional adapters are added.
