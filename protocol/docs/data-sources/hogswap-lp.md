# HOGSWAP LP valuation (positions)

Unified LP position valuator for venues that do **not** already have a
per-protocol collector. Canix stays walletless: address in, position rows out;
it does not sign or submit.

This is the portfolio-side HOGSWAP integration. STAMM opportunity discovery and
unsigned mint/redeem shapes live in [stamm.md](stamm.md)
(`mainnet:stamm:v1:mint:lp` / `mainnet:stamm:v1:redeem:lp`). The HOGSWAP
**swap** router (`mainnet:hogswap:v1:swap:fixed-input`) is documented in
[hogswap-swap.md](hogswap-swap.md) and does not replace Haystack `/swaps/*`.

## Source Strategy

- Mode: HOGSWAP HTTP (no `hogswap-js-sdk` dependency; same routes as the JS SDK `lp()` helper)
- Collector: `src/services/hogswap-lp-positions.ts`
- Client: `src/services/hogswap-client.ts`
- Base URL: `HOGSWAP_API_BASE_URL` (default `https://hogswap-v1.liquihog.dev`)
- Endpoints:
  - LP catalog (STAMM): `GET /stamm/pools` → `tier_breakdown[].lp_asset_id`
  - LP catalog (other DEXes): paginated `GET /pools` → `lp_asset_id`
  - Valuation: `GET /lp/{asset_id}?amount=` (amount in LP **base units**)
  - Optional leftover pricing helper: `GET /analytics/prices` (bulk map; not a full portfolio product)

## Environment Variables

- `HOGSWAP_API_BASE_URL` (optional; public mainnet default)
- `HOGSWAP_API_KEY` (optional; sent as `X-API-Key` when provided)
- `HOGSWAP_HTTP_CONCURRENCY` (optional, default `2`; HOGSWAP allows 4 in-flight/IP)
- `HOGSWAP_HTTP_DELAY_MS` (optional, default `50`)
- `HOGSWAP_HTTP_TIMEOUT_MS` (optional, default `8000`; aborts hung catalog/valuation fetches)
- `HOGSWAP_POOLS_PAGE_LIMIT` (optional, default `500`)
- `HOGSWAP_POOLS_MAX_PAGES` (optional, default `50`)
- `POSITIONS_CATALOG_TTL_MS` (shared catalog cache, default 5 minutes)

## What `/positions` emits

For a connected wallet, held ASAs are intersected with the HOGSWAP LP-id catalog.
Matching holdings (except Tinyman/Pact — see overlap) are valued and emitted as
`positionType: lp` rows:

| Field | Source |
|---|---|
| `protocol` | DEX name → `stamm` / `algofi` / `humble` |
| `assetId` | LP ASA id |
| `assetIds` | Underlying A/B ASA ids |
| `assetSymbol` | `{A}/{B} LP` (ALGO for asset `0`) |
| `usdValue` | `value_usd_micro / 1e6`, or **null** when supply or a reserve price is missing |
| `inputHints.tierIndex` | STAMM tier when present |
| `inputHints.poolAppId` / `assetAId` / `assetBId` / `liquidityAssetId` | Pool + underlyings |
| `notes` | DEX name, pair, redeemable A/B base units (or that they are unavailable) |

USD and redeemable amounts are a **proportional-share NAV** of pool reserves at
HOGSWAP analytics prices — **no slippage, no exit fee**. They are not a market
quote and must not be treated as executable redeem proceeds.

## Overlap with Tinyman / Pact collectors

Tinyman and Pact already collect LP holdings from their own APIs. The HOGSWAP
valuator **does not emit** rows for DEX names that start with `tinyman` or
`pact`, even when those LP ASAs appear in `GET /pools`. Canonical rows stay:

- Tinyman: `collectTinymanPositions` (`positionId` `tinyman:lp:{liquidityAssetId}`)
- Pact: `collectPactPositions` (`positionId` `pact:lp:{liquidityAssetId}`)

Prefer this HOGSWAP path for **new** DEX LP sources (STAMM, AlgoFi, Humble)
instead of adding per-protocol collectors.

## Data-source caveats

- HOGSWAP market data is edge-cached ~5s. Canix additionally caches the LP-id
  catalog for `POSITIONS_CATALOG_TTL_MS` and throttles HTTP to stay under
  HOGSWAP IP limits (30 quotes/10s/IP is quote-path; market-data still shares
  the 4 in-flight/IP cap).
- STAMM `/lp/{id}` answers from cached tier state (no extra chain read).
- Non-STAMM LP supply is a live algod read on the HOGSWAP side (~12s cache).
- Null `lp_supply` / `value_usd_micro` / redeemable fields stay **null**. Canix
  does not invent USD from leftover wallet prices.
- `GET /analytics/prices` is available on the client for leftover ids that are
  already part of the same positions payload. It is not used to dump the rest
  of the wallet as a portfolio.
- Execution shapes for STAMM mint/redeem are `mainnet:stamm:v1:mint:lp` and
  `mainnet:stamm:v1:redeem:lp`. Position `compatibleExitShapeKeys` include
  redeem once those shapes are registered.

## Tests

Fixture-based coverage (recorded `/lp/{id}` and `/stamm/pools` payloads; no live
paid x402):

- `tests/unit/hogswap-lp-normalize.test.ts`
- `tests/integration/hogswap-lp-positions.test.ts`
- `tests/fixtures/hogswap/lp-valuation.ts`
