# Pact Data Source

This document defines the current Pact adapter contract used by canix402.

## Source Strategy

- Mode: API-first
- Adapter file: `src/adapters/pact.ts`
- Base URL: `PACT_API_BASE_URL`
- Endpoints used:
  - `GET /pools/all?ordering=-tvl_usd&deprecated=false`
  - `GET /farms/all?ordering=-tvl_usd`
- Pool/farm join key: `farm.pool` matches `pool.on_chain_id`
- Verified filtering defaults to enabled (`PACT_ONLY_VERIFIED=true`)

## Environment Variables

- `PACT_API_BASE_URL` (required)
- `PACT_API_KEY` (optional; sent as bearer token when configured)
- `PACT_ONLY_VERIFIED` (optional boolean, default `true`)

## Normalized Output Fields

Pact pool/farm rows are normalized into `OpportunityRecordV1` with required user
fields:

- `apy`
- `tvlUsd`

Other emitted fields:

- `protocol`
- `opportunityType`
- `opportunityId`
- `assetPair`
- `yieldBasis` (always `apr`; Pact APR metrics are normalized into `apy`)
- `apr` (optional)
- `sourceTimestamp`
- `fetchedAt`
- `notes` (only when source fields are missing and fallback identifiers are used)

One pool can emit multiple opportunities:

- `lp` record (always, if LP APY/TVL is valid)
- `farm` records (one per joined farm row when incentive APR data exists)

## Field Mapping

| Pact field | Normalized field | Notes |
|---|---|---|
| `on_chain_id` (pool) | `opportunityId` (`:lp`) | LP ids are suffixed `:lp` |
| `on_chain_id` (farm) | `opportunityId` (`:farm`) | Farm ids are suffixed `:farm` |
| `on_chain_id` (pool) / `farm.pool` | market `poolAppId` (internal) | Joined AMM pool app id; copied into `executionShapes[].inputHints.poolAppId` for `addLiquidityAndFarm` |
| `primary_asset.unit_name` + `secondary_asset.unit_name` | `assetPair` | Falls back to `unknown/unknown` when missing |
| `apr_7d_all` (or `apr_7d`) | `apy` (`lp`) | Decimal fraction -> percentage points; required for LP output |
| (adapter policy) | `yieldBasis` | Always `apr` |
| `apr_7d` (or `apr_7d_all`) | `apr` (`lp`) | Decimal fraction -> percentage points; optional |
| `tvl_usd` (pool) | `tvlUsd` | Required for LP output |
| `average_apr` (or `apr`) | `apy` (`farm`) | Decimal fraction -> percentage points; farm output emitted when APR data indicates incentives |
| `apr` (farm) | `apr` (`farm`) | Decimal fraction -> percentage points; can be `0` while `average_apr` remains informative |
| `tvl_usd` (pool, fallback farm) | `tvlUsd` (`farm`) | Shared liquidity basis for pair-level opportunity |
| fetch timestamp | `sourceTimestamp` | Source rows do not expose per-row update timestamps in this adapter |

## Error and Data Quality Behavior

- Missing `PACT_API_BASE_URL` -> adapter throws `PactAdapterError`.
- Non-2xx response from Pact pools/farms endpoints -> adapter throws `PactAdapterError`.
- Invalid JSON/transport timeout -> adapter throws `PactAdapterError`.
- LP rows missing APY or TVL (USD) are filtered out.
- Farm rows are emitted only when farm APR data indicates incentives.

## Rate-Limit and Reliability Notes

- Current mode is on-demand fetch per request.
- No retry loop is implemented in this phase.
- No persistent cache is used yet (planned for future phases).
- Aggregate `/opportunities` requests degrade gracefully if one upstream fails.
- Wallet positions keep the pools/farms metadata catalog in a short-lived
  process cache. Held LP asset ids and wallet-local farm app ids are intersected
  with that metadata first; only matching farms are read from chain, sequentially.

## Known Caveats

- Pact endpoint and field names can change over time.
- Farm `apr` can be `0` while `average_apr` is positive; farm APY currently uses
  `average_apr` first so opportunities remain visible when incentives are
  represented via average windows.
- APY and TVL values are source-provided and will be cross-normalized further as
  more protocols are added.
- **Farm custody:** when LP is farmed, tokens leave the wallet into a per-user
  Pact farm escrow (unlike Tinyman, where farm commit keeps LP in-wallet).
  Executable farm shapes are `farm:deployEscrow` → `farm:stake` /
  `addLiquidityAndFarm:twoSided`, plus `farm:unstake` and `farm:claimRewards`
  (see `docs/execution-shapes/pact-farm-*.md`).
- Transaction construction (poolAppId discovery, bps→percent slippage, empty-pool
  LP lock, remove min-out `0/0`):
  [execution-shapes/protocol-caveats.md](../execution-shapes/protocol-caveats.md#pact).
- **HOGSWAP overlap:** the unified HOGSWAP LP valuator also sees Pact LP ASAs via
  `GET /pools`. Pact rows stay on this collector; HOGSWAP skips DEX names that
  start with `pact` so the same LP ASA is not double-counted. See
  [hogswap-lp.md](hogswap-lp.md).

## Tests

Fixture-based normalize coverage: `tests/unit/pact-normalize.test.ts` plus
`tests/fixtures/adapters/pact-pools.ts` (`npm run test:unit`). Route-level
coverage remains in `tests/integration/pact-adapter.test.ts`.
