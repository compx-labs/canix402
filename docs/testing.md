# Testing Guide

This document explains the current test suites, how to run them, and what each
suite validates for canix402.

## Test Suites

### Integration tests (`tests/integration`)

Run with:

```sh
npm run test
```

Coverage:

- Discovery contract coverage (`/discovery`)
- OpenAPI consistency coverage (`/openapi.json`)
- App-level x402 behavior simulation for paid/free routes
- Adapter and protocol-route coverage for:
  - Tinyman
  - Pact
  - Folks Finance

Files:

- `tests/integration/discovery-contract.test.ts`
- `tests/integration/openapi-consistency.test.ts`
- `tests/integration/x402-gating.test.ts`
- `tests/integration/tinyman-adapter.test.ts`
- `tests/integration/pact-adapter.test.ts`
- `tests/integration/folks-finance-adapter.test.ts`

### x402 E2E tests through Caddy (`tests/e2e`)

Run with:

```sh
npm run test:x402-e2e
```

Coverage:

- Real Caddy x402 gateway path for paid endpoints
- Facilitator `/verify` and `/settle` interaction sequence
- Paid endpoint negotiation:
  - missing signature -> `402` + `PAYMENT-REQUIRED`
  - valid signature -> `200`
  - malformed signature -> payment error response
  - invalid verification -> payment error response
- Free endpoint bypass (`/health`, `/metadata`) without facilitator calls

File:

- `tests/e2e/x402-caddy-e2e.test.ts`

## Prerequisites for x402 E2E

The E2E suite requires a project-local Caddy binary with the x402 plugin.

Build once (or after plugin changes):

```sh
npm run build:caddy-x402
```

This generates `.bin/caddy-x402` used by the E2E harness.

The E2E harness loads `caddy/Caddyfile` as the project-owned gateway config.

## Full CI-equivalent run

```sh
npm run test:ci
```

This runs:

1. integration tests
2. x402 Caddy E2E tests

## Build and type checks

Before merging, also run:

```sh
npm run build
npm run typecheck
```

## Data Shape CLI

To inspect the current normalized output shape and live adapter payloads in JSON:

```sh
npm run cli:opportunities
```

Protocol-specific output:

```sh
npm run cli:opportunities -- --protocol tinyman
npm run cli:opportunities -- --protocol pact
```

Compact single-line JSON:

```sh
npm run cli:opportunities -- --compact
```

Fail if no data rows are returned:

```sh
npm run cli:opportunities -- --require-data
```

## Live Data Tests

To verify we can fetch real adapter data (non-mocked):

```sh
npm run test:live
```

This suite currently checks:

- Tinyman live records are returned with numeric `apy` and `tvlUsd`.
- Pact live records are returned with numeric `apy` and `tvlUsd`, including LP
  and farm opportunity type coverage when available.

## Live x402 Integration Tests

To verify live Caddy + facilitator compatibility and live paid settlement:

```sh
npm run test:x402-live
```

This performs a real local stack run:

- real Fastify API
- real Caddy x402 plugin
- real facilitator preflight compatibility checks (`PAYMENT-REQUIRED` from paid route)
- wallet-signed payment retry and facilitator settlement

Configuration source for the live suite:

- local `.env` and `caddy/.env` files are loaded automatically
- shell-exported values take precedence over local env file values
- Caddy payment policy from existing env (`X402_PAYMENT_RECEIVER_ADDRESS`, `X402_PAYMENT_AMOUNT_USDC`, etc.)
- facilitator URL from `X402_FACILITATOR_BASE_URL`
- Algod connection from shared vars used by all integrations:
  - `X402_ALGOD_URL` (default: `https://mainnet-api.algonode.cloud`)
  - `X402_ALGOD_TOKEN` (default: empty string)
- never commit mnemonic values to the repository

## Troubleshooting

- `Caddy binary not found`:
  - run `npm run build:caddy-x402`
- `Caddy exited early`:
  - inspect test output logs from `tests/helpers/caddyHarness.ts`
  - verify `caddy/Caddyfile` syntax and environment values
- E2E passes locally but fails in CI:
  - confirm the CI environment has Go and `xcaddy` available for binary build

