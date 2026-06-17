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

Files:

- `tests/integration/discovery-contract.test.ts`
- `tests/integration/openapi-consistency.test.ts`
- `tests/integration/x402-gating.test.ts`

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

## Troubleshooting

- `Caddy binary not found`:
  - run `npm run build:caddy-x402`
- `Caddy exited early`:
  - inspect test output logs from `tests/helpers/caddyHarness.ts`
  - verify `infra/caddy/Caddyfile` syntax and environment values
- E2E passes locally but fails in CI:
  - confirm the CI environment has Go and `xcaddy` available for binary build

