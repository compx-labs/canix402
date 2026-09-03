---
title: "Watch / webhook retainers"
date: "2026-09-03"
version: "1.6.1"
---

# Watch / webhook retainers

**Date:** 3 September 2026

Checklist 13.9. Agents register a recurring x402 retainer instead of polling
`/positions` and `/opportunities/personalized`. Canix stays walletless.

## What shipped

- `POST /watch` and `POST /watch/refresh` (compiler-priced, default 0.25 USDC)
  register or extend a walletless watch: address + thresholds (health factor,
  claimable USD, APY drop, Réti capacity) + optional HTTPS webhook.
- Threshold crossings deliver signed JSON (`X-Canix-Signature`,
  `X-Canix-Idempotency-Key`). No webhook means MCP-only storage on the receipt.
- `GET /watch/:watchId` is free and lists recent firings. Secret rotation is
  `POST /watch/:id/rotate-secret` with `X-Canix-Watch-Secret`.
- Discovery, OpenAPI, MCP tools (`canix_create_watch`, `canix_refresh_watch`,
  `canix_get_watch`, `canix_rotate_watch_secret`), policy resource
  `canix://watch`, and receipt resource `canix://watch/{watchId}`.
- Redis (`canix402:watch:{id}`) when `REDIS_URL` is set; production without Redis
  fail-closes. HMAC secrets are webhook keys, never wallet keys.

See `protocol/docs/watch-retainers.md`.
