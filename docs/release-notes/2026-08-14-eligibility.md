---
title: "Paid POST /eligibility and honest personalized ranking"
date: 2026-08-14
version: "1.2.0"
---

# Paid POST /eligibility and honest personalized ranking

**Date:** 14 August 2026

Walletless eligibility check so agents can resolve Réti entry requirements and capacity before paying for a quote. Personalized ranking uses the same rules, so full or gated venues are not recommended as enterable. Canix never holds keys or submits transactions.

## What shipped

Paid `POST /eligibility` evaluates `address` × `opportunityIds` (1–25) and returns `{ canEnter, missingAssets, gates, capacity, suggestedSwap, eligibilityFullyCheckable, reasons }`.

Réti `entryRequirements` / `capacity` are resolved: min amount, ASA gates (`gateMatch` any/all), staker slots, and ALGO room. NFD and creator gates are published as `unresolved` — `canEnter` is never true until `eligibilityFullyCheckable` is true. `suggestedSwap` is a hint only (not a live Haystack quote).

`GET /opportunities/personalized` now applies the same eligibility rules and includes `canEnter`, `eligibilityFullyCheckable`, and `meta.eligibilityEndpoint: "/eligibility"`. Quote-time on-chain checks remain authoritative.

MCP: `canix_check_eligibility`. Agent loop: personalized (optional) → eligibility → quote → local sign.

## Pricing

| Step | Route / tool | Price |
| --- | --- | --- |
| Eligibility | `POST /eligibility` / `canix_check_eligibility` | **0.01 USDC** |
| Personalized | `GET /opportunities/personalized` | existing 0.05 USDC |
| Compile | `POST /execution/quotes` / `canix_get_execution_quote` | **0.10 USDC** flat per request |

Caddy env: `X402_PRICE_ELIGIBILITY_USDC=0.01` (10000 micro-USDC). Set it on both the gateway and protocol components so discovery matches the gate.
