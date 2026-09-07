# Prepaid agent sessions

Exact-scheme one-shot x402 payments remain the default. Prepaid sessions are a
second money model for operators who would otherwise spray tiny USDC transfers
(for example Brownie’s daily research loop).

Sessions are **receipts, not keys**. Canix stays walletless: it never stores a
wallet mnemonic or signs.

## Contract

| Field | Default |
| --- | --- |
| Price | `0.25` USDC (`X402_PRICE_SESSIONS_USDC`) — same compiler band as `POST /plans` |
| Research budget N | `50` (`X402_SESSION_RESEARCH_BUDGET`) |
| Quotes/plans budget M | `10` (`X402_SESSION_QUOTE_BUDGET`) |
| TTL | `14400` seconds (4 hours, `X402_SESSION_TTL_SECONDS`) |
| Receipt URI | `canix://session/{sessionId}` |
| Header | `X-Canix-Session: {sessionId}` |

Token format: `csess_` + 32-byte hex.

## Routes

| Method | Path | Access |
| --- | --- | --- |
| `POST` | `/sessions` | Paid one-shot x402. Mints a receipt. |
| `POST` | `/sessions/refresh` | Paid one-shot x402. Resets N/M + TTL in place, or mints a new receipt. **Cannot** be paid with a session header. |
| `GET` | `/sessions/:sessionId` | Free receipt. Returns remaining N/M. Unknown (including Redis TTL-evicted ids) → `402 SESSION_INVALID`. Expired record still readable → `402 SESSION_EXPIRED`. Store down → `402 SESSION_UNAVAILABLE`. Exhausted-but-unexpired → `200` with `status: "exhausted"`. |

## Buckets

**Research** (counts against N): `/opportunities`, `/opportunities/search`, `/opportunities/personalized`, `/protocols/:protocol/opportunities`, `/positions`, `/positions/claimable`, `/eligibility`.

**Quotes** (counts against M): `/plans`, `/plans/rebalance`, `/execution/quotes`, `/execution/compose`, `/execution/simulate`, `/swaps/transactions`, `/swaps/folks/transactions`.

Create/refresh are never session-eligible.

## Enforcement

1. Caddy: if `X-Canix-Session` starts with `csess_` on a session-eligible path, skip x402 and proxy. Empty or whitespace headers do **not** skip payment. Create/refresh always require x402.
2. App `onRequest` hook: consume one unit from the matching bucket. Fail-closed:
   - unknown token → `SESSION_INVALID`
   - TTL elapsed → `SESSION_EXPIRED`
   - bucket empty → `SESSION_EXHAUSTED`
   - Redis/store unavailable → `SESSION_UNAVAILABLE` (create returns `503`)
3. Successful consumes attach `x-canix-session-remaining-research`, `x-canix-session-remaining-quotes`, and `x-canix-session-expires-at`.

A fake or expired header **bypasses Caddy x402**. The app then returns 402. To fall back to a one-shot, **omit the header** and retry with `PAYMENT-SIGNATURE`.

## Persistence

When `REDIS_URL` is set, receipts live in Redis (`canix402:session:{id}`) with a TTL. After Redis evicts the key, `GET` cannot distinguish expiry from an unknown id and returns `SESSION_INVALID`. Production without Redis fail-closes (create `503`, consume/get `402 SESSION_UNAVAILABLE`). Non-production falls back to an in-memory store for local/dev tests.

## Agent usage

1. `canix_create_session` (or `POST /sessions`) once per TTL.
2. Pass `sessionReceipt` / `X-Canix-Session` on research and quote tools.
3. Read remaining N/M from `canix_get_session`, `canix://session/{sessionId}`, or `GET /sessions/:id` — not the policy resource `canix://session` and not the public indexer `/transactions` showcase.
4. On `SESSION_EXPIRED` / `SESSION_EXHAUSTED` / `SESSION_INVALID`, drop the header and either refresh (`POST /sessions/refresh`) or pay per request.
