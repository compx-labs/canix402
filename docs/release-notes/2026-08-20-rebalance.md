---
title: "Rebalance / delta quotes"
date: "2026-08-20"
version: "1.5.0"
---

# Rebalance / delta quotes

**Date:** 20 August 2026

Protocol **1.5.0**. Agents can request a **delta** plan against the current book — target weights, or harvest idle ALGO / claim and redeploy — instead of a full unwind-and-rebuild. Canix still never holds keys or submits transactions.

## What shipped

### Paid `POST /plans/rebalance`

New compiler SKU: `{ address, targetWeights?, harvestIdle?, includeClaims?, algoReserveMicroAlgos?, minDeltaBps?, constraints?, swapSlippage? }`. Provide target weights (bps summing to 10000) and/or `harvestIdle: true`.

- Positions not listed in `targetWeights` are left unchanged.
- Overweight rows emit a **partial** exit using `compatibleExitShapeKeys` (full exit only when target weight is 0).
- `harvestIdle` claims worth-claiming reward rows from the claim desk and redeploys wallet ALGO above a 1 ALGO reserve (configurable).
- Enters reuse eligibility + swap-aware compose. Enter that would spend unconfirmed exit proceeds is `compileStatus: deferred`.
- Groups stay unsigned and unmerged. `meta.groupsMerged` is always `false`.

MCP: `canix_get_rebalance_plan`. See `protocol/docs/execution-shapes/rebalance-delta.md`.

## Pricing

| Step | Route / tool | Price |
| --- | --- | --- |
| Delta rebalance | `POST /plans/rebalance` / `canix_get_rebalance_plan` | **0.25 USDC** |
| Plan compiler | `POST /plans` / `canix_get_plan` | **0.25 USDC** |
| Swap-aware compose | `POST /execution/compose` / `canix_compose_enter` | **0.10 USDC** |

Caddy env: `X402_PRICE_PLANS_REBALANCE_USDC=0.25` (250000 micro-USDC). **Required on both the Caddy gateway and the protocol component before this release is deployed** — a missing price var is a Caddyfile parse error and the gateway will not start.

## Agent loop

1. Optional `GET /positions` / `GET /positions/claimable`
2. `POST /plans/rebalance` / `canix_get_rebalance_plan`
3. Review `blocked[]` and step warnings. Sign only user legs. Submit each group separately in `order` before `expiresAt`. Never merge groups.
