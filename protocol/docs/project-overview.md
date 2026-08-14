# x402 Algorand DeFi Opportunities - Project Overview

## Purpose

This project provides an x402-only data source for DeFi opportunities on Algorand.

It replaces the earlier public standalone APR/APY website model with a paid API model where consumers pay in USDC via x402-gated endpoints to access structured opportunity data.

## Goals

- Deliver reliable, normalized APR/APY opportunity data across selected Algorand DeFi protocols.
- Gate data access behind x402 payments in USDC.
- Start lean with on-demand data retrieval during early development.
- Evolve toward low-latency, cache-backed delivery once endpoint behavior stabilizes.

## Non-Goals (Initial Phase)

- No public unauthenticated data-browsing interface (the planned onboarding site is documentation only, not a free APR/APY explorer).
- No persistent storage requirement in the first development iteration.
- No full analytics warehouse in v1.

## Target Protocols

Initial protocol coverage:

- Tinyman
- Pact
- Folks Finance
- CompX
- Dork.fi

## Access and Monetization Model

- API endpoints are protected by x402 payment requirements.
- Payments are denominated in USDC.
- Integration baseline:
  - GoPlausible x402 facilitator
  - Nodely Caddy implementation

Gateway configuration ownership:

- Each x402 integration keeps its own project-specific Caddyfile and run wiring.
- In this repo, runtime gateway config lives under `caddy/`.
- The Caddy x402 Go module source lives directly under `caddy/` alongside the
  production Caddyfile and Dockerfile.

This allows standard HTTP API usage while ensuring requests are authorized only after successful x402 payment flow.

## Technical Baseline

- Runtime: Node.js
- Language: TypeScript
- Product shape: API-first backend service
- Primary output: normalized JSON datasets for DeFi opportunities

## Data Acquisition Strategy

Data is sourced from:

- Public APIs offered by Algorand DeFi applications.
- Official SDKs where API coverage is incomplete or absent.
- Internal CompX data for CompX-specific metrics and opportunity details.

Each protocol adapter should document:

- Source endpoint or SDK call path
- Polling or retrieval constraints
- Field-level mappings into the normalized model
- Known caveats (rate limits, delayed updates, missing fields)

Current adapter implementation status:

- Supported at runtime: Tinyman, Pact, Folks Finance, CompX, Dork.fi
- Protocol docs index: `docs/data-sources/README.md`

## Normalized Opportunity Data Model (V1)

The canonical normalized schema is documented in
`docs/normalized-opportunity-schema.md`.

`OpportunityRecordV1` is now the stable contract surface for opportunities
responses and OpenAPI publication. The contract includes required
`yieldBasis` metadata and optional `assetIds`, and explicitly defers
`rewards`/`market`/`tvlOrLiquidity` to future schema revisions.

### Decimals and Precision

- Asset decimals are always resolved on-chain from algod (`getAssetByID`) via the
  shared `resolveAssetDecimals` service; native ALGO (asset id `0`) is hardcoded to
  6. There is no implicit decimal fallback anywhere in the adapters.
- Yield/USD outputs (`apy`, `apr`, `tvlUsd`) are formatted for agents at the
  response boundary with a standard precision of 6 decimal places, extended up to
  12 places only when needed for small non-zero values. The contract is published
  via the `x-precision` extension in `/openapi.json`.

## Storage and Caching Strategy

### Phase 1 (Current): On-Demand, No Persistent Storage

- Fetch data on request from protocol APIs/SDKs.
- Normalize and return response immediately.
- Keep implementation simple to validate endpoint contracts and consumer needs.

Trade-offs:

- Higher request latency.
- Greater exposure to upstream API instability or rate limits.
- Potential duplicate fetch costs under load.

### Phase 2 (Planned): Redis-Backed Caching

- Introduce Redis (or similar in-memory store) as a shared cache layer.
- Cache normalized protocol snapshots with protocol-specific TTLs.
- Serve from cache first, refresh in background or on expiry.

Expected benefits:

- Lower response latency.
- Reduced upstream dependency pressure.
- More predictable paid endpoint performance.

## API Direction (Initial)

Planned endpoint families (exact contracts to be defined during implementation):

- Aggregated opportunities endpoint across all protocols
- Protocol-specific opportunities endpoint
- Caller-filtered opportunities endpoint (`/opportunities/search`)
- Wallet-personalized opportunities endpoint (`/opportunities/personalized`)
- Wallet DeFi positions endpoint (`/positions?address=`)
- Health/metadata endpoints (non-paid where appropriate)
- Discovery endpoints (`/discovery`, `/openapi.json`) for agents and marketplaces

x402 gating should be applied consistently to paid data endpoints.

### Wallet-Personalized Opportunities (`GET /opportunities/personalized`)

A premium paid route (0.05 USDC) that tunes results to a specific wallet:

- Caller supplies an Algorand `address` query parameter.
- The service reads the account's holdings from algod and treats an asset as "held"
  when its balance is greater than 0. Opted-in ASAs and native ALGO (asset id `0`)
  both count.
- Opportunities are matched by exact on-chain asset id. To support this,
  `OpportunityRecordV1` carries an optional `assetIds` array populated by each adapter
  (Tinyman/Pact pool asset ids, Folks Finance pool asset id).
- An opportunity is included when the wallet holds any of its underlying assets
  **and** it passes `POST /eligibility` rules (min amount, ASA gates, capacity,
  no unresolved NFD/creator gates). Full or gated venues are not recommended as
  enterable. Each row includes `canEnter` and `eligibilityFullyCheckable`;
  `meta.eligibilityEndpoint` is `/eligibility`. Quote-time checks remain
  authoritative.
- Pricing is configured independently via `X402_PRICE_PERSONALIZED_USDC` in both the
  API discovery metadata and the Caddy accept policy.

### Eligibility (`POST /eligibility`)

A paid wallet research route priced at 0.01 USDC. Compiling enters remains the
compiler SKU (`POST /execution/quotes`, ~0.10 USDC flat per request).

- Body: `{ address, opportunityIds, refresh? }` (1–25 ids).
- Response rows: `{ canEnter, missingAssets, gates, capacity, suggestedSwap,
  eligibilityFullyCheckable, reasons }`.
- Réti `entryRequirements` / `capacity` are resolved (min amount, ASA gates,
  staker slots, ALGO room) before quote.
- NFD / creator gates are published as `unresolved`. `canEnter` is never true
  until `eligibilityFullyCheckable` is true.
- `suggestedSwap` is a hint only (not a live Haystack quote). Use `POST /swaps/quote`.
- Discovery and OpenAPI advertise `maxAmountRequired: "0.01"`. Caddy enforces
  `X402_PRICE_ELIGIBILITY_USDC=0.01` (10000 micro-USDC).
- MCP: `canix_check_eligibility`.

### Wallet Positions (`GET /positions?address=`)

A paid wallet data route priced at exactly 0.005 USDC:

- Caller supplies a required Algorand `address` query parameter.
- One authenticated indexer lookup supplies the wallet's ASA balances and
  application local state to every protocol collector.
- Collectors run sequentially. Tinyman queries only liquidity-token ids held by
  the wallet; Pact maps held LP tokens and wallet-local farm app ids against a
  short-lived protocol metadata cache before making any on-chain farm calls.
- The response normalizes supplied, LP, staked, reward, and debt positions found
  across Tinyman, Pact, Folks Finance, CompX, Dork.fi, and Myth Finance.
  CompX, Folks, and Dork.fi emit executable borrow/debt rows when present.
  Base-unit and decimal token amounts are strings to preserve precision.
- Every protocol reports `ok`, `partial`, or `unavailable`. Partial upstream
  failures do not discard successful protocol data; the route returns `502` only
  when all five sources are unavailable.
- USD totals cover supplied value, rewards, and net value (`borrowedUsd` stays
  complete). A `null` total
  means its coverage or pricing is incomplete and must not be interpreted as zero.
- Discovery and OpenAPI advertise the route as paid with `maxAmountRequired: "0.005"`.
- Caddy enforces `X402_PRICE_POSITIONS_USDC=0.005`, which is encoded as `5000`
  micro-USDC in `PAYMENT-REQUIRED`.
- A separate free showcase route `GET /public/agents/brownie/positions` returns
  the same response shape for the Brownie Bot treasury wallet only (hardcoded
  address; not a general free positions browser).

### Claim desk (`GET /positions/claimable?address=`)

A paid wallet research route priced at exactly 0.001 USDC. Compiling claims
remains the compiler SKU (`POST /execution/quotes`, ~0.10 USDC flat per request).

- Discovery and OpenAPI advertise the route as paid with `maxAmountRequired: "0.001"`.
- Caddy enforces `X402_PRICE_POSITIONS_CLAIMABLE_USDC=0.001`, encoded as `1000`
  micro-USDC in `PAYMENT-REQUIRED`.

- Projects existing reward rows (plus Tinyman stALGO manage claim) into a desk
  with USD value, conservative network-fee hints, `worthClaiming`, allowlisted
  claim `shapeKey`s, and ready-to-POST `quote` inputs.
- `claimAllQuotes.quotes` is deduped by `claimKey` (Haystack USDC+HAY and Pact
  multi-ASA farm rewards share one compile entry each).
- Supported claim shapes: Tinyman farm, Tinyman stALGO, CompX staking, Pact farm,
  Haystack, Alpha Arcade. Pass `claimAllQuotes` (or a selected subset) to
  `POST /execution/quotes`; groups are never merged.
- Agent loop: optional `/positions` → `/positions/claimable` → filter →
  `/execution/quotes` → local sign/submit. Canix never holds keys.
- Fee/worth-claiming hints compare reward USD to estimated network fees only —
  they are not a simulation (see §13.6).

## Discovery Contract (Grade A)

The API publishes two free discovery surfaces:

- `GET /discovery`: canonical machine-readable catalog for agent and directory indexing.
- `GET /openapi.json`: OpenAPI contract for client/tooling generation.

Discovery guarantees:

- `apiVersion` and `discoveryVersion` are explicit in discovery documents.
- Endpoint inventory is shared across runtime policy, discovery output, and OpenAPI.
- Paid endpoints include x402 metadata:
  - protocol version
  - required payment headers
  - requirement template (`scheme`, `network`, `asset`, `payTo`, `maxAmountRequired`)
- Error catalog includes stable machine-readable payment and validation codes.

### Agent Onboarding Sequence

1. Read `/discovery` to learn endpoints and payment policy.
2. Read `/openapi.json` for detailed operation schemas.
3. Call free endpoints (`/health`, `/metadata`, discovery endpoints) directly.
4. Call paid endpoints and follow x402 negotiation (`PAYMENT-REQUIRED` -> `PAYMENT-SIGNATURE` -> `PAYMENT-RESPONSE`).

## Agent Onboarding Website

Machine-readable discovery (`/discovery`, `/openapi.json`) is the source of truth for agents. A human-facing Astro website lives in the monorepo at `website/` so developers and operators can set up an agent without reading repo docs first.

Intent:

- Provide a single entry point for canix402 setup: supported protocols, endpoints, pricing, and x402 payment flow.
- Link directly to live discovery/OpenAPI URLs and copy-paste examples for a first paid call.
- Be linked from the main [compx.io](https://compx.io) site.
- Likely hosted as a subdomain on the compx.io domain (e.g. `canix402.compx.io`; exact subdomain TBD).

Monorepo layout:

- `protocol/` — API, Caddy gateway, adapters, tests, and protocol docs
- `website/` — Astro static onboarding site with CANIX402 branding

The site is documentation and onboarding only. Paid data access remains API-only via x402; the website does not expose unauthenticated opportunity browsing.

Execution status: tracked in `docs/development-checklist.md` section 11. Local build/deploy notes: `website/README.md`.

## Operational Expectations

- Define clear freshness targets per protocol.
- Track adapter health and upstream failures with structured logs/metrics.
- Return transparent metadata about staleness and source fetch timing.
- Keep protocol adapters modular to simplify adding new platforms later.

## Source-Of-Truth Rules

This document is the architecture and product intent source of truth.

When decisions are made:

1. Update this document first for durable direction.
2. Update the development checklist second for execution status.

## Open Decision Log

Use this section to record major decisions as the project evolves.

- 2026-06-17: Initial strategy set to on-demand fetching without persistent storage for v1.
- 2026-06-17: Redis chosen as the preferred first cache implementation path for v2.
- 2026-06-17: Discovery strategy set to dual-surface (`/discovery` and `/openapi.json`) with shared endpoint policy source-of-truth.
- 2026-06-18: Caddy runtime configuration moved to project-owned `caddy/`; `infra/caddy` retired.
- 2026-07-07: Caddy x402 Go module source flattened into `caddy/` so App Platform can build the gateway from one self-contained source directory.
- 2026-06-22: Added wallet-personalized opportunities route (`/opportunities/personalized`, 0.05 USDC); opportunities enriched with optional on-chain `assetIds` and matched against algod-reported wallet holdings (balance greater than 0, including native ALGO).
- 2026-07-06: Planned agent onboarding website on compx.io subdomain; human-facing docs site for agent setup, linked from main compx.io property.
- 2026-07-06: Restructured repo into monorepo workspaces (`protocol/`, `website/`) and implemented Astro onboarding site with CANIX402 branding.
- 2026-07-07: Finalized `OpportunityRecordV1` contract for API `1.0.0` with required `yieldBasis`, optional `assetIds`, and a canonical schema spec in `docs/normalized-opportunity-schema.md`.
- 2026-08-14: Added paid `POST /eligibility` (0.01 USDC) and taught `/opportunities/personalized` to use the same eligibility rules so full/gated Réti venues are not recommended as enterable. NFD/creator gates stay unresolved (`eligibilityFullyCheckable: false`).
