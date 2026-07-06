# canix402 monorepo

x402-gated Algorand DeFi opportunities platform.

This repository contains two workspaces:

- [`protocol/`](protocol/) — Fastify API, Caddy x402 gateway config, adapters, tests, and protocol docs
- [`website/`](website/) — Astro static onboarding site for agent setup

## Quick start

```sh
npm install
```

### Protocol API

```sh
npm run dev:protocol
npm run build:caddy-x402
npm run dev:caddy -w protocol
npm run test:protocol
```

Protocol docs:

- [Project Overview](protocol/docs/project-overview.md)
- [Development Checklist](protocol/docs/development-checklist.md)
- [Testing Guide](protocol/docs/testing.md)
- [Caddy Gateway Setup](protocol/caddy/README.md)

### Website

```sh
npm run dev:website
npm run build:website
npm run preview -w website
```

Copy `website/.env.example` to `website/.env` for local gateway/discovery URLs.

## Validation

```sh
npm run check
```

Runs protocol typecheck, Caddy build, protocol tests (including x402 E2E), website typecheck, and website build.

## Layout

```text
canix402/
  protocol/   # API + gateway + adapters
  website/    # Astro onboarding site
```
