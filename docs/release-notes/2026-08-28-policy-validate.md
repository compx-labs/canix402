---
title: "Policy-as-a-service"
date: "2026-08-28"
version: "1.6.0"
---

# Policy-as-a-service

**Date:** 28 August 2026

Operators bring policy; Canix evaluates a compiled plan or proposed `quotes[]`
and still never signs. Brownie’s deterministic caps are a shared validator any
user agent can POST to.

## What shipped

### Versioned policy schema (`1.0.0`)

Documented next to the opportunity contract:

- `protocol/docs/policy-schema.md`
- Copy-paste sample: `protocol/docs/policy-brownie.sample.json`

Fields: `maxProtocolWeightBps`, `minAlgoReserveMicroAlgos`, `minTvlUsd`,
`maxSourceAgeSeconds`, `noNewBorrows`, `executionReadyOnly`.

### Paid `POST /policy/validate`

Compiler SKU: `{ policy, plan? | quotes[]?, walletAlgoMicroAlgos? }`.

- `{ pass, reasons[] }` — fail closed, no signing/submit
- Reuses plan/eligibility/risk fields already on the compiled object
- Does **not** re-quote on-chain; missing fields fail closed (`missing-tvl`,
  `missing-freshness`, `missing-reserve`, …)

MCP: `canix_validate_policy`.

## Pricing

| Step | Route / tool | Price |
| --- | --- | --- |
| Policy validate | `POST /policy/validate` / `canix_validate_policy` | **0.25 USDC** |
| Plan compiler | `POST /plans` / `canix_get_plan` | **0.25 USDC** |
| Simulate / expected delta | `POST /execution/simulate` / `canix_simulate_execution` | **0.10 USDC** |

Caddy env: `X402_PRICE_POLICY_VALIDATE_USDC=0.25` (250000 micro-USDC).
**Required on both the Caddy gateway and the protocol component before this
release is deployed** — a missing price var is a Caddyfile parse error and the
gateway will not start.

## Agent loop

1. `POST /plans` / `canix_get_plan` (or quotes)
2. `POST /policy/validate` / `canix_validate_policy` with the operator document
3. If `pass` is false, do not sign. Publish `reasons[]`.
4. Optionally simulate, then sign only user legs locally.
