# Session Handoff: x402 Live Testing

This document is the starting point for the next agent session.

It captures:

- where the project stands now
- decisions locked in during this session
- what inputs are still needed
- the exact implementation sequence for live x402 tests

## Current Milestones Completed

- Core API/discovery/x402 baseline is in place and tested.
- Tinyman normalization is live and validated with live-source tests.
- Pact normalization has been upgraded to API-first and now emits separate LP and farm opportunities:
  - deterministic IDs (`:lp`, `:farm`)
  - runtime route wiring enabled
  - CLI support enabled
  - integration + live tests passing
- Documentation and checklist were updated to reflect Pact implementation.

## x402 Testing Reality Check (As Of Now)

### What is currently real

- x402 E2E tests run a real local stack:
  - real Fastify app
  - real Caddy binary with x402 plugin
  - real HTTP path negotiation through Caddy (`PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`)

### What is currently mocked/simulated

- Facilitator endpoints (`/verify`, `/settle`) are mocked in test harness.
- Integration-level x402 tests are app-level simulation only.
- No live facilitator call.
- No real mainnet USDC spend from tests yet.

## Decisions Locked In For Next Phase

- Facilitator target: GoPlausible hosted facilitator.
- Auth approach assumption: no auth (to be re-confirmed in runtime environment).
- Dry-run behavior: use dry-run x402 flow where supported.
- Live-spend requirement: include a real mainnet USDC test path (not dry-run only).
- Signing source for live spend: mnemonic via environment variable.
- Policy source: derive payment requirements from Caddy preflight (`PAYMENT-REQUIRED`) during test.
- Safety guardrail: enforce hard spend cap per run at `0.10 USDC`.

## Required Inputs Before Implementation

The next session needs these concrete values/confirmations from the operator:

- Facilitator base URL for the exact GoPlausible endpoint to test against.
- Confirmation whether facilitator truly requires no auth in this environment.
- Dedicated test wallet mnemonic provided via env var (never committed).
- Confirmation wallet is funded for:
  - ALGO fees
  - USDC test spend
- Run gate name confirmation (recommended: `LIVE_X402=true`).
- Execution policy confirmation for CI:
  - recommended initial mode: local only, not CI.

## Proposed Test Architecture For Live x402

Split x402 tests into explicit tiers:

1. **Mocked integration tests** (keep):
   - fast feedback
   - payload/schema/error-path checks
2. **Local E2E with Caddy + mocked facilitator** (keep):
   - plugin integration confidence
   - verify/settle sequencing checks
3. **Live facilitator dry-run/smoke tests** (new):
   - live endpoint availability + payload compatibility
   - no spend when dry-run path is supported
4. **Live mainnet spend tests** (new, opt-in):
   - real `PAYMENT-SIGNATURE` transaction flow
   - real facilitator verify/settle
   - hard budget cap enforcement

## Next Session Implementation Checklist

1. Add env contract for live x402 tests:
   - facilitator URL
   - mnemonic
   - gate flags (`LIVE_X402`, dry-run flag, budget cap)
2. Build a live x402 test helper:
   - read and decode `PAYMENT-REQUIRED`
   - construct/sign Algorand payment group from requirements
   - enforce per-run spend accounting with cap guard
3. Add a live dry-run test file (opt-in):
   - asserts live endpoint compatibility
   - no real spend when dry-run is available
4. Add a live mainnet spend test file (opt-in + guarded):
   - one minimal paid request
   - verify settlement success and response path
   - fail-fast if projected or cumulative spend exceeds cap
5. Update `docs/testing.md` with exact live test commands and safety guidance.
6. Keep existing mocked and local E2E suites untouched as baseline regression safety.

## Safety Rules (Must Not Regress)

- Never hardcode mnemonic, secrets, or private keys.
- Never run live spend tests unless explicit env gate is true.
- Abort run immediately when budget cap is hit or cannot be computed.
- Keep live spend tests deterministic and minimal (single small payment scenario).
