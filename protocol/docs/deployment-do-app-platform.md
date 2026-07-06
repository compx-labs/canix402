# DigitalOcean App Platform — protocol service

## Docker deploy (recommended)

The protocol Dockerfile is **self-contained** — it installs dependencies directly
from `protocol/package.json` and does not rely on the monorepo workspace root.

| Setting | Value |
|---------|-------|
| Source directory | `protocol` |
| Dockerfile path | `Dockerfile` |
| HTTP port | `3000` |
| Public route | **None** (internal only) |

Build locally:

```sh
docker build -t canix402-protocol protocol/
docker run --rm -p 3000:3000 --env-file protocol/.env canix402-protocol
```

## Node buildpack alternative

If not using Docker, deploy from the **repo root** so npm workspaces resolve:

| Setting | Value |
|---------|-------|
| Source directory | `/` (repo root) |
| Build command | `npm ci && npm run build -w protocol` |
| Run command | `npm run start -w protocol` |
| HTTP port | `3000` |

Deploying the buildpack with source directory `protocol/` fails with
`ERR_MODULE_NOT_FOUND: Cannot find package 'fastify'` because runtime deps are
hoisted to the root `node_modules/`.

## Environment variables

Set protocol runtime env vars on this component (see `protocol/.env.example`).
Caddy/x402 vars belong on the Caddy component (`protocol/caddy/.env.example`).

Caddy should set `UPSTREAM_API` to this service's **internal** App Platform URL.

## Health check

App Platform can probe `GET /health` on port 3000. That route is free (no x402)
at the Caddy edge and proxied through to the protocol service.
