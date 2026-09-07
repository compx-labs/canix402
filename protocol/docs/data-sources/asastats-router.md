# ASA Stats Smart Router

Walletless Canix adapter for the ASA Stats Smart Router (mainnet app
`3692588382`, v1.0.0, Sep 2026). Quotes and unsigned mixed groups only — Canix
does not sign, does not submit, and does not scrape the website UI.

Public `/swaps/*` remains Haystack until the multi-router compiler
([NEO-353](https://linear.app/neonforge/issue/NEO-353)). This adapter is the
ASA Stats source that compiler will call.

## Integrator path (spike, 2026-09-07)

ASA Stats quotes **in their engine**, not in a browser SDK. The open widgets
proxy:

| Scope | Method | Path |
| --- | --- | --- |
| `router:quote` | `POST` | `/api/v2/internal/router/quote/` |
| `router:group` | `POST` | `/api/v2/internal/router/group/` |

Auth on the engine is `Authorization: Bearer <deployment token>`. Those scopes
are granted by ASA Stats; a fork cannot invent them. Widget sources:

- [asastats/widgets `views.py`](https://github.com/asastats/widgets/blob/main/inhouse/asastats/views.py)
- [runbook.rst](https://github.com/asastats/widgets/blob/main/inhouse/asastats/runbook.rst)
- [widget.toml](https://github.com/asastats/widgets/blob/main/inhouse/asastats/widget.toml)

### What is **not** an integrator path

| Surface | Result | Why it is not usable |
| --- | --- | --- |
| `POST https://www.asastats.com/api/v2/internal/router/quote/` (no auth) | **404 HTML** | Paths are not mounted on the public site. They live on the engine behind the widget host. |
| `GET/POST https://www.asastats.com/api/v2/` | **401** `Authentication credentials were not provided.` | Portfolio API. Bearer user tokens do not include `router:quote` / `router:group`. |
| Widget `quote` / `group` URLs | Session + linked-address CSRF POSTs | Browser-only; Canix is walletless. |
| `window.asastatsSwap.signAndSend` | Submits | Canix never submits. |
| On-chain app `3692588382` ABI | Open to any caller | Quoting still needs their pair graph / allocator. Canix will not invent a client-side route graph. |

### Access blocker — what we need from ASA Stats

Live quote/group from Canix is blocked until they provide:

1. **Engine base URL** for partner calls (not `www.asastats.com`).
2. **Bearer deployment token** with scopes `router:quote` and `router:group`.

Until then: set `ASASTATS_API_TOKEN` when a partner token exists; otherwise
`asaStatsRouterAccessStatus().ready` is false and `getQuote` / `buildSwapGroup`
throw `AsaStatsAccessBlockedError` with the same ask. Fixtures cover the wire
contract without contacting the engine.

## Adapter

- Client: `src/services/asastats-router.ts`
- DTOs: `src/types/asastats-router-schema.ts`
- Fixtures: `tests/fixtures/asastats/router.ts`
  - `sell` ALGO → USDC (native ALGO in, mainnet USDC out)
  - multi-venue `Tinyman v2, Pact, STAMM` mixed unsigned group

`getQuote` posts `{ address, from_asset_id, to_asset_id, amount, mode, slippage_pct }`
with `amount` as a decimal **string**. `mode` is `sell` (fixed-input) or `buy`
(fixed-output). The engine quote blob is stored on `data.raw` and posted back
to `router:group`.

`buildSwapGroup` returns Canix swap DTOs:

- `signer: "user"` — unsigned base64; client signs locally
- `signer: "protocol"` — backend-signed quote authorization (`signedTransaction`)
- `meta.executionSubmitted` is always `false`
- HTTP **409** → `AsaStatsQuoteStaleError` (floor no longer clears; re-quote)

Tinyman v1 legs are refused by the engine on this path (lsig top-level payouts).
Canix does not add them.

## Fees (for multi-router scoring)

| Field | Meaning |
| --- | --- |
| `fees_total` → `networkFeeMicroAlgos` | Group network cost in µALGO. **Not** the platform fee. |
| `platformFeeBps` | List price **5 bps**, skimmed in ALGO by the router app. |
| `platformFeeAlreadyNetted` | `true`. It already shows up as a slightly smaller `amount_out`. |
| ASASTATS holder discounts | 100k → 4.75 bps … 50M → 2.5 bps. Applied by ASA Stats across linked addresses. **Do not request a discount from the client.** |

`scoreAsaStatsQuote()` sets `subtractPlatformFee: false`. Scoring must compare
`expectedNetOutBaseUnits` (`amount_out`) plus `networkFeeMicroAlgos`. Do not
haircut `amount_out` by another 5 bps.

## Environment Variables

- `ASASTATS_API_TOKEN` — Bearer deployment token with `router:quote` + `router:group` (required for live calls)
- `ASASTATS_API_BASE_URL` — engine origin (default `https://www.asastats.com`, which **404s** the router paths)
- `ASASTATS_ROUTER_APP_ID` — optional; default `3692588382` (redeployments change this)
- `ASASTATS_QUOTE_TTL_MS` — optional, default `30000`
- `ASASTATS_HTTP_TIMEOUT_MS` — optional, default `8000`
- `ASASTATS_HTTP_CONCURRENCY` / `ASASTATS_HTTP_DELAY_MS` — optional throttle

## Tests

`tests/unit/asastats-router.test.ts` (`npm run test:unit`). Fixture-based; no
live engine, no x402, no signing.
