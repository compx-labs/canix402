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
PUBLIC_MCP_URL=https://canix402-mcp.compx.io/mcp
PUBLIC_MCP_WELL_KNOWN_URL=https://canix402-mcp.compx.io/.well-known/mcp
```

## Build

```sh
npm run build
npm run preview
```

Static output is written to `dist/`.

## LLM discoverability (`llms.txt`)

Build and dev runs generate two plain-text files into `public/` (copied to `dist/`):

- `/llms.txt` — curated index per [llmstxt.org](https://llmstxt.org)
- `/llms-full.txt` — self-contained integration guide with endpoint table and trimmed samples

Regenerate manually:

```sh
npm run generate:llms
```

Source data: `src/data/discovery.snapshot.json` and sample payloads under `src/data/`. Refresh discovery first when endpoints or prices change:

```sh
npm run snapshot:discovery
```

The API x402 manifest exposes `llmsTxtUrl` pointing at the live docs site file.

## Discovery snapshot fallback

`/endpoints` tries live discovery at build/dev time. If unavailable, it falls back to
`src/data/discovery.snapshot.json`.

Refresh the snapshot from the protocol app:

```sh
npx tsx ../protocol/scripts/export-discovery-snapshot.ts
```

## Sample response payloads

`/examples` renders illustrative sample response payloads for the paid opportunity
routes from checked-in JSON under `src/data`:

- `opportunities.sample.json` (`GET /opportunities`)
- `opportunities-search.sample.json` (`GET /opportunities/search`)
- `opportunities-personalized.sample.json` (`GET /opportunities/personalized`)
- `protocol-opportunities.sample.json` (`GET /protocols/{protocol}/opportunities`)

These are illustrative snapshots of the normalized response contract, not live paid
data. They are generated through the protocol's precision formatter so numeric values
honor the published precision contract (6 dp standard, up to 12 dp for small non-zero
values). The same payloads are mirrored as examples in the OpenAPI document.

Regenerate them from the protocol package:

```sh
npm run snapshot:responses
```

## Deployment (canix402.compx.io)

Recommended static hosting: Cloudflare Pages, Vercel, or existing CompX static host.

- **Build command:** `npm run build:website` (from repo root)
- **Publish directory:** `website/dist`
- **Production env vars:**
  - `PUBLIC_GATEWAY_BASE_URL=https://canix402-api.compx.io` (live Caddy gateway URL)
  - `PUBLIC_DISCOVERY_URL=https://canix402-api.compx.io/discovery`
  - `PUBLIC_OPENAPI_URL=https://canix402-api.compx.io/openapi.json`
  - `PUBLIC_MCP_URL=https://canix402-mcp.compx.io/mcp` (remote MCP endpoint)
  - `PUBLIC_MCP_WELL_KNOWN_URL=https://canix402-mcp.compx.io/.well-known/mcp`

After deploy:

1. Point DNS for `canix402.compx.io` (or chosen subdomain) to the static host.
2. Add a link from the main [compx.io](https://compx.io) site navigation/footer.
3. Verify `/`, `/quickstart`, `/endpoints`, and `/examples` render with live discovery links.

## Brand assets

- `public/brand/canix402-banner.png`
- `public/brand/canix402-mark.png`

The site uses a dark/red neon visual system aligned with the CANIX402 logo set.
