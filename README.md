# canix402 monorepo

x402-gated DeFi opportunities platform for Algorand and Base. Agents may use either chain or both. An Algorand-only agent does not supply a Base address, and omitting one does not change rank, eligibility, price, or access.

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
npm run test:unit
npm run test:protocol
```

Protocol docs:

- [Project Overview](protocol/docs/project-overview.md)
- [Development Checklist](protocol/docs/development-checklist.md)
- [Testing Guide](protocol/docs/testing.md)
- [Caddy Gateway Setup](protocol/caddy/README.md)
- [Release notes](docs/release-notes/)

Query a wallet's DeFi positions directly from the protocol services:

```sh
npm run positions -- --address <Algorand address>
```

### Website

```sh
npm run dev:website
npm run build:website
npm run preview -w website
```

Copy `website/.env.example` to `website/.env` for local gateway/discovery URLs.

## License

MIT. Same text as other CompX labs public repos (`brownie-bot`, `staking-contracts`).
Copyright (c) 2026 Neon Forge Ltd.

GitHub detects the license from the root [`LICENSE`](LICENSE) file once the
repository is **public** (challenge rule). This repo is still private until a
human changes visibility in GitHub Settings.

## Validation

```sh
npm run check
```

Runs protocol typecheck, Caddy build, protocol tests (unit + API + x402 E2E), website typecheck, and website build.

## Layout

```text
canix402/
  protocol/   # API + gateway + adapters
  website/    # Astro onboarding site
```
