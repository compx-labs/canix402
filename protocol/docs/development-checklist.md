# x402 Algorand DeFi Data API - Development Checklist

This living checklist tracks active and upcoming implementation work for the x402-gated Algorand DeFi opportunities API. Completed items are moved to `docs/development-archive.md`.

Status legend:

- [ ] Not started
- [~] In progress
- [x] Done

## 1) Initial Delivery Mode (No Storage)

- [~] Add retry behavior for upstream calls (Algod/Haystack 429 retry + adapter timeouts + degraded aggregate via `Promise.allSettled` are implemented; Tinyman/Pact/Dork.fi HTTP fetch paths still have no general retry loop).
- [ ] Add request-level tracing/logging for upstream calls.
- [ ] Validate response-time targets under expected baseline load.

## 2) Caching Design and Redis Rollout (Planned Next Phase)

- [ ] Design cache key strategy per endpoint/protocol.
- [ ] Define TTL policy per protocol based on update frequency.
- [ ] Add cache read-through path (cache first, fetch on miss).
- [ ] Add stale-data metadata in responses.
- [ ] Add invalidation/refresh strategy (time-based and on-demand options).
- [ ] Add local/dev toggle to run with cache disabled.

## 3) Testing and Quality Gates

- [~] Expand unit tests for normalization and adapter transforms (currently covered via integration test files; no dedicated `tests/unit/` suite yet).
- [~] Finalize minimum quality gate before deploy (`test:ci` + GitHub CI for protocol/website/MCP/Docker; live execution suites intentionally excluded; formal launch sign-off still open).

## 4) Deployment and Operations

- [x] Define deployment target and runtime config strategy (DigitalOcean App Platform + Caddy gateway documented in `docs/deployment-do-app-platform.md`; formal env promotion / secrets rotation still TBD).
- [ ] Add health probes and readiness checks (`/health` is static OK only; no readiness/upstream dependency probes).
- [ ] Add structured logs and baseline metrics.
- [ ] Add alerting for upstream adapter failures and latency spikes.
- [ ] Document incident response path for degraded upstream data quality.

## 5) Go-Live Readiness

- [x] Run protocol accuracy checks against source systems (live/production checks passed for Tinyman LP, Pact LP, Folks Finance escrow, and CompX; Dork.fi production still fails at on-chain submit).
- [x] Confirm API consumer onboarding documentation is complete (quickstart/x402/MCP/endpoints/llms docs exist; examples still thin on execution quotes, positions, and Haystack swap flows).
- [x] Complete launch checklist sign-off.


## 6) Discoverability and Agent Indexing

- [~] Expand human agent docs with fuller agent examples (`/x402`, quickstart, and examples pages exist; still need richer copy-paste flows for execution quotes, positions, and swaps).
- [x] Add MCP server (`mcp/` workspace, stdio transport, free + paid tools wrapping gateway endpoints).
  - [x] Include tools for opportunity discovery, execution quotes, and strategy marketplace (`canix_list_opportunities`, `canix_get_execution_quote`, `canix_list_strategies`, `canix_publish_strategy`, `canix_revise_strategy`, `canix_compile_strategy`, etc.).
  - [x] Link MCP server from docs and manifest.
- [~] Enable GoPlausible facilitator catalog visibility (optional).
  - [ ] Optional: verify the API appears in GoPlausible facilitator discovery (`GET https://facilitator.goplausible.xyz/discovery/resources`, filter for `canix402-api.compx.io`).
- [x] Confirm trust metadata is complete and current (version, terms, contact, facilitator/payTo, example responses; see archive).
- [ ] Add monitoring.
  - [ ] Track x402 requests, failed payments, successful settlements, referrers, and user agents.
  - [ ] Log which directories/agents send traffic.

## 7) Wallet Positions Coverage (`GET /positions`)

Collectors in `src/services/protocol-positions.ts` still emit always-on partial caveats that force protocol `status: "partial"` and null `totals.rewardsUsd` / `netUsd` (and CompX `borrowedUsd`). Close the real gaps, then stop warning once coverage is accurate.

- [x] **Tinyman farm staking / unclaimed rewards.** Farm commit keeps LP in the wallet and stakes the full LP balance (no partial stake), so farmed stake is already known from the LP position (annotated when committed). Unclaimed farm rewards come from `GET /staking/pool-programs/?pooler_address=…&committed_only=true` (`pooler.rewards.pending`), priced via Tinyman asset `price_in_usd`; `rewardsUsdComplete` is true only when that farm fetch + pricing succeed.
- [x] **CompX per-user lending debt.** CompX collector reads `sdk.lending.getUserPosition(appId, address)` and emits `debt` rows from `UserPosition.borrowed` (USD via market `baseTokenPrice`); `borrowedUsdComplete` is true when those reads/prices succeed.
- [x] **CompX pending staking rewards.** Pending = `stake * rewardPerToken / 1e15 - rewardDebt` (MasterChef); emitted as `reward` positions and priced via CompX pricing API; `rewardsUsdComplete` is true when those rewards are priced (or none exist).
- [ ] After the above, stop hardcoding `rewardsUsdComplete: false` / `borrowedUsdComplete: false` for protocols whose coverage is complete, so aggregate totals are only `null` when a real gap or pricing failure remains.
- [ ] Add/extend positions integration tests so always-on caveats cannot regress once a protocol’s coverage is marked complete.

## 8) Strategy Marketplace and Execution Layer

Canix should become the validation, discovery, transaction-generation, execution, fee-sharing, and performance-tracking layer for third-party strategies. External AI agents or human creators are responsible for creating strategies; Canix should not generate strategies itself.

### Execution API

- [x] Add paid x402 `POST /execution/quotes` endpoint (0.1 USDC) returning unsigned transaction groups for verified shapes.
- [x] Expose all five Tinyman v2 LP execution shapes via execution quote endpoint (flexible/initial/single-asset add; multiple-assets-out/single-asset-out remove).
- [x] Expose Tinyman liquid-stake/restake execution shapes (mint/burn tALGO; increaseStake/decreaseStake/claimRewards stALGO).
- [x] Expose Folks Finance v2 lending escrow shapes (setup depositEscrow/optEscrowAsset; deposit:escrow; withdraw:escrow).
- [x] Expose Folks Finance xALGO liquid-stake immediate shapes (`xalgo-v1` stake/unstake via `prepareImmediateStakeTransactions` / `prepareUnstakeTransactions`). Delayed stake/claim and stake-and-deposit remain out of scope.
- [x] Expose Pact v1 LP execution shapes (two-sided add; proportional remove).
- [x] Expose Pact v1 farm execution shapes (deployEscrow; stake existing LP into escrow; addLiquidityAndFarm:twoSided; unstake; claimRewards). LP leaves the wallet into a per-user farm escrow (unlike Tinyman in-wallet commit). Gated live quote coverage via `test:pact-farm-shape-live` (`X402_PACT_FARM_SHAPE_LIVE=1`); gated production submit via `test:pact-farm-production` (`X402_PACT_FARM_EXECUTION_LIVE=1`; excluded from `test:ci`).
- [x] Pact production liquidity live verification passed via gated `test:pact-production` (`X402_PACT_EXECUTION_LIVE=1`; excluded from `test:ci`).
- [x] Expose CompX v1 lending and staking execution shapes (deposit/withdraw ASA; stake/unstake/claim rewards).
- [x] Expose Dork.fi v1 ASA lending execution shapes (deposit/withdraw ASA).
- [x] Expose Haystack v1 single-token HAY staking execution shapes (stake HAY; unstake-and-claim via `unstakeHayAndClaim`; claim USDC+HAY rewards) against mainnet app `3321763884`. Gated live verification via `test:haystack-staking-production` (`X402_HAYSTACK_STAKING_LIVE=1`; excluded from `test:ci`).
- [x] Attach ordered enter-only `executionShapes` (+ `executionReady`, `requiredAssetIds`, typed `inputHints`) to every opportunity response; empty array means research-only.
- [x] Surface Tinyman tALGO and Folks xALGO liquid staking as `opportunityType: "staking"` rows (consensus APR from Foundation bonus + fee share; Tinyman 8% fee / Folks `ConsensusState.fee`).
- [x] Attach `compatibleExitShapeKeys` / `compatibleManageShapeKeys` on position records.
- [x] Break `POST /execution/quotes` to batch `{ quotes: [{ shapeKey, input }, ...] }` → `data: ExecutableQuote[]` (flat 0.1 USDC per request; correlated `quoteIndex`/`shapeKey` on failure; no group merging).
- [~] Dork.fi production lending live verification via gated `test:dorkfi-production` (`X402_DORKFI_EXECUTION_LIVE=1`; excluded from `test:ci`) currently fails at submit with an Algod incomplete-group rejection.

### Protocol Transaction Shape Mapping (Blocking Foundation)

- [~] Inventory executable actions for each integrated DeFi protocol (Tinyman, Pact, Folks Finance, CompX, Dork.fi). Tinyman LP + Tinyman farm commit/uncommit/claimRewards/addLiquidityAndFarm + Tinyman tALGO mint/burn + stALGO restake increase/decrease/claim + Folks escrow deposit/withdraw + Folks xALGO immediate stake/unstake + Pact LP add/remove + Pact farm deployEscrow/stake/unstake/claimRewards/addLiquidityAndFarm + CompX lending/staking + Dork.fi lending deposit/withdraw mapped. Still missing for execution: Tinyman swap, Folks wallet-direct deposit/withdraw, Folks xALGO delayed stake/claim and stake-and-deposit. Alpha Arcade staking parked pending ARC-56.
- [~] Map the exact transaction shape/group required for each supported action (for example: Tinyman add LP, remove LP, swap; Pact add/remove LP; lending deposit/withdraw; staking/farm enter/exit where supported). Folks escrow deposit/withdraw + Folks xALGO immediate stake/unstake + Pact LP + Pact farm + CompX lending/staking + Dork.fi lending deposit/withdraw documented under `docs/execution-shapes/`.
- [ ] Verify every transaction shape against protocol SDKs, docs, on-chain app specs, and successful dry-run/localnet or testnet executions.
- [~] Define typed transaction-shape specs with required inputs, derived values, app/asset IDs, foreign arrays, boxes, fees, group ordering, signer roles, and validation rules. Tinyman LP + Tinyman farm + Tinyman tALGO/stALGO liquid-stake/restake + Folks escrow deposit/withdraw + Folks xALGO immediate stake/unstake + Pact LP + Pact farm + CompX lending/staking + Dork.fi lending deposit/withdraw implemented.
- [~] Build golden fixtures for each supported protocol/action so generated groups can be compared deterministically. Tinyman + Folks + Pact + CompX + Dork.fi integration fixtures in CI (mock-SDK deterministic groups; not separate committed golden JSON blobs).
- [x] Treat unsupported or unverified protocol actions as non-executable until a verified transaction-shape spec exists (`TransactionShapeRegistry` only compiles registered keys; unknown shapes return `ShapeNotFoundError`).
- [ ] Document protocol-specific caveats that can affect transaction construction (pool discovery, opt-ins, minimum balance, slippage math, liquidity limits, app upgrades).

### Strategy Model and Contracts

Design SoT: [`docs/strategies.md`](strategies.md).

- [x] Define **weight-based bound composition** schema (`legs[]` with `shapeKey` + venue pin + `weightBps`; no amounts). `strategyId` ≡ ASA id.
- [x] Explicitly reject raw/pre-built transaction groups in published strategy payloads.
- [x] Define lifecycle statuses (`published`, `suspended`, `degraded`, `archived`).
- [x] In-place revise metadata: `createdAt` / `lastRevisedAt` (no revision in id/URL); 14-day cooldown per `strategyId`.
- [x] Publish API contract: list/detail (free); publish `$100`; revise `$1`; compile `$0.1`.

### Publishing and Creator Identity

- [x] Add strategy publishing endpoint (`POST /strategies`, 100 USDC x402).
- [x] Provenance `creatorAddress` (immutable) + tradable ARC-3 NFT (fee rights + revise rights follow holder).
- [x] Revise permissions: NFT holder only; `POST /strategies/{strategyId}` at 1 USDC; 14d per strategy.
- [x] Suspension via Spaces `status: suspended` (blocks list/compile).
- [x] Creator-facing design note in `docs/strategies.md`.

### Validation and Safety

- [x] Validate legs map only to registered verified shape keys; weights sum to 10_000; reject raw txn groups.
- [x] Fail-closed compile if any required leg cannot quote. Agents own swaps / multi-asset funding; strategies are weight-based allocation recipes only.
- [ ] Dry-run/simulation endpoint without signing (optional follow-up).
- [ ] Richer risk/caveat metadata on strategies.
- [x] Degraded/suspended status when venues break or moderation applies.

### Marketplace Discovery

- [x] Published strategy listing (`GET /strategies`) and detail (`GET /strategies/{strategyId}`).
- [x] Fee disclosure: fixed 50% of compile access fee to NFT holder (weekly).
- [ ] Ranking/sorting beyond basic filters.
- [x] Include strategy endpoints in payment-policy matrix (feeds discovery/OpenAPI/llms).
- [ ] Agent-readable marketplace examples on website.

### Execution Compiler

- [x] Compile strategy via `POST /strategies/{strategyId}/compile` → scale weights → existing `/execution/quotes` machinery.
- [x] Reject client-supplied composition; load Legs from Spaces only.
- [ ] Richer opportunity-state refresh during compile beyond shape build.
- [x] Unsigned groups only; Canix does not sign/submit (layer B mutability accepted in v1).

### Fee Sharing and Monetization

- [x] Fixed **50% NFT holder / 50% Canix** on strategy **compile** access fees; publish/revise Canix-only.
- [x] Full x402 to Canix `payTo` (leaderboard); weekly redistribution from dedicated payout wallet.
- [x] Tagged access notes `x402:v2:strategy:{strategyId}` for attribution; payout idempotency via payout-wallet outflows.
- [x] Fee disclosure on strategy detail / compile meta.
- [ ] Production smoke for weekly payout job.

### Performance Tracking

- [ ] Track strategy compile volume and payouts from chain notes.
- [ ] Creator/strategy analytics endpoints.
- [ ] Safeguards against misleading performance claims.

### Tests and Quality Gates

- [x] Unit/integration coverage for strategy schema, store, validate, revise cooldown.
- [ ] Broader publish → compile → payout E2E against mainnet/facilitator.
- [x] Negative tests for invalid legs, weight sum, raw txn rejection, revise cooldown.
