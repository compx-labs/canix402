# Dork.fi Data Source

This document defines the current Dork.fi adapter contract used by canix402.

## Source Strategy

- Mode: API-first
- Adapter file: `src/adapters/dorkfi.ts`
- Wallet position collector: `src/services/protocol-positions.ts`
- Base URL: `DORKFI_API_BASE_URL`
- Endpoint used: `GET /dorkfi-opportunities-latest.json`
- Position endpoint: `GET {DORKFI_INDEXED_API_BASE_URL}/user-health/user/{address}`
- Network policy: Algorand-only rows are normalized; non-Algorand rows are ignored.

## Environment Variables

- `DORKFI_API_BASE_URL` (required)
- `DORKFI_API_KEY` (optional; sent as bearer token when configured)
- `DORKFI_INDEXED_API_BASE_URL` (optional; defaults to `https://dorkfi-api.nautilus.sh`)

## Wallet Positions

`GET /positions` uses Dork.fi's indexed health response first. It emits pool-level
supplied and debt rows with USD values and health factors. These are deliberately
identified as USD summaries rather than asset-level token balances.

If the indexed source is unavailable, the collector falls back to verified
Algorand ASA markets, reads the wallet's nToken balances on-chain, and simulates
their current withdrawal value. The fallback cannot provide debt, health, or USD
valuation, so Dork.fi is reported as `partial` and aggregate totals remain `null`.

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
