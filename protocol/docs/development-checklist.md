# x402 Algorand DeFi Data API - Development Checklist

This checklist tracks implementation progress for the x402-gated Algorand DeFi opportunities API.

Status legend:

- [ ] Not started
- [~] In progress
- [x] Done

## 1) Documentation and Project Setup

- [x] Create living project overview document (`docs/project-overview.md`).
- [x] Create living development checklist (`docs/development-checklist.md`).
- [x] Initialize Node.js + TypeScript project scaffolding.
- [x] Define environment variable contract (`.env.example`) for x402, USDC, and upstream API configs.
- [x] Define baseline folder structure (`src/adapters`, `src/services`, `src/routes`, `src/types`).

## 2) API Skeleton (Node.js/TypeScript)

- [x] Choose HTTP framework and set up base server.
- [x] Add typed route modules for:
  - [x] Aggregated opportunities
  - [x] Protocol-specific opportunities
  - [x] Caller-filtered opportunities (`GET /opportunities/search`)
  - [x] Wallet-personalized opportunities (`GET /opportunities/personalized`)
  - [x] Health/metadata
- [x] Add shared error model and response envelope format.
- [x] Add runtime validation for inbound query parameters.

## 3) x402 Payment Gating

- [x] Integrate GoPlausible x402 facilitator into API request flow.
- [x] Configure USDC-denominated payment requirements for paid endpoints.
- [x] Integrate Nodely Caddy implementation for gateway behavior.
- [x] Move runtime gateway config to project-owned `caddy/Caddyfile` (separate from example/plugin repo).
- [x] Define paid vs non-paid endpoint policy matrix.
- [x] Split Caddy paid routes into separate blocks to support per-endpoint pricing.
- [x] Add separate Caddy env vars for endpoint-specific prices.
- [x] Add premium-priced wallet-personalized route (`/opportunities/personalized`, 0.05 USDC).
- [x] Align Caddy test harness env with per-route pricing vars (`tests/helpers/caddyHarness.ts`, `tests/live/x402-live.test.ts`).
- [x] Add integration tests for:
  - [x] Successful paid request
  - [x] Missing/invalid payment flow
  - [x] Expired or malformed payment proof

## 4) Protocol Data Source Research and Adapters

- [x] Tinyman adapter (API/SDK mapping + normalization).
- [x] Pact adapter (API/SDK mapping + normalization).
- [x] Folks Finance adapter (API/SDK mapping + normalization).
- [x] CompX adapter (SDK mapping + normalization).
- [x] Dork.fi adapter (API mapping + normalization).
- [x] For each adapter, document in `docs/data-sources/`:
  - [x] Tinyman
  - [x] Pact
  - [x] Folks Finance
  - [x] CompX
  - [x] Dork.fi

## 5) Data Normalization and Contract Definition

- [x] Finalize normalized opportunity schema (`protocol`, `opportunityType`, `apr`, `apy`, `yieldBasis`, etc.; see `docs/normalized-opportunity-schema.md`).
- [x] Implement adapter-to-normalized model transformers (all supported protocols).
- [x] Standardize decimals/precision rules across protocols.
  - [x] Resolve all asset decimals from chain via algod (`resolveAssetDecimals`); ALGO hardcoded to 6; no `?? 6` fallbacks.
  - [x] Cache + bounded-concurrency decimal lookups; drop rows with unresolvable decimals.
  - [x] Agent-facing output precision (default 6, max 12 decimal places) at the response boundary (`formatOpportunitiesForAgent`); contract published via `x-precision` in OpenAPI.
- [x] Include source metadata (`sourceTimestamp`, `fetchedAt`, confidence/caveat notes).
- [x] Publish sample response payloads for consumers.

## 6) Initial Delivery Mode (No Storage)

- [x] Implement on-demand fetch orchestration per request.
- [~] Add timeout, retry, and partial-failure behavior (timeouts + degraded aggregate; no retry loops yet).
- [x] Define behavior when one protocol fails (degraded aggregate vs full failure).
- [ ] Add request-level tracing/logging for upstream calls.
- [ ] Validate response-time targets under expected baseline load.

## 7) Caching Design and Redis Rollout (Planned Next Phase)

- [ ] Design cache key strategy per endpoint/protocol.
- [ ] Define TTL policy per protocol based on update frequency.
- [ ] Add cache read-through path (cache first, fetch on miss).
- [ ] Add stale-data metadata in responses.
- [ ] Add invalidation/refresh strategy (time-based and on-demand options).
- [ ] Add local/dev toggle to run with cache disabled.

## 8) Testing and Quality Gates

- [~] Unit tests for normalization and adapter transforms (covered via integration test files).
- [x] Integration tests for route behavior and payment gating.
- [x] Contract tests for response schema stability (`/discovery`, `/openapi.json`).
- [x] Caddy x402 end-to-end tests (`npm run test:x402-e2e`).
- [x] Add CI checks (typecheck, tests, Docker build smoke) via GitHub Actions (`.github/workflows/ci.yml`).
- [~] Define minimum quality gate before deploy.
  - [x] Require deterministic CI checks for PR merges to `dev` and `main` (`Protocol checks`, `Website checks`, `Docker build smoke`).
  - [x] Add production smoke workflow for live health/discovery/x402 preflight without paid settlement (`.github/workflows/production-smoke.yml`).

## 9) Deployment and Operations

- [ ] Define deployment target and runtime config strategy.
- [ ] Add health probes and readiness checks.
- [ ] Add structured logs and baseline metrics.
- [ ] Add alerting for upstream adapter failures and latency spikes.
- [ ] Document incident response path for degraded upstream data quality.

## 10) Go-Live Readiness

- [x] Validate paid flow end-to-end in a production-like environment.
- [~] Run protocol accuracy checks against source systems (live smoke tests for Tinyman/Pact; CompX/Dork.fi/Folks pending).
- [~] Confirm API consumer onboarding documentation is complete (website live; compx.io cross-link pending).
- [x] Publish versioned API contract for first release (`1.0.0`).
- [ ] Complete launch checklist sign-off.

## 11) Agent Onboarding Website

Simple human-facing site so developers and operators can quickly set up an agent to use canix402. Implemented in the monorepo `website/` workspace (Astro static site). Linked from the main [compx.io](https://compx.io) site; likely hosted as a subdomain on that domain.

- [~] Confirm subdomain and hosting approach (`canix402.compx.io`; deployment settings in `website/README.md` and `docs/deployment-do-app-platform.md`).
- [x] Define site content outline:
  - [x] What canix402 provides and supported protocols
  - [x] Discovery flow (`/discovery`, `/openapi.json`)
  - [x] x402 payment setup (network, asset, payTo, per-endpoint pricing)
  - [x] Agent onboarding sequence (preflight → `PAYMENT-SIGNATURE` → retry)
  - [x] Endpoint catalog with free vs paid routes
  - [x] Example requests and sample responses
- [x] Build simple static or lightweight site in-repo (`website/`).
- [x] Link live discovery/OpenAPI URLs from the site.
- [x] Add copy-paste setup examples (curl snippets for first paid call).
- [~] Add navigation/link from main compx.io website.
  - [x] Create CompX site handoff brief (`docs/compx-canix-link-page-brief.md`).
  - [ ] Publish/link the Canix402 page from the main CompX site.
- [~] Deploy site to production subdomain (live at `canix402.compx.io`; redeploy after doc/trust/llms changes).

## Ongoing Maintenance

- [~] Keep this checklist updated as tasks are completed or expanded.
- [~] Reflect major architectural decisions first in `docs/project-overview.md`.
- [x] Add new protocol adapter tasks here before implementation starts.
- [x] Keep `/discovery` and `/openapi.json` contracts in sync with endpoint policy changes.
- [x] Keep `test:x402-e2e` passing to preserve validator-path confidence through Caddy.

## 12) Discoverability and Agent Indexing

- [x] Expose canonical OpenAPI at `/openapi.json`.
  - [x] Include x402/payment notes, prices, response examples, and errors.
- [x] Add x402 discovery manifest at `/.well-known/x402.json`.
  - [x] Existing `/discovery` endpoint lists resources, prices, chains/assets, and facilitator metadata.
  - [x] Publish `.well-known` manifest with resources, prices, chains/assets, facilitator, OpenAPI URL, and docs URL.
- [x] Add human agent docs at `/agents` or `/x402`.
  - [~] Explain use cases, pricing, curl examples, and agent examples (basic `/x402`, quickstart, and examples pages exist; fuller agent examples still needed).
- [x] Add LLM docs at `/llms.txt` and `/llms-full.txt`.
  - [x] Summarize endpoints, schemas, and usage examples (build-time generator from discovery snapshot).
- [ ] Add MCP server.
  - [ ] Include tools for `discover_opportunities`, `build_strategy`, `get_transaction_group`, and `simulate_strategy`.
  - [ ] Link MCP server from docs and manifest.
- [~] Enable GoPlausible facilitator catalog visibility (optional).
  - [x] Ensure endpoint uses supported x402 discovery metadata (`/discovery`, OpenAPI `x-x402`, and `.well-known/x402.json` exist).
  - [x] Run at least one successful paid request via facilitator (`npm run test:x402-production -w protocol` with `X402_PRODUCTION_PAID_TEST=1`).
  - [x] Verify live GoPlausible transaction visibility for `canix402-api.compx.io/opportunities`.
  - [ ] Optional: verify the API appears in GoPlausible facilitator discovery (`GET https://facilitator.goplausible.xyz/discovery/resources`, filter for `canix402-api.compx.io`).
  - [x] Coinbase CDP Bazaar and x402Scan marketplace — out of scope (current listing support targets EVM/Solana/CDP-style resources; production uses Algorand via GoPlausible).
- [x] Submit manually where currently supported.
  - [x] Agent-tools.cloud listing live.
  - [x] x402-list.com — out of scope (does not accept Algorand).
  - [x] Awesome x402 GitHub PR — out of scope for now (current ecosystem list does not accept/feature Algorand services).
  - [x] x402Scan — out of scope (current listing support targets EVM/Solana-style resources).
- [~] Add trust metadata.
  - [x] GitHub repo/docs link — N/A (private repo; public docs at `canix402.compx.io`).
  - [x] Contact/support email.
  - [x] Version number.
  - [x] Terms/risk disclaimer.
  - [x] Example successful responses.
- [ ] Add monitoring.
  - [ ] Track x402 requests, failed payments, successful settlements, referrers, and user agents.
  - [ ] Log which directories/agents send traffic.
