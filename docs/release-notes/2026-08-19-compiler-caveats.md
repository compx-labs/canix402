---
title: "Intent compiler, Dork.fi positions, and execution caveats"
date: 2026-08-19
version: "1.2.0"
---

# Intent compiler, Dork.fi positions, and execution caveats

**Date:** 19 August 2026

Since 16 August, Canix shipped the paid allocation compiler, stopped treating empty Dork.fi wallets as a positions outage, and published protocol-specific quote caveats so agents do not invent pool IDs, opt-ins, or slippage. Canix still never holds keys or submits transactions.

## What shipped

### Paid `POST /plans`

Flagship compiler SKU: an agent states `{ address, budget: { assetId, amount }, constraints?, opportunityIds? }` and Canix returns ordered unsigned steps — eligibility, optional swap hints, protocol setup, and enter. Groups stay unmerged; the client signs and submits. Brownie and other user agents should consume `/plans` rather than forking a compiler.

Constraints cover max protocol weight, no new borrows, execution-ready only, and TVL/freshness floors. Swap legs in this SKU are hints, not live Haystack groups. Folks-style setup that needs a confirmed escrow is deferred for a later `POST /execution/quotes`. MCP: `canix_get_plan`.

### Dork.fi empty-user simulate

Dork.fi `get_user` returns no ABI value when the wallet has no user box, and the same symptom appears when the simulate is under-funded. Canix now treats both as **empty user / zero debt**, not a coverage gap: `GET /positions` omits a fake debt row and keeps `borrowedUsdComplete: true` so agents that block on protocol `partial` are not stalled.

Readonly simulates pay the inner-call group fee (20,000 µA). There is no `setup:createUser` shape — the first `deposit:asa` creates the user record. Do not skip deposit because a simulate looked like a failure.

### Execution caveats hub

New `protocol/docs/execution-shapes/protocol-caveats.md` covers Tinyman, Folks Finance, Pact, CompX, and Dork.fi construction details: pool discovery, opt-ins, min-balance, slippage math, liquidity limits, and app-upgrade tripwires. `GET /execution/shapes` exposes it as `meta.caveatsDocsPath`. OpenAPI, discovery, and MCP `canix_list_execution_shapes` / `canix_get_execution_quote` point at it.

### Quality

Fixture-based `protocol/tests/unit/` coverage for Tinyman, Folks, Pact, CompX, and Dork.fi opportunity normalization (no live chain, no x402). Production smoke tests share a free-endpoint assertion helper.

## Pricing

| Step | Route / tool | Price |
| --- | --- | --- |
| Plan compiler | `POST /plans` / `canix_get_plan` | **0.25 USDC** |
| Eligibility (standalone) | `POST /eligibility` / `canix_check_eligibility` | **0.01 USDC** |
| Quote compile (standalone) | `POST /execution/quotes` / `canix_get_execution_quote` | **0.10 USDC** flat per request |

Caddy env: `X402_PRICE_PLANS_USDC=0.25` (250000 micro-USDC). Set it on both the gateway and protocol components so discovery matches the gate.

## Agent loop

1. Optional `GET /opportunities/personalized` / `canix_get_personalized_opportunities`
2. `POST /plans` / `canix_get_plan`
3. Review `blocked[]`, quote `warnings`, and `meta.caveatsDocsPath` before signing
4. Sign and submit locally in `order` / `prerequisiteShapeKeys` (never merge groups)
