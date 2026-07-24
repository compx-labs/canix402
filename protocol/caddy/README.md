# canix402 Caddy x402 Integration

This folder contains the canix402-owned Caddy edge configuration used to gate
paid API endpoints with x402.

The runtime Caddy config lives at `caddy/Caddyfile`. The x402 Go module source
also lives directly in `caddy/` so App Platform can build the gateway from a
single source directory.

## Route Access Policy

- Free routes: `GET /`, `GET /logo.png`, `GET /banner.png`, `GET /health`,
  `GET /ready`, `GET /metadata`, `GET /discovery`, `GET /openapi.json`,
  `POST /swaps/quote`, `POST /swaps/optin`
  (`GET /metrics` is free on the protocol process only; not proxied as free on Caddy)
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
  - `GET /positions?address=` (price: `X402_PRICE_POSITIONS_USDC`, exactly `0.005`)
  - `GET /protocols/:protocol/opportunities`
  - `POST /execution/quotes` (price: `X402_PRICE_EXECUTION_QUOTE_USDC`, default `0.1`)
  - `POST /swaps/transactions` (price: `X402_PRICE_HAYSTACK_SWAP_USDC`, default `0.005`)

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

## Production Docker (App Platform)

Build the gateway from **`protocol/caddy`**:

```sh
docker build -t canix402-caddy protocol/caddy
```

The same directory contains the x402 Caddy module source and the production
`Caddyfile`, so deployment does not depend on files outside the App Platform
source directory.

