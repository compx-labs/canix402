# Watch / webhook retainers

Push instead of polling `GET /positions` and `GET /opportunities/personalized`.
A recurring x402 retainer registers a **walletless** watch: Algorand address + // pragma: allowlist secret
thresholds + optional HTTPS callback. Canix never stores or requests wallet
keys.

## Contract

| Field | Default |
| --- | --- |
| Price | `0.25` USDC (`X402_PRICE_WATCH_USDC`) — compiler band, same as `POST /plans` |
| TTL | `86400` seconds (24 hours, `X402_WATCH_TTL_SECONDS`) |
| Poll | `300` seconds (`X402_WATCH_POLL_SECONDS`; cron every N minutes) |
| Receipt URI | `canix://watch/{watchId}` |
| Signature header | `X-Canix-Signature: sha256=<hex>` |
| Replay header | `X-Canix-Idempotency-Key` |
| Secret header | `X-Canix-Watch-Secret` (rotate only) |

Token format: `cwatch_` + 32-byte hex. HMAC secret format: `wsec_` + 32-byte hex.

## Routes

| Method | Path | Access |
| --- | --- | --- |
| `POST` | `/watch` | Paid one-shot x402. Registers address, thresholds, optional `webhookUrl`. Returns the HMAC secret **once**. |
| `POST` | `/watch/refresh` | Paid one-shot x402. Extends TTL. `rotateSecret: true` mints a new secret (shown once). Unknown/expired watches fail-closed — register again. |
| `GET` | `/watch/:watchId` | Free receipt. Recent firings, no secret. Unknown → `402 WATCH_INVALID`. Expired → `402 WATCH_EXPIRED`. |
| `POST` | `/watch/:watchId/rotate-secret` | Free. Requires current secret in `X-Canix-Watch-Secret`. Returns the new secret once. Does not extend TTL. |

Create/refresh cannot be paid with a prepaid session.

## Thresholds

At least one is required:

| Field | Crossing |
| --- | --- |
| `healthFactor` | Min wallet health factor from position snapshots drops **below** the value |
| `claimableUsd` | Claim-desk `totals.claimableUsd` rises **to or above** the value |
| `apyDropBps` | Any opportunity APY falls by at least this many basis points vs the previous snapshot (100 bps = 1 percentage point) |
| `retiCapacity` | `true` (or `{ minStakerSlotsRemaining, minAlgoRoomMicroAlgos }`) — Réti venue becomes constrained (`acceptingStake` false, or slots/ALGO room below the floor) |

Fires **only on crossings** (including the first sample already in breach). While a health-factor / claimable / Réti episode remains in breach, the same idempotency key is not delivered again. After recovery, a new episode mints a new key.

## Replay / idempotency

Every delivery includes `X-Canix-Idempotency-Key` (`wfire_{watchId}_{kind}_{episode}` or, for APY drop, previous/current APY). Consumers should treat duplicate keys as the same event. Failed webhooks are retried on the next poll with the same key.

Webhook body is JSON. Sign the **raw body** with HMAC-SHA256 of the registration secret:

```
X-Canix-Signature: sha256=<hex>
X-Canix-Idempotency-Key: wfire_...
X-Canix-Watch-Id: cwatch_...
```

No webhook URL means MCP-only: firings are stored on the receipt (`deliveryStatus: "stored"`).

## Secret handling

- The server generates the HMAC secret. It is a webhook signing key, **not** a wallet key.
- Shown once on create, refresh-with-rotate, and rotate. `GET` never returns it.
- Rotate with the current secret; keep the old secret only until consumers switch.
- Production without Redis fail-closes (create `503`, get `402 WATCH_UNAVAILABLE`).
- Keys live in Redis (`canix402:watch:{id}`) with TTL. Cron uses `canix402:watch:lock`.

`webhookUrl` must be `https` in production (localhost `http` is allowed in non-production for tests). Credentials in the URL are rejected. Private/loopback HTTPS targets are rejected in production.

## Agent usage

1. `canix_create_watch` (or `POST /watch`) with `address` + `thresholds` and optional `webhookUrl`.
2. Store the HMAC secret client-side. Verify `X-Canix-Signature` on callbacks.
3. Read recent firings from `canix_get_watch`, `canix://watch/{watchId}`, or `GET /watch/:id`.
4. Before TTL, `canix_refresh_watch`. On `WATCH_EXPIRED` / `WATCH_INVALID`, register again.
