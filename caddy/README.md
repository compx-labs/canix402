# canix402 Caddy x402 Integration

This folder contains the canix402-owned Caddy edge configuration used to gate
paid API endpoints with x402.

The `caddy-x402avm` subtree remains separate as plugin/example source. This
folder is the runtime config for this project.

## Route Access Policy

- Free routes: `GET /health`, `GET /metadata`, `GET /discovery`, `GET /openapi.json`
- Paid routes: `GET /opportunities`, `GET /protocols/:protocol/opportunities`

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
