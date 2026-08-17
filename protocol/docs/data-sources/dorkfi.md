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

`GET /positions` always reads verified Algorand ASA catalog markets on-chain.
Those rows are the executable surface:

- `positionId`: `dorkfi:supplied:<marketAppId>` (market-scoped supply)
- `positionId`: `dorkfi:debt:<marketAppId>` (per-market outstanding borrow from
  on-chain `get_user` / `get_user_borrow_amount`, not wallet ASA balances)
- `opportunityId`: `dorkfi:algorand:<poolAppId>:<assetId>:lending` (same scheme as
  opportunity discovery — pool app id, not market app id)
- `inputHints`: `{ poolAppId, marketAppId, assetId }` for withdraw / repay quotes
- Debt `amountRaw` is outstanding underlying ASA principal (repay-shape units)
- Debt exit shape: `mainnet:dorkfi:v1:repay:asa`
- When market oracle price is unusable, debt rows keep `usdValue: null` with a
  clear caveat (liabilities are never omitted solely for pricing)

When the indexed health API is available, pool-level USD supplied and debt rows
are **merged** (not substituted) for totals and health factor:

- `positionId`: `dorkfi:supplied-usd:<poolAppId>` (when `totalCollateralValue > 0`)
- `positionId`: `dorkfi:debt-usd:<poolAppId>` (when `totalBorrowValue > 0`)
- `opportunityId`: `null`, `assetId`: `null`, `assetSymbol`: `USD`
- amounts scaled from index units (`/1e12`) like collateral
- no exit/manage shapes (informational only — not executable)

ASA supply `amountRaw` is the wallet **nToken** balance (withdraw-shape units).
Estimated underlying ASA is derived as `(nToken * depositIndex) / 1e18` for notes
only — positions no longer depend on a naked `withdraw` simulate (which often
fails without the full custom group).

Paused catalog markets are skipped quietly for supply. Debt probes still run when
possible. `borrowedUsdComplete` is false when any on-chain debt row is unpriced or
a debt probe fails.

Readonly `get_user` / `get_user_borrow_amount` simulates must pay the Dork.fi
inner-call group fee (`DEFAULT_DORKFI_GROUP_FEE`). A 1000µA simulate fails with
`no ABI return` even for wallets with no user box, which marks Dork.fi `partial`
and blocks autonomous agents that treat any ≠ `ok` as an incomplete snapshot.

If the indexed source is unavailable, on-chain ASA supply and debt rows are still
returned. Indexed USD aggregates are optional; on-chain debt coverage drives
`borrowedUsdComplete`.

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
| `appId` (pool) + `assetId` + `type` + network | `opportunityId` | `dorkfi:algorand:<poolAppId>:<assetIdOrSlug>:<type>` — `appId` is the lending **pool** app, not the per-asset market app |
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
