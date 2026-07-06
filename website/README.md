# canix402 website

Astro static onboarding site for agent setup with the canix402 x402-gated API.

## Local development

From repo root:

```sh
npm run dev:website
```

Or from this directory:

```sh
npm run dev
```

Copy `.env.example` to `.env` and set public gateway URLs:

```env
PUBLIC_GATEWAY_BASE_URL=http://localhost:8081
PUBLIC_DISCOVERY_URL=http://localhost:8081/discovery
PUBLIC_OPENAPI_URL=http://localhost:8081/openapi.json
```

## Build

```sh
npm run build
npm run preview
```

Static output is written to `dist/`.

## Discovery snapshot fallback

`/endpoints` tries live discovery at build/dev time. If unavailable, it falls back to
`src/data/discovery.snapshot.json`.

Refresh the snapshot from the protocol app:

```sh
npx tsx ../protocol/scripts/export-discovery-snapshot.ts
```

## Deployment (canix402.compx.io)

Recommended static hosting: Cloudflare Pages, Vercel, or existing CompX static host.

- **Build command:** `npm run build:website` (from repo root)
- **Publish directory:** `website/dist`
- **Production env vars:**
  - `PUBLIC_GATEWAY_BASE_URL=https://canix402.compx.io` (live Caddy gateway URL)
  - `PUBLIC_DISCOVERY_URL=https://canix402.compx.io/discovery`
  - `PUBLIC_OPENAPI_URL=https://canix402.compx.io/openapi.json`

After deploy:

1. Point DNS for `canix402.compx.io` (or chosen subdomain) to the static host.
2. Add a link from the main [compx.io](https://compx.io) site navigation/footer.
3. Verify `/`, `/quickstart`, `/endpoints`, and `/examples` render with live discovery links.

## Brand assets

- `public/brand/canix402-banner.png`
- `public/brand/canix402-mark.png`

The site uses a dark/red neon visual system aligned with the CANIX402 logo set.
