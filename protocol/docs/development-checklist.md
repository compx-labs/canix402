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

- [~] Finalize normalized opportunity schema (`protocol`, `opportunityType`, `apr`, `apy`, etc.).
- [x] Implement adapter-to-normalized model transformers (all supported protocols).
- [x] Standardize decimals/precision rules across protocols.
  - [x] Resolve all asset decimals from chain via algod (`resolveAssetDecimals`); ALGO hardcoded to 6; no `?? 6` fallbacks.
  - [x] Cache + bounded-concurrency decimal lookups; drop rows with unresolvable decimals.
  - [x] Agent-facing output precision (default 6, max 12 decimal places) at the response boundary (`formatOpportunitiesForAgent`); contract published via `x-precision` in OpenAPI.
- [x] Include source metadata (`sourceTimestamp`, `fetchedAt`, confidence/caveat notes).
- [ ] Publish sample response payloads for consumers.

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
- [ ] Add CI checks (typecheck, lint, tests).
- [ ] Define minimum quality gate before deploy.

## 9) Deployment and Operations

- [ ] Define deployment target and runtime config strategy.
- [ ] Add health probes and readiness checks.
- [ ] Add structured logs and baseline metrics.
- [ ] Add alerting for upstream adapter failures and latency spikes.
- [ ] Document incident response path for degraded upstream data quality.

## 10) Go-Live Readiness

- [x] Validate paid flow end-to-end in a production-like environment.
- [~] Run protocol accuracy checks against source systems (live smoke tests for Tinyman/Pact; CompX/Dork.fi/Folks pending).
- [ ] Confirm API consumer onboarding documentation is complete (see section 11).
- [ ] Publish versioned API contract for first release.
- [ ] Complete launch checklist sign-off.

## 11) Agent Onboarding Website

Simple human-facing site so developers and operators can quickly set up an agent to use canix402. Linked from the main [compx.io](https://compx.io) site; likely hosted as a subdomain on that domain.

- [ ] Confirm subdomain and hosting approach (e.g. `canix402.compx.io`).
- [ ] Define site content outline:
  - [ ] What canix402 provides and supported protocols
  - [ ] Discovery flow (`/discovery`, `/openapi.json`)
  - [ ] x402 payment setup (network, asset, payTo, per-endpoint pricing)
  - [ ] Agent onboarding sequence (preflight → `PAYMENT-SIGNATURE` → retry)
  - [ ] Endpoint catalog with free vs paid routes
  - [ ] Example requests and sample responses
- [ ] Build simple static or lightweight site in-repo.
- [ ] Link live discovery/OpenAPI URLs from the site.
- [ ] Add copy-paste setup examples (curl or SDK snippets for first paid call).
- [ ] Add navigation/link from main compx.io website.
- [ ] Deploy site to production subdomain.

## Ongoing Maintenance

- [~] Keep this checklist updated as tasks are completed or expanded.
- [~] Reflect major architectural decisions first in `docs/project-overview.md`.
- [x] Add new protocol adapter tasks here before implementation starts.
- [x] Keep `/discovery` and `/openapi.json` contracts in sync with endpoint policy changes.
- [x] Keep `test:x402-e2e` passing to preserve validator-path confidence through Caddy.
