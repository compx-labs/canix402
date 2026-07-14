# DigitalOcean App Platform — deployment notes

## Protocol service (internal)

| Setting | Value |
|---------|-------|
| Source directory | `protocol` |
| Dockerfile path | `Dockerfile` |
| Internal port | `3000` |
| Public route | **None** |

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
X402_PRICE_POSITIONS_USDC=0.005
X402_PRICE_PROTOCOL_USDC=0.01
X402_PRICE_EXECUTION_QUOTE_USDC=0.1
X402_NETWORK=algorand-mainnet
X402_SCHEME=exact
```

The **protocol** (internal API) component should also set
`X402_PRICE_POSITIONS_USDC=0.005` and `X402_PRICE_EXECUTION_QUOTE_USDC=0.1` so
discovery/OpenAPI metadata matches the Caddy gate (see
[`protocol/.env.example`](../.env.example)).

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
curl -s -o /dev/null -w "%{http_code}\n" https://canix402-api.compx.io/opportunities
curl -s -o /dev/null -w "%{http_code}\n" "https://canix402-api.compx.io/positions?address=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ"
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://canix402-api.compx.io/execution/quotes \
  -H "content-type: application/json" \
  -d '{"shapeKey":"mainnet:tinyman:v2:addLiquidity:flexible","input":{"userAddress":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ","assetAId":31566704,"assetAAmount":"1000000","assetBId":0,"assetBAmount":"1000000","maxSlippageBps":50}}'
```

Expect `200` on health and `402` on paid routes. The `/positions` preflight must
advertise `5000` micro-USDC in `PAYMENT-REQUIRED`.
