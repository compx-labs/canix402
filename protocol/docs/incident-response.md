# Incident response — degraded upstream / readiness

Short runbook for Canix protocol (`canix402-api` / internal protocol component).

## Symptoms

- App Platform readiness failing or flapping
- `GET /ready` returns `503` with `status: "not_ready"`
- Spike in HTTP `502` responses
- Partial or empty `/opportunities` (single-protocol degrade is expected; all-protocol failure is not)
- High `canix_adapter_requests_total{result="error"}` for one or more protocols
- Redis-related warnings in logs (`event: "redis_error"`) with `status: "degraded"` on `/ready`

## Quick checks

1. **Readiness body** (public gateway):

   ```sh
   curl -sS https://canix402-api.compx.io/ready | jq .
   ```

   - `algod.ok: false` → Algod / `X402_ALGOD_URL` problem (service not ready)
   - `redis.configured: true` and `redis.ok: false` → cache degraded only (still `200` / `degraded`)

2. **Liveness** (process up):

   ```sh
   curl -sS https://canix402-api.compx.io/health
   ```

3. **Metrics** (internal protocol component only, port `3000` — not on public Caddy):

   ```sh
   curl -sS http://<protocol-component>:3000/metrics | grep canix_
   ```

   Watch:
   - `canix_adapter_requests_total{result="error"}`
   - `canix_http_request_duration_seconds`
   - `canix_cache_ops_total{result="error"}`

4. **Logs** (DigitalOcean App Platform → protocol component): pino JSON fields
   - `event: "adapter_degraded"` + `protocol`
   - `event: "redis_error"`
   - `statusCode: 502` / `500` from the error handler

5. **Upstream**: check Tinyman / Pact / Folks / CompX / Dork.fi / Myth / Haystack / Réti status and rate limits if one adapter dominates errors.

## Actions

| Finding | Action |
|---------|--------|
| Algod down / timeout | Verify `X402_ALGOD_URL` / `X402_ALGOD_TOKEN`; switch provider if needed; wait for readiness to recover |
| Redis errors / degraded | Confirm Canix DB index + `canix402:` keys; set `OPPORTUNITIES_CACHE_DISABLED=1` temporarily if cache is poisoned or Redis is unavailable |
| Single adapter failing | Expected degrade via `Promise.allSettled`; monitor until upstream recovers; no full outage |
| All adapters failing | Treat as sev-1 data outage; check shared egress / DNS / API keys |
| Latency spike on quotes/positions | Check Algod and protocol SDKs; scale/restart protocol component if process-bound |

## Suggested alert thresholds (document only — wire in DO/Grafana)

- Readiness (`/ready`) non-200 for **2+ consecutive** probe intervals
- Any protocol with adapter error rate **> 50% for 5 minutes**
- HTTP p95 (`canix_http_request_duration_seconds`) **> 5s** for 5 minutes on `/opportunities` or `/execution/quotes`
- Sustained rise in `502` responses

## Escalation

- CompX / Canix on-call: _(fill in team contact)_
- Include `/ready` JSON, recent `adapter_degraded` log lines, and affected protocols in the handoff

## Recovery confirmation

- `GET /ready` → `200` with `status: "ready"` (or accepted `degraded` if Redis still optional/soft-failing)
- Adapter error counters stabilize
- Spot-check `GET /opportunities` preflight (`402`) and a free discovery path (`200`)
