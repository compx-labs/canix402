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

- [ ] Choose HTTP framework and set up base server.
- [ ] Add typed route modules for:
  - [ ] Aggregated opportunities
  - [ ] Protocol-specific opportunities
  - [ ] Health/metadata
- [ ] Add shared error model and response envelope format.
- [ ] Add runtime validation for inbound query parameters.

## 3) x402 Payment Gating

- [ ] Integrate GoPlausible x402 facilitator into API request flow.
- [ ] Configure USDC-denominated payment requirements for paid endpoints.
- [ ] Integrate Nodely Caddy implementation for gateway behavior.
- [ ] Define paid vs non-paid endpoint policy matrix.
- [ ] Add integration tests for:
  - [ ] Successful paid request
  - [ ] Missing/invalid payment flow
  - [ ] Expired or malformed payment proof

## 4) Protocol Data Source Research and Adapters

- [ ] Tinyman adapter (API/SDK mapping + normalization).
- [ ] Pact adapter (API/SDK mapping + normalization).
- [ ] Folks Finance adapter (API/SDK mapping + normalization).
- [ ] CompX adapter (internal/public data mapping + normalization).
- [ ] Dork.fi adapter (API/SDK mapping + normalization).
- [ ] Haystack adapter (API/SDK mapping + normalization).
- [ ] For each adapter, document:
  - [ ] Source endpoint(s) or SDK methods
  - [ ] Rate-limit and error characteristics
  - [ ] Field mapping and known caveats

## 5) Data Normalization and Contract Definition

- [ ] Finalize normalized opportunity schema (`protocol`, `opportunityType`, `apr`, `apy`, etc.).
- [ ] Implement adapter-to-normalized model transformers.
- [ ] Standardize decimals/precision rules across protocols.
- [ ] Include source metadata (`sourceTimestamp`, `fetchedAt`, confidence/caveat notes).
- [ ] Publish sample response payloads for consumers.

## 6) Initial Delivery Mode (No Storage)

- [ ] Implement on-demand fetch orchestration per request.
- [ ] Add timeout, retry, and partial-failure behavior.
- [ ] Define behavior when one protocol fails (degraded aggregate vs full failure).
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

- [ ] Unit tests for normalization and adapter transforms.
- [ ] Integration tests for route behavior and payment gating.
- [ ] Contract tests for response schema stability.
- [ ] Add CI checks (typecheck, lint, tests).
- [ ] Define minimum quality gate before deploy.

## 9) Deployment and Operations

- [ ] Define deployment target and runtime config strategy.
- [ ] Add health probes and readiness checks.
- [ ] Add structured logs and baseline metrics.
- [ ] Add alerting for upstream adapter failures and latency spikes.
- [ ] Document incident response path for degraded upstream data quality.

## 10) Go-Live Readiness

- [ ] Validate paid flow end-to-end in a production-like environment.
- [ ] Run protocol accuracy checks against source systems.
- [ ] Confirm API consumer onboarding documentation is complete.
- [ ] Publish versioned API contract for first release.
- [ ] Complete launch checklist sign-off.

## Ongoing Maintenance

- [ ] Keep this checklist updated as tasks are completed or expanded.
- [ ] Reflect major architectural decisions first in `docs/project-overview.md`.
- [ ] Add new protocol adapter tasks here before implementation starts.
