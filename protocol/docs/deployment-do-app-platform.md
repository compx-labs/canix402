# DigitalOcean App Platform — deployment notes

## Protocol service (internal)

| Setting | Value |
|---------|-------|
| Source directory | `protocol` |
| Dockerfile path | `Dockerfile` |
| Internal port | `3000` |
| Public route | **None** |
| Health check path | `/ready` (readiness; Algod required, Redis soft) |
| Liveness | `/health` (process up) |

Scrape Prometheus metrics from the **internal** protocol component at
`http://<protocol-component>:3000/metrics`. Do **not** expose `/metrics` on the
public Caddy gateway.

## Caddy gateway (public)

| Setting | Value |
|---------|-------|
| Source directory | `protocol/caddy` |
| Dockerfile path | `Dockerfile` |
| HTTP port | `8080` (or your configured public port) |

The Caddy component is intentionally self-contained: the x402 Go module source,
production Dockerfile, and production `Caddyfile` all live in `protocol/caddy/`.

### Caddy environment variables

See [`protocol/caddy/.env.example`](../caddy/.env.example). **Every** `X402_PRICE_*`
variable in that file is required on the Caddy App Platform component. If one is
missing, Caddy exits on startup with a Caddyfile parse error on the empty `price`
directive (for example at `/execution/quotes` when
`X402_PRICE_EXECUTION_QUOTE_USDC` is unset).

Required for production:

```env
CADDY_SITE_ADDRESS=:8080
UPSTREAM_API=http://<protocol-component-name>:3000
FACILITATOR_URL=https://facilitator.goplausible.xyz
X402_PAY_TO=<your-address>
X402_PRICE_AGGREGATE_USDC=0.01
X402_PRICE_SEARCH_USDC=0.01
X402_PRICE_PERSONALIZED_USDC=0.05
X402_PRICE_ELIGIBILITY_USDC=0.01
X402_PRICE_PLANS_USDC=0.25
X402_PRICE_POSITIONS_USDC=0.005
X402_PRICE_POSITIONS_CLAIMABLE_USDC=0.001
X402_PRICE_PROTOCOL_USDC=0.01
X402_PRICE_EXECUTION_QUOTE_USDC=0.1
X402_PRICE_EXECUTION_COMPOSE_USDC=0.1
X402_NETWORK=algorand-mainnet
X402_SCHEME=exact
```

The **protocol** (internal API) component should also set
`X402_PRICE_POSITIONS_USDC=0.005`, `X402_PRICE_POSITIONS_CLAIMABLE_USDC=0.001`,
`X402_PRICE_ELIGIBILITY_USDC=0.01`,
`X402_PRICE_PLANS_USDC=0.25`,
and `X402_PRICE_EXECUTION_QUOTE_USDC=0.1`,
`X402_PRICE_EXECUTION_COMPOSE_USDC=0.1` so discovery/OpenAPI metadata matches
the Caddy gate (see [`protocol/.env.example`](../.env.example)).

### Redis (opportunity cache)

Optional. When `REDIS_URL` is set on the **protocol** component, aggregated
opportunity adapters are cached (`OPPORTUNITIES_CACHE_TTL_SEC`, default **180s /
3 minutes** — DeFi APR/TVL does not need sub-minute churn). List responses include
informational cache meta (`cacheEnabled`, `cacheHit`, `cachedAt`, `cacheAgeMs`,
`cacheTtlSec`) with no harsh `stale` flag. Pass `refresh=true` on opportunity
routes to bypass Redis and refetch (still writes a fresh cache entry). Isolation
from CompX/Orbital on a shared Redis instance:

- Dedicated DB index in the URL (e.g. `redis://:password@host:6379/6`)
- All keys use the `canix402:` prefix (e.g. `canix402:opportunities:protocol:mainnet:tinyman`)
- Leave `REDIS_URL` unset or set `OPPORTUNITIES_CACHE_DISABLED=1` for local/dev without cache

Never `FLUSHALL` on a shared Redis instance; `FLUSHDB` only against Canix’s DB.

### Weekly fee harvest

In-process cron on the **protocol** component. When `RECEIVER_MNEMONIC` is set,
every Wednesday 00:00 UTC the API floors the pay-to USDC balance to whole units
and sends 30/30/40 to the hardcoded fee recipients as an atomic axfer group.
Production must also have `REDIS_URL` (already used for opportunity cache) for
the harvest lock (`canix402:fee-harvest:lock`). If Redis is unavailable, the run
is skipped so multi-instance deploys do not double-send.

`UPSTREAM_API` must use the protocol component's **internal** hostname on App
Platform (for example `http://canix402-protocol:3000`), not `localhost`.

`CADDY_SITE_ADDRESS` should bind to the container port (`:8080`) rather than the
public domain. DigitalOcean and Cloudflare handle the external hostname and TLS
before traffic reaches the container.

### DO routing

Add a component routing rule:

- Domain: `canix402-api.compx.io`
- Path: `/`
- Component: Caddy

Website stays on `canix402.compx.io` → website component.

## Verify after deploy

```sh
curl -s https://canix402-api.compx.io/health
curl -s https://canix402-api.compx.io/ready
curl -s -o /dev/null -w "%{http_code}\n" https://canix402-api.compx.io/opportunities
curl -s -o /dev/null -w "%{http_code}\n" "https://canix402-api.compx.io/positions?address=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ"
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://canix402-api.compx.io/execution/quotes \
  -H "content-type: application/json" \
  -d '{"shapeKey":"mainnet:tinyman:v2:addLiquidity:flexible","input":{"userAddress":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ","assetAId":31566704,"assetAAmount":"1000000","assetBId":0,"assetBAmount":"1000000","maxSlippageBps":50}}'
```

Expect `200` on health and ready, and `402` on paid routes. The `/positions` preflight must
advertise `5000` micro-USDC in `PAYMENT-REQUIRED`.

For degraded upstream / readiness incidents, see
[`incident-response.md`](incident-response.md).
