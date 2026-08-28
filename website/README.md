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

`/examples` renders illustrative sample response payloads for opportunity,
positions, execution, and swap routes from checked-in JSON under `src/data`:

- `opportunities.sample.json` (`GET /opportunities`)
- `opportunities-search.sample.json` (`GET /opportunities/search`)
- `opportunities-personalized.sample.json` (`GET /opportunities/personalized`)
- `eligibility.sample.json` (`POST /eligibility`)
- `plans.sample.json` (`POST /plans`)
- `rebalance.sample.json` (`POST /plans/rebalance`)
- `simulate.sample.json` (`POST /execution/simulate`)
- `compose.sample.json` (`POST /execution/compose`)
- `protocol-opportunities.sample.json` (`GET /protocols/{protocol}/opportunities`)
- `positions.sample.json` (`GET /positions`)
- `positions-claimable.sample.json` (`GET /positions/claimable`)
- `execution-shapes.sample.json` (`GET /execution/shapes`)
- `execution-quotes.sample.json` (`POST /execution/quotes`)
- `swaps-quote.sample.json` (`POST /swaps/quote`)
- `swaps-optin.sample.json` (`POST /swaps/optin`)
- `swaps-transactions.sample.json` (`POST /swaps/transactions`)

These are illustrative snapshots of the normalized response contract, not live paid
data. They are generated through the protocol's precision formatter so numeric values
honor the published precision contract (6 dp standard, up to 12 dp for small non-zero
values). The same payloads are mirrored as examples in the OpenAPI document.

Regenerate them from the protocol package:

```sh
npm run snapshot:responses
```

## WebMCP demo (`/webmcp`)

The `/webmcp` route registers the existing Canix MCP tools with the WebMCP
imperative API (`document.modelContext.registerTool`, with
`navigator.modelContext` as a deprecated alias). The page shows the same tool
list a WebMCP agent would discover. `execute` calls the live gateway and fails
closed with machine-readable `PAYMENT_REQUIRED` / `SESSION_*` JSON. Origin
isolation is required (`Permissions-Policy: tools=(self), document-domain=()`);
the page never assigns `document.domain`.

Local Chrome: enable `chrome://flags/#enable-webmcp-testing`.

## Deployment (canix402.compx.io)

The live site is a **DigitalOcean App Platform** static website behind Cloudflare
(`x-do-app-origin` on responses). It is not Cloudflare Pages, so `public/_headers`
is copied into `dist/` as a file and does **not** automatically become HTTP headers.

- **Public URL:** https://canix402.compx.io/webmcp (no login wall)
- **Build command:** `npm run build:website` (from repo root)
- **Publish directory:** `website/dist`
- **Production env vars:** keep the existing `PUBLIC_*` gateway / MCP URLs the website component already uses.

`/webmcp` is in this branch. Production still 404s until the website component is
rebuilt from a git ref that contains it. This agent cannot merge PR 95 or trigger
App Platform.

### Human steps to ship `/webmcp` (NEO-308)

1. Merge [PR 95](https://github.com/compx-labs/canix402/pull/95) `webmcp` → `dev`.
2. If the website component tracks `main`, merge `dev` → `main` as you usually promote the site.
3. In DigitalOcean App Platform, **Force rebuild and deploy** the **website** component (same app that already serves `canix402.compx.io`; last static objects were dated 17 Aug 2026).
4. Cloudflare already proxies TLS. Add a Configuration / Transform Rule for hostname `canix402.compx.io` and URI Path starting with `/webmcp`:
   - `Permissions-Policy: tools=(self), document-domain=()`
   - `Origin-Agent-Cluster: ?1`
5. Verify (no login):
   ```sh
   curl -sS -o /dev/null -w "%{http_code}\n" https://canix402.compx.io/webmcp
   ```
   Expect `200`. Open the URL in Chrome with `chrome://flags/#enable-webmcp-testing` or ChatGPT’s in-app browser.
6. Make `compx-labs/canix402` **public** (GitHub Settings → Change repository visibility) so judges can see the MIT `LICENSE`.

Checkout and execute on `/webmcp` already call the live Caddy gateway. After the static deploy, humans and agents use that same production host.

After deploy:

1. Confirm `/webmcp` is linked from the site header (already in this branch).
2. Verify `/`, `/quickstart`, `/endpoints`, `/mcp`, and `/webmcp` render.

## Brand assets

- `public/brand/canix402-banner-v2.png` (1200×630 OG/social banner)
- `public/brand/canix402-mark-v2.png` (square logo)
- Legacy aliases: `canix402-banner.png`, `canix402-mark.png` (same bytes)

The site uses a dark charcoal / red DeFi-native visual system with Inter Tight as the primary UI font and JetBrains Mono reserved for code, paths, and transaction identifiers.
