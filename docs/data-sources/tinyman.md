# Tinyman Data Source

This document defines the current Tinyman adapter contract used by canix402.

## Source Strategy

- Mode: API-first
- Adapter file: `src/adapters/tinyman.ts`
- Base URL: `TINYMAN_API_BASE_URL`
- Endpoint used: `GET /pools`

## Environment Variables

- `TINYMAN_API_BASE_URL` (required in production)
- `TINYMAN_API_KEY` (optional; sent as bearer token when provided)

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
- `apr` (optional when upstream provides it)
- `sourceTimestamp`
- `fetchedAt`
- `notes` (only when fallback identifiers are used)

## Field Mapping

| Tinyman field | Normalized field | Notes |
|---|---|---|
| `id` | `opportunityId` | Falls back to generated id if missing |
| `pairName` | `assetPair` | Falls back to `unknown/unknown` if missing |
| `apy` | `apy` | Required; record dropped when invalid |
| `tvlUsd` | `tvlUsd` | Required; record dropped when invalid |
| `apr` | `apr` | Optional |
| `updatedAt` | `sourceTimestamp` | Falls back to `fetchedAt` if missing |
| `type` | `opportunityType` | Mapped by keyword (`farm`, `stake`, `lend`) else `lp` |

## Error and Data Quality Behavior

- Non-2xx response from Tinyman API -> adapter throws `TinymanAdapterError`.
- Invalid JSON/transport timeout -> adapter throws `TinymanAdapterError`.
- Rows missing either APY or TVL (USD) are filtered out, not partially emitted.

## Rate-Limit and Reliability Notes

- Adapter currently performs on-demand fetches per request.
- No retry loop is implemented in this phase.
- No persistent cache is used yet (future phases will add cache strategy).

## Known Caveats

- Endpoint/field names are controlled by Tinyman and may evolve.
- `type` classification may require protocol-specific refinement as farm products
  evolve.
- `tvlUsd` and `apy` are trusted from source; cross-protocol normalization
  tolerances will be refined as additional adapters are added.
