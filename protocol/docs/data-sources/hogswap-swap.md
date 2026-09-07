# HOGSWAP swap router

Canix adapter that quotes and builds **unsigned** swaps via LiquiHog HOGSWAP
(multi-DEX aggregator). Canix stays walletless: it does not sign or submit.

This is a **router source**, not a yield-opportunity adapter. Public
`POST /swaps/*` compares HOGSWAP with Haystack, Folks, Tinyman, Pact, and
ASA Stats and returns the winning unsigned group. Unified LP position
valuation is documented in [hogswap-lp.md](hogswap-lp.md). STAMM mint/redeem
shapes stay in [stamm.md](stamm.md).

## Source Strategy

- Mode: HOGSWAP HTTP (no `hogswap-js-sdk` dependency; same routes as the JS SDK)
- Client: `src/services/hogswap-client.ts` (`quoteHogswapSwap` + `executeHogswapQuote`)
- Swap DTO adapter: `src/services/hogswap-router.ts`
- Execution shapes: `src/execution/shapes/hogswap/`
  - `mainnet:hogswap:v1:swap:fixed-input`
  - `mainnet:hogswap:v1:swap:fixed-output`
  Quote happens in `resolveState`; `/execute` runs only in `build`.
- Base URL: `HOGSWAP_API_BASE_URL` (default `https://hogswap-v1.liquihog.dev`)
- Endpoints:
  - Quote: `POST /quote` with `mode: SWAP` (`amount_in` or exact-out `amount_out`; default `max_hops` 3)
  - Execute: `POST /execute` `{ quote_id, user_address }` → unsigned msgpack-base64 group (**does not broadcast**)

Optional `sender` on `/quote` applies that wallet's HOG-holdings routing-fee
discount so `expected_out` matches delivery. Canix always passes `userAddress`.

## Normalized swap / compile DTOs

| Field | Source |
|---|---|
| `router` | `"hogswap"` (one Canix router source even though legs span STAMM/Tinyman/Pact/…) |
| `quotedAmount` / `expectedOut` | `expected_out` (fee already netted) |
| `minOutAtSlippage` | `min_out_at_slippage` |
| `routerFeeAmount` | `router_fee_amount` — **already deducted**; do not subtract twice |
| `legs` | route legs (`dex_name`, pool ids, planned in/out) |
| `encodedTransactions` | `/execute` `unsigned_group[].txn_b64` |
| `metadata.executionSubmitted` / `signed` / `submitted` | always `false` |

Compile via paid `POST /execution/quotes`. Groups are never merged. Sign only
user legs locally; HOGSWAP does not pre-sign members.

## Environment Variables

Same as [hogswap-lp.md](hogswap-lp.md): `HOGSWAP_API_BASE_URL`, optional
`HOGSWAP_API_KEY`, HTTP concurrency/timeout/429 retry knobs.

Anonymous rate limits apply (30 quotes/10s/IP, 4 in-flight/IP). Paid HOGSWAP
tier via self-register + x402 credits is optional for production throughput.

## Data-source caveats

- Quotes live ~30s. Re-quote after opt-in confirmation (stale-quote).
- Wallet must already be opted into the output ASA (when not ALGO) before `/execute`.
- Missing opt-in is HTTP 422; expired `quote_id` is HTTP 404 on `/execute`.
- No-route is HTTP 404 on `/quote`.
- Default SWAP slippage is **50 bps** (OpenAPI). LP mint/redeem keep 100 bps.

## Tests

Fixture-based coverage (recorded `/quote` payloads; no live paid x402):

- `tests/unit/hogswap-quote.test.ts`
- `tests/unit/hogswap-router.test.ts`
- `tests/integration/hogswap-execution-shapes.test.ts`
- `tests/fixtures/hogswap/swap.ts` (fixed-in ALGO→USDC and GOLD→USDC)

Production live (x402 + on-chain): `tests/live/hogswap-production-swap.test.ts`
(`X402_HOGSWAP_SWAP_LIVE=1`).
