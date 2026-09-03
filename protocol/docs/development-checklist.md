# x402 Algorand DeFi Data API - Development Checklist

This living checklist tracks active and upcoming implementation work for the x402-gated Algorand DeFi opportunities API. Completed items are moved to `docs/development-archive.md`.

Status legend:

- [ ] Not started
- [~] In progress
- [x] Done

Work through section 13 in listed order. Canix stays walletless: new routes return data or unsigned groups; the client signs and submits. Do not treat another protocol adapter as a substitute for these items.

Leftover tightening from the execution chapter stays in sections 3 and 8 and can proceed in parallel. Section 3 adapter unit tests (Tinyman / Folks / Pact / CompX / Dork.fi / Myth Finance / Haystack / Réti / Alpha Arcade) are done; execution-layer golden fixtures in section 8 are still open. Protocol-specific execution caveats are documented.


## 3) Testing and Quality Gates

- [x] Add dedicated unit tests for remaining adapter transforms (Myth Finance, Haystack, Réti, Alpha Arcade). All nine adapters now run in `protocol/tests/unit/` on CI.


## 8) Execution Layer (tightening)

### Protocol Transaction Shape Mapping

- [~] Build golden fixtures for each supported protocol/action so generated groups can be compared deterministically. Tinyman + Folks + Pact + CompX + Dork.fi integration fixtures in CI (mock-SDK deterministic groups; not separate committed golden JSON blobs).
- [x] Document protocol-specific caveats that can affect transaction construction (pool discovery, opt-ins, minimum balance, slippage math, liquidity limits, app upgrades). See `docs/execution-shapes/protocol-caveats.md` (also `GET /execution/shapes` `meta.caveatsDocsPath`).

### Execution Compiler

- [ ] Richer opportunity-state refresh during quote compilation beyond shape build.


## 13) Agent execution OS (net-new)

Flagship direction: stop selling ranked rows as the product and start selling signed-intent-ready plans, while remaining the party that never holds the key. Pricing for new paid routes should follow quotes (compiler SKUs), not list (research SKUs), unless noted.

### 13.1 Claim desk

New surface on existing `reward` position rows and per-protocol claim shapes.

- [x] Add paid `GET /positions/claimable?address=` (or equivalent) that lists claimable rewards across supported protocols with USD value, worth-claiming vs network-fee hint, and compatible claim `shapeKey`s.
- [x] Add a claim-all / claim-selected compile path that batches existing claim shapes into `POST /execution/quotes` (`quotes[]`, groups not merged) for Tinyman farm, stALGO, CompX, Pact, Haystack, and Alpha Arcade.
- [x] Expose the claim desk on MCP (`canix_list_claimable` / reuse `canix_get_execution_quote`) and document the agent loop (positions → claimable → quote → local sign).
- [x] Discovery, OpenAPI, Caddy price, and sample payloads for the new route.

### 13.2 Eligibility and capacity

Make personalized matching honest. Quote-time on-chain validation remains authoritative.

- [x] Add paid `POST /eligibility` (address × opportunityId(s)) returning `{ canEnter, missingAssets, gates, capacity, suggestedSwap }`.
- [x] Resolve Réti `entryRequirements` / `capacity` (min amount, ASA gates, staker slots, ALGO room) before quote.
- [x] Define NFD / creator-gate behavior: publish unresolved gates rather than false `canEnter: true` until full NFD resolution exists (`eligibilityFullyCheckable`).
- [x] Stop treating “wallet holds any overlapping `assetIds`” as sufficient for `/opportunities/personalized`; use eligibility (or link to it) so full/gated venues are not recommended as enterable.
- [x] MCP tool + discovery/OpenAPI/Caddy wiring.

### 13.3 Intent compiler (`POST /plans`)

The flagship SKU. Agent states an allocation intent; Canix returns a sequenced plan. Point Brownie at this so the reference agent does not compete with the API.

- [x] Define the plan request contract (address, budget/asset, constraints such as max protocol weight, no new borrows, execution-ready only, TVL/freshness floors).
- [x] Add paid `POST /plans` returning ordered steps: eligibility, optional swap legs, protocol setup chains (e.g. Folks depositEscrow → optEscrowAsset → deposit), enter quotes, expected position delta summary, x402 + network fee totals, expiry.
- [x] Keep groups unsigned and unmerged; reuse `quotes[]` / `order` / `prerequisiteShapeKeys`. Canix does not sign or submit.
- [x] Price as a compiler SKU (dearer than 0.10 USDC list quotes; exact amount TBD in payment policy + Caddy).
- [x] MCP tool (`canix_get_plan` or equivalent), discovery/OpenAPI, samples, and Brownie integration notes.

### 13.4 Swap-aware enter (compose)

Haystack and execution shapes stay separate groups. The new product is the graph, not a merged atomic txn.

- [x] Compose “I hold asset A, I want this opportunity” into sequenced groups: opt-in → Haystack swap → enter, driven by `requiredAssetIds`.
- [x] Wire compose into `POST /plans` (and/or a narrower `POST /execution/compose`) without merging unrelated groups.
- [x] Preserve Haystack signer indexes / pre-signed members; caller still signs only user legs and submits locally.
- [x] Document failure modes (stale quote, missing opt-in, slippage) in shape/plan caveats.

### 13.5 Rebalance / delta quotes

Positions are the book; opportunities are the menu. Emit only the legs that change the book.

- [x] Add a plan mode (or `POST /plans/rebalance`) that takes address + target weights or “harvest idle ALGO / claim and redeploy.”
- [x] Emit exits, claims, swaps, and enters as ordered unsigned groups — only deltas, not a full unwind-and-rebuild by default.
- [x] Reuse claim desk, eligibility, compose, and existing exit/manage `shapeKey`s on positions.

### 13.6 Simulate / expected delta

Relocated from Execution Layer “optional follow-up.” Product, not a hidden dry-run.

- [x] Add a simulation path (dedicated endpoint or plan/quote option) that, given compiled group(s), returns predicted balance and position deltas.
- [x] Fail closed with machine-readable reasons when the group would not succeed (min balance, not opted in, health factor too low, capacity, stale quote).
- [x] Do not require signing; do not submit. Attach simulation summaries on `POST /plans` when available.

### 13.7 Risk object (opportunity schema V2)

Machine-readable risk so plans can be constrained. This is the deferred V1 `rewards` / `market` work, designed rather than dumped as protocol JSON.

- [x] Add a `risk` (or equivalent) block on opportunities: lending utilization / liquidation threshold / `borrowApr` (already present where mapped); LP IL hint or volatility bucket; farm reward runway where known (e.g. CompX `rewardsRemaining`); `confidence` from freshness / cache age.
- [x] When `address` is in context (personalized, plans, eligibility), include wallet health factor for lending venues that already expose it on positions.
- [x] Revise TypeBox + OpenAPI + `docs/normalized-opportunity-schema.md` together (contract revision, not a silent field add).
- [x] Teach `/plans` and `analyze-opportunity` to prefer risk-constrained ranking over raw `apy`.

### 13.8 Agent sessions

Second money model for operators who currently spray tiny USDC transfers (e.g. Brownie’s daily loop). Keep exact-scheme one-shots.

- [x] Design a prepaid session: one x402 payment unlocks N research calls + M quotes/plans for a TTL, with a receipt resource (e.g. `canix://session`).
- [x] Implement session create/refresh, enforcement at gateway or app, and fail-closed expiry.
- [x] Publish receipts/usage to the agent (not only the public indexer `/transactions` showcase).
- [x] Discovery/OpenAPI/MCP + policy matrix for session vs per-request routes.

### 13.9 Watch / webhook

Push instead of polling `/positions` and `/opportunities/personalized`. Recurring x402 retainer, no SaaS login.

- [x] Add a paid watch registration: wallet + thresholds (health factor, claimable USD, APY drop, Réti capacity).
- [x] Deliver notifications via HTTP webhook and/or MCP resource when thresholds fire.
- [x] Document retainer pricing, replay/idempotency, and secret handling (no wallet keys on the server).

### 13.10 Policy-as-a-service

Brownie’s deterministic caps should not stay a fork-the-bot feature.

- [x] Add `POST /policy/validate`: plan (or proposed `quotes[]`) + policy document → pass/fail with machine-readable reasons (per-protocol weight, reserves, TVL floor, freshness, no new borrows, etc.).
- [x] Canix still does not sign. Operators bring policy; this is the shared validator for any user agent.
- [x] MCP tool + a documented policy schema Brownie (and a second agent) can both use.

### 13.11 Historical series

Only enough history to size a plan — not a human warehouse.

- [x] Add paid `GET /opportunities/:id/history?window=` (APY, TVL) for a bounded window (e.g. 30d).
- [x] Persist snapshots as needed (Redis/Postgres); do not resurrect a full analytics warehouse.
- [x] Surface a stability signal on plans/risk so snapshot APY cannot dominate sizing.

### 13.12 Second agent / dry-run steward (GTM)

Fill `/user-agents` “Coming soon” without turning the docs site into a free yield explorer.

- [ ] Ship a dry-run public steward (paper / no signing) that consumes `POST /plans` + policy validate, so a second agent can exist without cloning Brownie.
- [ ] Optionally: wallet-gated human co-pilot (Pera, pay x402, see *your* positions + recommended plan, sign in wallet). Not a free opportunity browser.
- [ ] Point both at the same `/plans` API; keep keys client-side.
- [ ] Update website user-agents, discovery copy, and Brownie notes so the compiler is the product and Brownie is a consumer.
