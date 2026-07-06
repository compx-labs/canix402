# DigitalOcean App Platform — protocol service

The protocol package lives in an npm workspace monorepo. Runtime dependencies
(`fastify`, etc.) are installed at the **repo root** `node_modules/`, not under
`protocol/node_modules/`. Deploying with App Platform **source directory**
`protocol/` causes `npm start` to fail with:

```text
ERR_MODULE_NOT_FOUND: Cannot find package 'fastify'
```

Use one of the options below.

## Option A — Node buildpack from repo root (simplest)

In the App Platform component settings:

| Setting | Value |
|---------|-------|
| Source directory | `/` (repo root) |
| Build command | `npm ci && npm run build -w protocol` |
| Run command | `npm run start -w protocol` |
| HTTP port | `3000` |
| Environment slug | Node.js |

Keep the component **internal-only** (no public route). Caddy is the public
gateway and should set `UPSTREAM_API` to this service's internal URL.

## Option B — Dockerfile (recommended if you already use Docker for Caddy)

| Setting | Value |
|---------|-------|
| Source directory | `/` (repo root) |
| Dockerfile path | `protocol/Dockerfile` |
| HTTP port | `3000` |

Build locally:

```sh
docker build -f protocol/Dockerfile -t canix402-protocol .
docker run --rm -p 3000:3000 --env-file protocol/.env canix402-protocol
```

## Environment variables

Set protocol runtime env vars on this component (see `protocol/.env.example`).
Caddy/x402 vars belong on the Caddy component (`protocol/caddy/.env.example`).

## Health check

App Platform can probe `GET /health` on port 3000. That route is free (no x402)
at the Caddy edge and proxied through to the protocol service.
