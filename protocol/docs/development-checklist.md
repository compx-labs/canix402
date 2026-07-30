# x402 Algorand DeFi Data API - Development Checklist

This living checklist tracks active and upcoming implementation work for the x402-gated Algorand DeFi opportunities API. Completed items are moved to `docs/development-archive.md`.

Status legend:

- [ ] Not started
- [~] In progress
- [x] Done



## 2) Caching Design and Redis Rollout (Planned Next Phase)

Shared Redis with CompX/Orbital (`compx-v2/docs/redis-usage.md`): CompX uses DB 0 by default with **no** global prefix and generic keys (`market:*`, `asset:*`, `app:state:*`, `oracle:price:*`, `prices:aggregated:v1`, `lp:price:*`, `bull:orbital-oracle-price-update:*`). Isolation for Canix: **dedicated DB index** in `REDIS_URL` (e.g. `/6`) **plus** `canix402:` key prefix. Never reuse CompX prefixes; prefer `SCAN` over `KEYS`; never `FLUSHALL` on the shared instance.

- [x] Design cache key strategy per endpoint/protocol (`canix402:opportunities:protocol:{network}:{protocol}` first).
- [x] Define TTL policy per protocol based on update frequency (start with env-tunable short TTL for aggregated opportunities).
- [x] Add cache read-through path (cache first, fetch on miss).
- [ ] Add stale-data metadata in responses.
- [ ] Add invalidation/refresh strategy (time-based and on-demand options).
- [x] Add local/dev toggle to run with cache disabled (`REDIS_URL` unset or `OPPORTUNITIES_CACHE_DISABLED=1`).
- [x] Document chosen Redis DB index + `canix402:` prefix in Canix deployment docs (and note in CompX runbook).

## 3) Testing and Quality Gates

- [~] Expand unit tests for normalization and adapter transforms (currently covered via integration test files; no dedicated `tests/unit/` suite yet).
- [~] Finalize minimum quality gate before deploy (`test:ci` + GitHub CI for protocol/website/MCP/Docker; live execution suites intentionally excluded; formal launch sign-off still open).

## 4) Deployment and Operations

- [x] Define deployment target and runtime config strategy (DigitalOcean App Platform + Caddy gateway documented in `docs/deployment-do-app-platform.md`; formal env promotion / secrets rotation still TBD).
- [x] Add health probes and readiness checks (`GET /health` liveness; `GET /ready` readiness with Algod required and Redis soft/degraded).
- [x] Add structured logs and baseline metrics (pino JSON + Prometheus `GET /metrics` on protocol `:3000`; public Caddy exposes `/ready` but not `/metrics`).
- [x] Add alerting for upstream adapter failures and latency spikes (documented thresholds in `docs/incident-response.md`; vendor/PagerDuty wiring still TBD).
- [x] Document incident response path for degraded upstream data quality (`docs/incident-response.md`).

## 5) Go-Live Readiness

- [x] Run protocol accuracy checks against source systems (live/production checks passed for Tinyman LP, Pact LP, Folks Finance escrow, CompX, and Dork.fi lending).
- [x] Confirm API consumer onboarding documentation is complete (quickstart/x402/MCP/endpoints/llms docs exist; examples still thin on execution quotes, positions, and Haystack swap flows).
- [x] Complete launch checklist sign-off.


## 6) Discoverability and Agent Indexing

- [~] Expand human agent docs with fuller agent examples (`/x402`, quickstart, and examples pages exist; still need richer copy-paste flows for execution quotes, positions, and swaps).
- [x] Add MCP server (`mcp/` workspace, stdio transport, free + paid tools wrapping gateway endpoints).
  - [x] Include tools for opportunity discovery, execution quotes, and strategy marketplace (`canix_list_opportunities`, `canix_get_execution_quote`, `canix_list_strategies`, `canix_publish_strategy`, `canix_revise_strategy`, `canix_compile_strategy`, etc.).
  - [x] Link MCP server from docs and manifest.
- [x] Enable GoPlausible facilitator catalog visibility (optional).
  - [x] Optional: verify the API appears in GoPlausible facilitator discovery (`GET https://facilitator.goplausible.xyz/discovery/resources`, filter for `canix402-api.compx.io`).
- [x] Confirm trust metadata is complete and current (version, terms, contact, facilitator/payTo, example responses; see archive).
- [ ] Add monitoring.
  - [ ] Track x402 requests, failed payments, successful settlements, referrers, and user agents.
  - [ ] Log which directories/agents send traffic.
  - Note: the public website `/transactions` page surfaces recent on-chain settlement totals + NFD sender names from indexer data; that is not request/referrer/UA telemetry.
- [x] Website/docs catch-up after protocol API review (deferred from first tranche):
  - [x] Refresh `website/src/data/discovery.snapshot.json` (include strategies; update execution-quote description).
  - [x] Refresh opportunity samples with `executionShapes`, `inputHints`, `entryRequirements`, `capacity`.
  - [x] Add Réti to website protocol lists (`protocols.astro`, `config.ts`, llms generator).
  - [x] Document strategies + `/positions` + `/execution/quotes` samples the way opportunities are shown today.

## 7) Wallet Positions Coverage (`GET /positions`)

Collectors report per-protocol `coverage` (`suppliedUsdComplete` / `borrowedUsdComplete` / `rewardsUsdComplete`). Aggregate totals are null only when a real gap remains (unavailable source, unpriced rows, or failed reward reads) — not from always-on caveats. Borrow/debt is out of scope for portfolio responses (`borrowedUsdComplete` stays true; debt rows are not emitted for CompX, Folks, or Dork.fi).

- [x] **Tinyman farm staking / unclaimed rewards.** Farm commit keeps LP in the wallet and stakes the full LP balance (no partial stake), so farmed stake is already known from the LP position (annotated when committed). Unclaimed farm rewards come from `GET /staking/pool-programs/?pooler_address=…&committed_only=true` (`pooler.rewards.pending`), priced via Tinyman asset `price_in_usd`; `rewardsUsdComplete` is true only when that farm fetch + pricing succeed.
- [x] **CompX / Folks / Dork.fi lending debt omitted.** Portfolio collectors do not emit `debt` rows or debt/health incompleteness warnings; `borrowedUsdComplete` remains true.
- [x] **CompX pending staking rewards.** Pending = `stake * rewardPerToken / 1e15 - rewardDebt` (MasterChef); emitted as `reward` positions and priced via CompX pricing API; `rewardsUsdComplete` is true when those rewards are priced (or none exist).
- [x] After the above, stop hardcoding `rewardsUsdComplete: false` / `borrowedUsdComplete: false` for protocols whose coverage is complete, so aggregate totals are only `null` when a real gap or pricing failure remains.
- [x] Add/extend positions integration tests so always-on caveats cannot regress once a protocol’s coverage is marked complete.

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
- [x] Expose Alpha Arcade v1 ALPHA fee-sharing staking execution shapes (stake/unstake/claim USDC rewards) against mainnet app `3626756314`. Gated live verification via `test:alpha-arcade-staking-production` (`X402_ALPHA_ARCADE_STAKING_LIVE=1`; excluded from `test:ci`).
- [x] Attach ordered enter-only `executionShapes` (+ `executionReady`, `requiredAssetIds`, typed `inputHints`) to every opportunity response; empty array means research-only.
- [x] Surface Tinyman tALGO and Folks xALGO liquid staking as `opportunityType: "staking"` rows (consensus APR from Foundation bonus + fee share; Tinyman 8% fee / Folks `ConsensusState.fee`).
- [x] Attach `compatibleExitShapeKeys` / `compatibleManageShapeKeys` on position records.
- [x] Attach Réti + Haystack `compatibleExitShapes` on opportunities (`resolveExitSteps` today only covers Tinyman/Folks/Myth; positions already expose exit keys).
- [x] API hygiene follow-ups (deferred from protocol API review first tranche):
  - [x] Implement or remove dead `includeInactive` query param on opportunity routes.
  - [x] Map Myth/Haystack/Réti adapter errors to 502 in global handler (parity with other adapters).
  - [x] Add strategy error codes to typed catalog + discovery `errorCatalog`.
  - [x] Align base URL defaults and amount display (`amountUsdc` + `amountMicro`) across discovery/Caddy.
- [x] Break `POST /execution/quotes` to batch `{ quotes: [{ shapeKey, input }, ...] }` → `data: ExecutableQuote[]` (flat 0.1 USDC per request; correlated `quoteIndex`/`shapeKey` on failure; no group merging).
- [x] Dork.fi production lending live verification passed via gated `test:dorkfi-production` (`X402_DORKFI_EXECUTION_LIVE=1`; excluded from `test:ci`) and user-agent mainnet submit testing.

### Protocol Transaction Shape Mapping (Blocking Foundation)

- [~] Inventory executable actions for each integrated DeFi protocol (Tinyman, Pact, Folks Finance, CompX, Dork.fi). Tinyman LP + Tinyman farm commit/uncommit/claimRewards/addLiquidityAndFarm + Tinyman tALGO mint/burn + stALGO restake increase/decrease/claim + Folks escrow deposit/withdraw + Folks xALGO immediate stake/unstake + Pact LP add/remove + Pact farm deployEscrow/stake/unstake/claimRewards/addLiquidityAndFarm + CompX lending/staking + Dork.fi lending deposit/withdraw mapped. Still missing for execution: Tinyman swap, Folks wallet-direct deposit/withdraw, Folks xALGO delayed stake/claim and stake-and-deposit. Alpha Arcade ALPHA staking mapped (stake/unstake/claimRewards).
- [x] Map the exact transaction shape/group required for each supported action. All registered shapes (Tinyman LP/farm/liquid-stake/restake, Folks escrow + xALGO immediate, Pact LP/farm, CompX lending/staking, Dork.fi lending, Myth dual-stake, Haystack HAY staking, Réti, Alpha Arcade ALPHA staking) documented under `docs/execution-shapes/` and linked from `shape-docs.ts`. Unsupported actions (Tinyman swap, Folks wallet-direct, Folks xALGO delayed) remain on the inventory item above.
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
- [x] Agent-readable marketplace examples on website.

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
