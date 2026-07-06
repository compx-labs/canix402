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

**Important:** Do not build Caddy from `protocol/caddy/plugin/`. That directory
contains an AgentQuest example `Caddyfile` that proxies to `localhost:8787`
(`WORLD_UPSTREAM`), not the canix402 API (`UPSTREAM_API`).

### Caddy environment variables

See `protocol/caddy/.env.example`. Required for production:

```env
CADDY_SITE_ADDRESS=canix402-api.compx.io
UPSTREAM_API=http://<protocol-component-name>:3000
FACILITATOR_URL=https://facilitator.goplausible.xyz
X402_PAY_TO=<your-address>
X402_PRICE_AGGREGATE_USDC=0.01
X402_PRICE_SEARCH_USDC=0.01
X402_PRICE_PERSONALIZED_USDC=0.05
X402_PRICE_PROTOCOL_USDC=0.01
X402_NETWORK=algorand-mainnet
X402_SCHEME=exact
```

`UPSTREAM_API` must use the protocol component's **internal** hostname on App
Platform (for example `http://canix402-protocol:3000`), not `localhost`.

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
```

Expect `200` on health and `402` on opportunities.
