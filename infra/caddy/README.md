# Caddy x402 Integration

This directory contains the edge-gating configuration for canix402 using the
`x402` Caddy middleware.

## Purpose

- Keep payment enforcement at the Caddy edge.
- Keep the Fastify API focused on business logic.
- Use GoPlausible facilitator for payment verification and settlement.

## Route Access Policy

- Free routes: `GET /health`, `GET /metadata`, `GET /discovery`, `GET /openapi.json`
- Paid routes: `GET /opportunities`, `GET /protocols/:protocol/opportunities`

## Header Protocol

Caddy and clients communicate using x402 headers:

- `PAYMENT-REQUIRED` (402 response with payment requirements)
- `PAYMENT-SIGNATURE` (client retry with payment payload)
- `PAYMENT-RESPONSE` (success response with settlement receipt)

## Algorand Payload Requirements

For Algorand exact-scheme flows, client `PAYMENT-SIGNATURE` payload must encode:

- `x402Version: 2`
- `paymentPayload.paymentGroup` (base64 signed txn group bytes)
- `paymentPayload.paymentIndex` (index of payment txn in group)
- `paymentRequirements.network`
- `paymentRequirements.asset` (USDC ASA on the selected network)
- `paymentRequirements.payTo`
- `paymentRequirements.maxAmountRequired`

The API service treats this payload as opaque. Caddy/facilitator own verify and
settle behavior.

## Discovery-Onboarding Flow

1. Read `GET /discovery` to enumerate endpoints, access policy, and x402 metadata.
2. Read `GET /openapi.json` for operation-level request/response contracts.
3. Call free routes directly.
4. For paid routes, request once without payment to receive `PAYMENT-REQUIRED`,
   then retry with `PAYMENT-SIGNATURE`.

## Local Usage

1. Copy `.env.example` to `.env` and fill required fields.
2. Start API (`npm run dev` from project root).
3. Run Caddy with this Caddyfile and env vars.

Example:

```sh
caddy run --config infra/caddy/Caddyfile --adapter caddyfile
```

## E2E Test Prerequisites

The robust x402 E2E tests run the real Caddy gateway with the x402 plugin.

1. Build project-local Caddy binary:

```sh
npm run build:caddy-x402
```

2. Run the x402 E2E suite:

```sh
npm run test:x402-e2e
```

The E2E suite validates validator calls to facilitator `/verify` and `/settle`,
plus paid/free route behavior through Caddy.
