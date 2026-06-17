# Pact Data Source

This document defines the current Pact adapter contract used by canix402.

## Source Strategy

- Mode: API-first
- Adapter file: `src/adapters/pact.ts`
- Base URL: `PACT_API_BASE_URL`
- Endpoint used: `GET /pools`

## Environment Variables

- `PACT_API_BASE_URL` (required)
- `PACT_API_KEY` (optional; sent as bearer token when configured)

## Normalized Output Fields

Each Pact row is normalized into `OpportunityRecordV1` with required user
fields:

- `apy`
- `tvlUsd`

Other emitted fields:

- `protocol`
- `opportunityType`
- `opportunityId`
- `assetPair`
- `apr` (optional)
- `sourceTimestamp`
- `fetchedAt`
- `notes` (only when source fields are missing and fallback identifiers are used)

## Field Mapping

| Pact field | Normalized field | Notes |
|---|---|---|
| `id` | `opportunityId` | Falls back to generated id when missing |
| `pairName` | `assetPair` | Falls back to `unknown/unknown` when missing |
| `apy` | `apy` | Required; row dropped if invalid |
| `tvlUsd` | `tvlUsd` | Required; row dropped if invalid |
| `apr` | `apr` | Optional |
| `updatedAt` | `sourceTimestamp` | Falls back to `fetchedAt` |
| `type` | `opportunityType` | Keyword mapping (`farm`, `stake`, `lend`) else `lp` |

## Error and Data Quality Behavior

- Missing `PACT_API_BASE_URL` -> adapter throws `PactAdapterError`.
- Non-2xx response from Pact -> adapter throws `PactAdapterError`.
- Invalid JSON/transport timeout -> adapter throws `PactAdapterError`.
- Rows missing APY or TVL (USD) are filtered out.

## Rate-Limit and Reliability Notes

- Current mode is on-demand fetch per request.
- No retry loop is implemented in this phase.
- No persistent cache is used yet (planned for future phases).

## Known Caveats

- Pact endpoint and field names can change over time.
- Opportunity type classification is heuristic and may be refined as additional
  product types appear.
- APY and TVL values are source-provided and will be cross-normalized further as
  more protocols are added.
