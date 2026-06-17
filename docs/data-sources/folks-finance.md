# Folks Finance Data Source

This document defines the current Folks Finance adapter contract used by canix402.

## Source Strategy

- Mode: API-first
- Adapter file: `src/adapters/folksFinance.ts`
- Base URL: `FOLKS_FINANCE_API_BASE_URL`
- Endpoint used: `GET /opportunities`

## Environment Variables

- `FOLKS_FINANCE_API_BASE_URL` (required)
- `FOLKS_FINANCE_API_KEY` (optional; sent as bearer token when configured)

## Normalized Output Fields

Each Folks row is normalized into `OpportunityRecordV1` with required user
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

| Folks field | Normalized field | Notes |
|---|---|---|
| `id` | `opportunityId` | Falls back to generated id when missing |
| `marketName` | `assetPair` | Falls back to `unknown` when missing |
| `apy` | `apy` | Required; row dropped if invalid |
| `tvlUsd` | `tvlUsd` | Required; row dropped if invalid |
| `apr` | `apr` | Optional |
| `updatedAt` | `sourceTimestamp` | Falls back to `fetchedAt` |
| `type` | `opportunityType` | Keyword mapping (`farm`, `stake`, `lend`) else `lp` |

## Error and Data Quality Behavior

- Missing `FOLKS_FINANCE_API_BASE_URL` -> adapter throws `FolksFinanceAdapterError`.
- Non-2xx response from Folks -> adapter throws `FolksFinanceAdapterError`.
- Invalid JSON/transport timeout -> adapter throws `FolksFinanceAdapterError`.
- Rows missing APY or TVL (USD) are filtered out.

## Rate-Limit and Reliability Notes

- Current mode is on-demand fetch per request.
- No retry loop is implemented in this phase.
- No persistent cache is used yet (planned for future phases).

## Known Caveats

- Endpoint and field names can change over time.
- `marketName` is used as the v1 market identifier; this may be split into
  market-specific identifiers later if needed.
- APY and TVL values are source-provided and will be cross-normalized further as
  additional protocols are added.
