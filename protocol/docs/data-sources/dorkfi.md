# Dork.fi Data Source

This document defines the current Dork.fi adapter contract used by canix402.

## Source Strategy

- Mode: API-first
- Adapter file: `src/adapters/dorkfi.ts`
- Base URL: `DORKFI_API_BASE_URL`
- Endpoint used: `GET /dorkfi-opportunities-latest.json`
- Network policy: Algorand-only rows are normalized; non-Algorand rows are ignored.

## Environment Variables

- `DORKFI_API_BASE_URL` (required)
- `DORKFI_API_KEY` (optional; sent as bearer token when configured)

## Normalized Output Fields

Each Dork.fi row is normalized into `OpportunityRecordV1` with required user fields:

- `apy`
- `tvlUsd`

Other emitted fields:

- `protocol`
- `opportunityType`
- `opportunityId`
- `assetPair`
- `assetIds` (optional; emitted only when `assetId` is a valid integer)
- `yieldBasis` (always `apy`)
- `sourceTimestamp`
- `fetchedAt`
- `notes` (only when fallback identifiers are used)

## Field Mapping

| Dork.fi field | Normalized field | Notes |
|---|---|---|
| `type` | `opportunityType` | Supported values: `lp`, `farm`, `staking`, `lending` |
| `assetName` | `assetPair` | Falls back to `unknown` when missing |
| `apy` | `apy` | Required; row dropped when invalid |
| (adapter policy) | `yieldBasis` | Always `apy` |
| `tvl` | `tvlUsd` | Required; row dropped when invalid |
| `assetId` | `assetIds[0]` | Emitted only when valid non-negative integer |
| `appId` + `assetId` + `type` + network | `opportunityId` | Stable synthesized identifier |
| fetch timestamp | `sourceTimestamp` | Source currently does not expose per-row update timestamp |

## Error and Data Quality Behavior

- Missing `DORKFI_API_BASE_URL` -> adapter throws `DorkFiAdapterError`.
- Non-2xx response from Dork.fi API -> adapter throws `DorkFiAdapterError`.
- Invalid JSON/transport timeout -> adapter throws `DorkFiAdapterError`.
- Rows with unsupported `type`, invalid APY/TVL, or non-Algorand network are filtered out.

## Rate-Limit and Reliability Notes

- Current mode is on-demand fetch per request.
- No retry loop is implemented in this phase.
- No persistent cache is used yet (planned for future phases).

## Known Caveats

- Source payload field types can vary (`assetId` can be number or string).
- Dork.fi feed includes non-Algorand networks; this adapter intentionally keeps only Algorand rows.
- `sourceTimestamp` is set to adapter fetch time because feed rows currently do not provide per-row timestamps.
