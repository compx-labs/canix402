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

- No public unauthenticated browsing interface.
- No persistent storage requirement in the first development iteration.
- No full analytics warehouse in v1.

## Target Protocols

Initial protocol coverage:

- Tinyman
- Pact
- Folks Finance
- CompX
- Dork.fi
- Haystack

## Access and Monetization Model

- API endpoints are protected by x402 payment requirements.
- Payments are denominated in USDC.
- Integration baseline:
  - GoPlausible x402 facilitator
  - Nodely Caddy implementation

Gateway configuration ownership:

- Each x402 integration keeps its own project-specific Caddyfile and run wiring.
- In this repo, runtime gateway config lives under `caddy/`.
- The Caddy x402 Go plugin source lives under `caddy/plugin`.

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

- Active runtime focus: Tinyman
- Planned next: Pact, Folks Finance, CompX, Dork.fi, Haystack
- Protocol docs index: `docs/data-sources/README.md`

## Normalized Opportunity Data Model (Initial)

All protocol adapters should map into a shared structure with at least:

- `protocol`: source platform name
- `opportunityType`: lending, staking, LP farming, etc.
- `market` or `assetPair`: protocol-specific market identifier
- `apr` and/or `apy`: numeric yield value and calculation basis if available
- `tvlOrLiquidity`: relevant depth metric when provided
- `rewards`: reward token metadata where applicable
- `sourceTimestamp`: timestamp from upstream source when available
- `fetchedAt`: timestamp of ingestion by this service
- `notes`: caveats or confidence annotations for consumers

Current implementation shape (`OpportunityRecordV1`) emphasizes:

- `apy` (required)
- `tvlUsd` (required)
- `opportunityId`, `assetPair`, `sourceTimestamp`, `fetchedAt`
- optional `apr` and `notes`

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
- Health/metadata endpoints (non-paid where appropriate)
- Discovery endpoints (`/discovery`, `/openapi.json`) for agents and marketplaces

x402 gating should be applied consistently to paid data endpoints.

## Discovery Contract (Grade A)

The API publishes two free discovery surfaces:

- `GET /discovery`: canonical machine-readable catalog for agent/bazaar indexing.
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
- 2026-06-18: Caddy runtime configuration moved to project-owned `caddy/`; `infra/caddy` retired and the Caddy x402 Go plugin source consolidated under `caddy/plugin`.
