# canix402 protocol API

x402-gated Algorand DeFi opportunities data API.

This package lives in the `protocol/` workspace of the canix402 monorepo.

## Documentation

- [Project Overview](docs/project-overview.md)
- [Development Checklist](docs/development-checklist.md)
- [Testing Guide](docs/testing.md)
- [Caddy Gateway Setup](caddy/README.md)
- [Data Source Docs](docs/data-sources/README.md)

## Scripts

From repo root:

```sh
npm run dev:protocol
npm run typecheck:protocol
npm run build:caddy-x402
npm run test:protocol
```

From this directory:

```sh
npm run dev
npm run test
npm run test:x402-e2e
```

## Discovery snapshot export

Refresh the website fallback discovery snapshot:

```sh
npx tsx scripts/export-discovery-snapshot.ts
```
