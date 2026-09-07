# STAMM (LiquiHog) Data Source

This document defines the LiquiHog STAMM LP adapter used by canix402.

STAMM is a multi-tier AMM (six fee tiers per pair, each with its own LP ASA).
Discovery and execution go through the public **HOGSWAP API**, not `stamm-py-sdk`
(that SDK wants a mnemonic and talks algod directly). Canix stays walletless:
quote and return unsigned groups; it does not sign or submit.

Haystack swap routing (`/swaps/*`) is unchanged. Unified LP **position** valuation
via HOGSWAP is documented in [hogswap-lp.md](hogswap-lp.md).

## Source Strategy

- Mode: HOGSWAP HTTP (no `hogswap-js-sdk` dependency; same routes as the JS SDK)
- Adapter file: `src/adapters/stamm.ts`
- Client: `src/services/hogswap-client.ts`
- Execution shapes: `src/execution/shapes/stamm/` (`mint:lp` / `redeem:lp`)
- Base URL: `HOGSWAP_API_BASE_URL` (default `https://hogswap-v1.liquihog.dev`)
- Endpoints:
  - Catalog: `GET /stamm/pools?active_only=true&sort=tvl`
  - Asset labels: `GET /stamm/assets` (optional; fallback `ALGO` / `ASSET-{id}`)
  - Quote: `POST /quote` with `mode: LP_MINT` or `LP_REDEEM`
  - Execute: `POST /execute` → unsigned group (never broadcast)

One **OpportunityRecordV1** row is emitted per **active fee tier** (not one row
per pool). Position `opportunityId` uses the same `{pool_id}:lp:{tier_index}`
scheme so holdings join discovery rows.

## Normalized Opportunity

| Field | Value |
|---|---|
| `protocol` | `stamm` |
| `opportunityType` | `lp` |
| `opportunityId` | `{pool_id}:lp:{tier_index}` |
| `assetPair` | `{unitA}/{unitB}` (ALGO for asset `0`) |
| `assetIds` | `[asset_a, asset_b]` |
| `tvlUsd` | pool `tvl_usd_micro / 1e6` allocated to the tier by reserve share |
| `apy` | `0` (unknown — see notes; not snapshotted into opportunity history) |
| `yieldBasis` | `apr` (schema-required placeholder; not a measured APR) |
| `inputHints` | `poolAppId`, `poolId`, `tierIndex`, `liquidityAssetId`, `assetAId`, `assetBId` |

Listings expose **TVL and fee bps**, not APY. Fee-APR is never inferred from
incomplete volume. `notes` carry tier fee bps, LP ASA id, and the unknown-APY caveat.

Inactive tiers (`active: false`), tiers without `lp_asset_id`, and rows with
non-positive allocated TVL are dropped.

## Execution

Shapes:

- `mainnet:stamm:v1:mint:lp` — pool assets (`amountA` / `amountB`, one side may be `0`) **or** `externalInputs` (any asset, converted into the tier ratio)
- `mainnet:stamm:v1:redeem:lp` — burn `lpAmount` to a pool asset or any `targetAsset`

Flow matches Haystack compose: `POST /quote` then `POST /execute`. Quotes live
~30s; Canix returns unsigned txns and never broadcasts. The wallet must already
be opted into the LP ASA before execute.

Optional `maxLegs` (1–16) is forwarded when composing with other groups so the
HOGSWAP planner can cap route complexity on conversion legs.

**Do not hardcode router or registry app ids.** `/health` `router_app_id` and
`/stamm/meta` `registry_app_id` can change; `/execute` always targets the current
router. Live anchors (examples only, not baked into shapes): registry
`3544666315`, example ALGO/HOG pool `3544790053`, HOG `3178895177`.

## Environment Variables

- `HOGSWAP_API_BASE_URL` (optional; public mainnet default)
- `HOGSWAP_API_KEY` (optional; sent as `X-API-Key` when provided)
- `HOGSWAP_HTTP_CONCURRENCY` (optional, default `2`; HOGSWAP allows 4 in-flight/IP)
- `HOGSWAP_HTTP_DELAY_MS` (optional, default `50`)
- `HOGSWAP_HTTP_TIMEOUT_MS` (optional, default `8000`; aborts hung quote/execute/catalog fetches)

## Rate limits and freshness

| Limit | Value |
|---|---|
| Quote rate | 30 quotes / 10s / IP |
| Concurrency | 4 in-flight / IP |
| Execute budget | 5 builds per `quote_id` |
| Quote TTL | ~30 seconds |
| Market-data cache | ~5s at the HOGSWAP edge |

## Tests

Fixture-based coverage (recorded `/stamm/pools` payload; no live paid x402):

- `tests/unit/stamm-normalize.test.ts`
- `tests/fixtures/adapters/stamm.ts`
- `tests/integration/stamm-execution-shapes.test.ts`
- `tests/integration/stamm-adapter.test.ts`
