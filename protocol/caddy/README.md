# canix402 Caddy x402 Integration

This folder contains the canix402-owned Caddy edge configuration used to gate
paid API endpoints with x402.

The runtime Caddy config lives at `caddy/Caddyfile`. The x402 Go module source
also lives directly in `caddy/` so App Platform can build the gateway from a
single source directory.

## Route Access Policy

- Free routes: `GET /`, `GET /logo.png`, `GET /banner.png`, `GET /health`,
  `GET /ready`, `GET /metadata`, `GET /discovery`, `GET /openapi.json`,
  `POST /swaps/quote`, `POST /swaps/optin`,
  `GET /public/agents/brownie/positions` (Brownie Bot showcase wallet only)
  (`GET /metrics` is free on the protocol process only; not proxied as free on Caddy)
  `GET /sessions/:sessionId` (prepaid session receipt / remaining N/M)
  `GET /watch/:watchId` (watch retainer receipt / recent firings)
- Paid routes emit `accepts[].extra.tag = x402-global-challenge` for facilitator
  Global Hackathon discovery filtering.
  - Caddyfile `accept { extra { tag ... } }` is parsed into the plugin config.
  - Because x402-avm Go `v0.5.1` drops `PaymentOption.Extra` when building 402s,
    the middleware merges configured Extra into the `PAYMENT-REQUIRED` header
    before responding (see `enrichPaymentRequiredExtra` in `handler.go`).
- Paid routes:
  - `GET /opportunities`
  - `GET /opportunities/search`
  - `GET /opportunities/personalized`
  - `GET /opportunities/:id/history` (price: `X402_PRICE_HISTORY_USDC`, default `0.01`)
  - `POST /eligibility` (price: `X402_PRICE_ELIGIBILITY_USDC`, default `0.01`)
  - `POST /plans` (price: `X402_PRICE_PLANS_USDC`, default `0.25`)
  - `POST /plans/rebalance` (price: `X402_PRICE_PLANS_REBALANCE_USDC`, default `0.25`)
  - `POST /policy/validate` (price: `X402_PRICE_POLICY_VALIDATE_USDC`, default `0.25`)
  - `POST /execution/simulate` (price: `X402_PRICE_EXECUTION_SIMULATE_USDC`, default `0.1`)
  - `GET /positions?address=` (price: `X402_PRICE_POSITIONS_USDC`, exactly `0.005`)
  - `GET /positions/claimable?address=` (price: `X402_PRICE_POSITIONS_CLAIMABLE_USDC`, exactly `0.001`)
  - `GET /protocols/:protocol/opportunities`
  - `POST /execution/quotes` (price: `X402_PRICE_EXECUTION_QUOTE_USDC`, default `0.1`)
  - `POST /execution/compose` (price: `X402_PRICE_EXECUTION_COMPOSE_USDC`, default `0.1`)
  - `POST /swaps/transactions` (price: `X402_PRICE_HAYSTACK_SWAP_USDC`, default `0.005`)
  - `POST /sessions` (price: `X402_PRICE_SESSIONS_USDC`, default `0.25`) — prepaid receipt mint
  - `POST /sessions/refresh` (price: `X402_PRICE_SESSIONS_USDC`, default `0.25`) — quota/TTL reset; one-shot only
  - `POST /watch` (price: `X402_PRICE_WATCH_USDC`, default `0.25`) — watch retainer registration
  - `POST /watch/refresh` (price: `X402_PRICE_WATCH_USDC`, default `0.25`) — watch TTL refresh; one-shot only

When `X-Canix-Session` is present on session-eligible paid paths, Caddy skips x402
and the protocol process consumes the receipt (fail-closed). Create/refresh never
accept a session header.

Each paid handle lists Algorand first, then Base (`network base`, which the
plugin publishes as `eip155:8453`). Both accepts use the same price and
`extra.tag`. `X402_PAY_TO_BASE` defaults to `REPLACE_WITH_BASE_PAYTO_ADDRESS`;
that placeholder is omitted at startup so a missing Base receiver does not
advertise a rail. Set it to the merchant `0x` address to enable Base USDC.

## Local Usage

1. Build the local Caddy binary with the x402 plugin:

```sh
npm run build:caddy-x402
```

2. Start the API server:

```sh
npm run dev
```

3. Export Caddy environment values from `caddy/.env.example` (or copy to a local
   `.env` file and source it), then run Caddy:

```sh
npm run dev:caddy
```

Defaults:

- API server listens on `:3000`
- Caddy gateway listens on `:8081`

## Quick Smoke Checks

```sh
curl -i http://localhost:8081/health
curl -i http://localhost:8081/opportunities
```

Expected:

- `/health` returns `200`
- `/opportunities` returns `402` with `PAYMENT-REQUIRED` when no payment header is sent

## Header Protocol

- `PAYMENT-REQUIRED` (402 response with payment requirements)
- `PAYMENT-SIGNATURE` (client retry with payment payload)
- `PAYMENT-RESPONSE` (success response with settlement receipt)

Note: the payer wallet is client-side. Caddy only needs payment policy values
(`pay_to`, `price`, `network`) and facilitator URL; it does not store a payer
mnemonic/private key.

## x402 request telemetry (structured logs)

This tranche’s agent/request monitoring is **Caddy structured logs only** (no
Prometheus counters, no admin dashboard). On paid-route outcomes the middleware
emits zap fields:

- `event`: `x402_payment_required` | `x402_verify_failed` |
  `x402_settlement_failed` | `x402_payment_settled`
- `path`, `method`, `user_agent`, `referer` (headers truncated; never logs
  `PAYMENT-SIGNATURE` bodies)
- Outcome extras when available: `payer`, `tx`, `network`, `reason`

Filter DigitalOcean App Platform Caddy logs by `event` / `user_agent` /
`referer` to watch which directories or agents hit the gateway. See
`docs/incident-response.md` (x402 traffic section). Redeploy the **Caddy**
gateway component for these fields to appear in production; a protocol-only
redeploy is not enough.

The public website `/transactions` page remains indexer-only settlement
showcase and is not this telemetry.

## Production Docker (App Platform)

Build the gateway from **`protocol/caddy`**:

```sh
docker build -t canix402-caddy protocol/caddy
```

The same directory contains the x402 Caddy module source and the production
`Caddyfile`, so deployment does not depend on files outside the App Platform
source directory.

