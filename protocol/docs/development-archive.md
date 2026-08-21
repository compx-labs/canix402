# x402 Algorand DeFi Data API - Development Archive

Completed work moved out of `docs/development-checklist.md` so the checklist can stay focused on active and upcoming work.

## Archived 2026-08-20

### 3) Testing and Quality Gates

- [x] Add dedicated unit tests for remaining adapter transforms (NEO-184).
  - Myth Finance, Haystack, Réti, and Alpha Arcade now have fixture-based `protocol/tests/unit/` coverage (mocked SDK dependencies; no live chain, no paid x402).
  - Enter-shape attachment for those four is covered via `tests/unit/adapter-execution-enrichment.test.ts`.
  - Existing integration `*-adapter.test.ts` files kept; golden-fixture work stays on checklist §8.

## Archived 2026-08-19

### 3) Testing and Quality Gates

- [x] Expand unit tests for opportunity normalization and adapter transforms (NEO-172).
  - Dedicated `protocol/tests/unit/` suite, fixture-based (recorded SDK/API shapes; no live chain, no paid x402).
  - Protocols: Tinyman (LP/farm/tALGO/stALGO), Folks Finance (lending + xALGO), Pact (LP + farm join), CompX (lending + staking), Dork.fi (network-filtered feed).
  - Enter-shape attachment covered via `tests/unit/adapter-execution-enrichment.test.ts`.
  - Existing integration fixtures kept; `npm run test:unit` is a protocol CI step on `dev` and `main`.
  - Remaining adapters closed 2026-08-20 (NEO-184): Myth Finance, Haystack, Réti, Alpha Arcade.

## Archived 2026-08-13

Checklist hygiene while opening section 13 (agent execution OS). No newly completed implementation — these items were already done or were relocated.

- [x] Formal launch checklist sign-off (duplicate leftover under Testing and Quality Gates; originally completed under Go-Live Readiness on 2026-07-30).
- Relocated, not completed: dry-run/simulation endpoint moved from Execution Layer “Validation and Safety (optional follow-up)” to checklist section 13.6 (simulate / expected delta as a product).
- Relocated leftover tightening stays in checklist sections 3 and 8. Unit-test expansion for Tinyman / Folks / Pact / CompX / Dork.fi completed 2026-08-19; remaining adapters (Myth / Haystack / Réti / Alpha Arcade) completed 2026-08-20 (see archive above). Protocol-specific execution caveats are documented (`docs/execution-shapes/protocol-caveats.md`). Still open: golden fixtures, richer quote-time state refresh.

## Archived 2026-07-30

### 8) Protocol Transaction Shape Mapping

- [x] Inventory executable actions for each integrated DeFi protocol (Tinyman, Pact, Folks Finance, CompX, Dork.fi, plus Haystack, Réti, Myth, Alpha Arcade). All planned shapes mapped (45 registered). Explicitly out of scope: Tinyman swap, Folks wallet-direct deposit/withdraw, Folks xALGO delayed stake/claim and stake-and-deposit.
- [x] Verify every transaction shape against protocol SDKs, docs, on-chain app specs, and successful dry-run/localnet or testnet executions (covered via Brownie bot / agent live verification).
- [x] Define typed transaction-shape specs with required inputs, derived values, app/asset IDs, foreign arrays, boxes, fees, group ordering, signer roles, and validation rules. All 45 registered shapes fully typed (`parseInput` + `requiredInputs` + named input interfaces); registry, `docs/execution-shapes/`, and `shape-docs.ts` are 1:1 (Tinyman LP/farm/liquid-stake/restake, Folks escrow + xALGO immediate, Pact LP/farm, CompX, Dork.fi, Haystack, Réti, Myth, Alpha Arcade).

### 6) Discoverability and Agent Indexing (docs + telemetry)

- [x] Expand human agent docs with fuller agent examples (`/x402`, `/quickstart`, `/examples`, `/mcp`): copy-paste flows for execution quotes (enter + exit-from-position), paid positions retry, and Haystack quote → opt-in → paid transactions; swap sample JSON under `website/src/data/swaps-*.sample.json`; `llms-full.txt` regenerated.
- [x] Add monitoring via Caddy structured logs (no Prometheus / dashboard in this tranche).
  - [x] Track x402 requests, failed payments, successful settlements, referrers, and user agents (`event`: `x402_payment_required` | `x402_verify_failed` | `x402_settlement_failed` | `x402_payment_settled` plus `path` / `method` / `user_agent` / `referer` in `protocol/caddy/handler.go`).
  - [x] Log which directories/agents send traffic (filter DO Caddy logs by `user_agent` / `referer`; see `docs/incident-response.md` and `caddy/README.md`).
  - Note: the public website `/transactions` page remains indexer-only settlement showcase and is not request/referrer/UA telemetry.

### 2) Caching Design and Redis Rollout

Shared Redis with CompX/Orbital (`compx-v2/docs/redis-usage.md`): CompX uses DB 0 by default with **no** global prefix and generic keys (`market:*`, `asset:*`, `app:state:*`, `oracle:price:*`, `prices:aggregated:v1`, `lp:price:*`, `bull:orbital-oracle-price-update:*`). Isolation for Canix: **dedicated DB index** in `REDIS_URL` (e.g. `/6`) **plus** `canix402:` key prefix. Never reuse CompX prefixes; prefer `SCAN` over `KEYS`; never `FLUSHALL` on the shared instance.

- [x] Design cache key strategy per endpoint/protocol (`canix402:opportunities:protocol:{network}:{protocol}` first).
- [x] Define TTL policy per protocol based on update frequency (start with env-tunable short TTL for aggregated opportunities).
- [x] Add cache read-through path (cache first, fetch on miss).
- [x] Add local/dev toggle to run with cache disabled (`REDIS_URL` unset or `OPPORTUNITIES_CACHE_DISABLED=1`).
- [x] Document chosen Redis DB index + `canix402:` prefix in Canix deployment docs (and note in CompX runbook).
- [x] Add stale-data metadata in responses (informational list `meta`: `cacheEnabled`, `cacheHit`, `cachedAt`, `cacheAgeMs`, `cacheTtlSec`; no harsh `stale` flag; Redis stores `{ cachedAt, data }` envelope; default TTL **180s**).
- [x] Add invalidation/refresh strategy (time-based TTL + on-demand `refresh=true` query on opportunity routes to bypass/`DEL` then refetch and rewrite).

### 4) Deployment and Operations

- [x] Define deployment target and runtime config strategy (DigitalOcean App Platform + Caddy gateway documented in `docs/deployment-do-app-platform.md`; formal env promotion / secrets rotation still TBD).
- [x] Add health probes and readiness checks (`GET /health` liveness; `GET /ready` readiness with Algod required and Redis soft/degraded).
- [x] Add structured logs and baseline metrics (pino JSON + Prometheus `GET /metrics` on protocol `:3000`; public Caddy exposes `/ready` but not `/metrics`).
- [x] Add alerting for upstream adapter failures and latency spikes (documented thresholds in `docs/incident-response.md`; vendor/PagerDuty wiring still TBD).
- [x] Document incident response path for degraded upstream data quality (`docs/incident-response.md`).

### 5) Go-Live Readiness

- [x] Run protocol accuracy checks against source systems (live/production checks passed for Tinyman LP, Pact LP, Folks Finance escrow, CompX, and Dork.fi lending).
- [x] Confirm API consumer onboarding documentation is complete (quickstart/x402/MCP/endpoints/llms docs exist; examples still thin on execution quotes, positions, and Haystack swap flows).
- [x] Complete launch checklist sign-off.

### 6) Discoverability and Agent Indexing

- [x] Add MCP server (`mcp/` workspace, stdio transport, free + paid tools wrapping gateway endpoints).
  - [x] Include tools for opportunity discovery and execution quotes (`canix_list_opportunities`, `canix_get_execution_quote`, etc.).
  - [x] Link MCP server from docs and manifest.
- [x] Enable GoPlausible facilitator catalog visibility (optional).
  - [x] Optional: verify the API appears in GoPlausible facilitator discovery (`GET https://facilitator.goplausible.xyz/discovery/resources`, filter for `canix402-api.compx.io`).
- [x] Confirm trust metadata is complete and current (version, terms, contact, facilitator/payTo, example responses; see archive).
- [x] Website/docs catch-up after protocol API review (deferred from first tranche):
  - [x] Refresh `website/src/data/discovery.snapshot.json` (update execution-quote description).
  - [x] Refresh opportunity samples with `executionShapes`, `inputHints`, `entryRequirements`, `capacity`.
  - [x] Add Réti to website protocol lists (`protocols.astro`, `config.ts`, llms generator).
  - [x] Document `/positions` + `/execution/quotes` samples the way opportunities are shown today.

### 7) Wallet Positions Coverage (`GET /positions`)

Collectors report per-protocol `coverage` (`suppliedUsdComplete` / `borrowedUsdComplete` / `rewardsUsdComplete`). Aggregate totals are null only when a real gap remains (unavailable source, unpriced rows, or failed reward reads) — not from always-on caveats. CompX and Folks emit executable `debt` positions (repay via exit shapes); Dork.fi may emit pool-level `debt-usd` rows from the health API (informational, not executable). `borrowedUsdComplete` tracks debt read/pricing success.

- [x] **Tinyman farm staking / unclaimed rewards.** Farm commit keeps LP in the wallet and stakes the full LP balance (no partial stake), so farmed stake is already known from the LP position (annotated when committed). Unclaimed farm rewards come from `GET /staking/pool-programs/?pooler_address=…&committed_only=true` (`pooler.rewards.pending`), priced via Tinyman asset `price_in_usd`; `rewardsUsdComplete` is true only when that farm fetch + pricing succeed.
- [x] **CompX / Folks / Dork.fi lending debt.** CompX emits `compx:debt:<marketAppId>` via `getUserPosition`; Folks emits `folks-finance:debt:<loanEscrow>:<poolAppId>` from loan borrows; Dork.fi emits informational `dorkfi:debt-usd:<poolAppId>` when indexed `totalBorrowValue > 0`. Repay shapes attach to executable debt rows (CompX/Folks).
- [x] **CompX pending staking rewards.** Pending = `stake * rewardPerToken / 1e15 - rewardDebt` (MasterChef); emitted as `reward` positions and priced via CompX pricing API; `rewardsUsdComplete` is true when those rewards are priced (or none exist).
- [x] After the above, stop hardcoding `rewardsUsdComplete: false` / `borrowedUsdComplete: false` for protocols whose coverage is complete, so aggregate totals are only `null` when a real gap or pricing failure remains.
- [x] Add/extend positions integration tests so always-on caveats cannot regress once a protocol’s coverage is marked complete.

### 8) Execution Layer

#### Execution API

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
  - [x] Align base URL defaults and amount display (`amountUsdc` + `amountMicro`) across discovery/Caddy.
- [x] Break `POST /execution/quotes` to batch `{ quotes: [{ shapeKey, input }, ...] }` → `data: ExecutableQuote[]` (flat 0.1 USDC per request; correlated `quoteIndex`/`shapeKey` on failure; no group merging).
- [x] Dork.fi production lending live verification passed via gated `test:dorkfi-production` (`X402_DORKFI_EXECUTION_LIVE=1`; excluded from `test:ci`) and user-agent mainnet submit testing.

#### Protocol Transaction Shape Mapping

- [x] Map the exact transaction shape/group required for each supported action. All registered shapes (Tinyman LP/farm/liquid-stake/restake, Folks escrow + xALGO immediate, Pact LP/farm, CompX lending/staking, Dork.fi lending, Myth dual-stake, Haystack HAY staking, Réti, Alpha Arcade ALPHA staking) documented under `docs/execution-shapes/` and linked from `shape-docs.ts`. Unsupported actions (Tinyman swap, Folks wallet-direct, Folks xALGO delayed) remain on the inventory item above.
- [x] Treat unsupported or unverified protocol actions as non-executable until a verified transaction-shape spec exists (`TransactionShapeRegistry` only compiles registered keys; unknown shapes return `ShapeNotFoundError`).

## Archived 2026-07-08

### 1) Documentation and Project Setup

- [x] Create living project overview document (`docs/project-overview.md`).
- [x] Create living development checklist (`docs/development-checklist.md`).
- [x] Initialize Node.js + TypeScript project scaffolding.
- [x] Define environment variable contract (`.env.example`) for x402, USDC, and upstream API configs.
- [x] Define baseline folder structure (`src/adapters`, `src/services`, `src/routes`, `src/types`).

### 2) API Skeleton (Node.js/TypeScript)

- [x] Choose HTTP framework and set up base server.
- [x] Add typed route modules for:
  - [x] Aggregated opportunities
  - [x] Protocol-specific opportunities
  - [x] Caller-filtered opportunities (`GET /opportunities/search`)
  - [x] Wallet-personalized opportunities (`GET /opportunities/personalized`)
  - [x] Health/metadata
- [x] Add shared error model and response envelope format.
- [x] Add runtime validation for inbound query parameters.

### 3) x402 Payment Gating

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

### 4) Protocol Data Source Research and Adapters

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

### 5) Data Normalization and Contract Definition

- [x] Finalize normalized opportunity schema (`protocol`, `opportunityType`, `apr`, `apy`, `yieldBasis`, etc.; see `docs/normalized-opportunity-schema.md`).
- [x] Implement adapter-to-normalized model transformers (all supported protocols).
- [x] Standardize decimals/precision rules across protocols.
  - [x] Resolve all asset decimals from chain via algod (`resolveAssetDecimals`); ALGO hardcoded to 6; no `?? 6` fallbacks.
  - [x] Cache + bounded-concurrency decimal lookups; drop rows with unresolvable decimals.
  - [x] Agent-facing output precision (default 6, max 12 decimal places) at the response boundary (`formatOpportunitiesForAgent`); contract published via `x-precision` in OpenAPI.
- [x] Include source metadata (`sourceTimestamp`, `fetchedAt`, confidence/caveat notes).
- [x] Publish sample response payloads for consumers.

### 6) Initial Delivery Mode (No Storage)

- [x] Implement on-demand fetch orchestration per request.
- [x] Define behavior when one protocol fails (degraded aggregate vs full failure).

### 8) Testing and Quality Gates

- [x] Integration tests for route behavior and payment gating.
- [x] Contract tests for response schema stability (`/discovery`, `/openapi.json`).
- [x] Caddy x402 end-to-end tests (`npm run test:x402-e2e`).
- [x] Add CI checks (typecheck, tests, Docker build smoke) via GitHub Actions (`.github/workflows/ci.yml`).
- Completed quality gate pieces:
  - [x] Require deterministic CI checks for PR merges to `dev` and `main` (`Protocol checks`, `Website checks`, `Docker build smoke`).
  - [x] Add production smoke workflow for live health/discovery/x402 preflight without paid settlement (`.github/workflows/production-smoke.yml`).

### 10) Go-Live Readiness

- [x] Validate paid flow end-to-end in a production-like environment.
- [x] Publish versioned API contract for first release (`1.0.0`).

### 11) Agent Onboarding Website

- [x] Define site content outline:
  - [x] What canix402 provides and supported protocols
  - [x] Discovery flow (`/discovery`, `/openapi.json`)
  - [x] x402 payment setup (network, asset, payTo, per-endpoint pricing)
  - [x] Agent onboarding sequence (preflight -> `PAYMENT-SIGNATURE` -> retry)
  - [x] Endpoint catalog with free vs paid routes
  - [x] Example requests and sample responses
- [x] Build simple static or lightweight site in-repo (`website/`).
- [x] Link live discovery/OpenAPI URLs from the site.
- [x] Add copy-paste setup examples (curl snippets for first paid call).
- Completed navigation/link pieces:
  - [x] Create CompX site handoff brief (`docs/compx-canix-link-page-brief.md`).
  - [x] Publish/link the Canix402 page from the main CompX site.
- [x] Deploy site to production subdomain (live at `canix402.compx.io`; redeploy after doc/trust/llms changes).
- [x] Confirm subdomain and hosting approach (`canix402.compx.io`; deployment settings in `website/README.md` and `docs/deployment-do-app-platform.md`).
- [x] Confirm navigation/link from main compx.io website is complete in production.

### Ongoing Maintenance

- [x] Add new protocol adapter tasks here before implementation starts.
- [x] Keep `/discovery` and `/openapi.json` contracts in sync with endpoint policy changes.
- [x] Keep `test:x402-e2e` passing to preserve validator-path confidence through Caddy.

### 12) Discoverability and Agent Indexing

- [x] Expose canonical OpenAPI at `/openapi.json`.
  - [x] Include x402/payment notes, prices, response examples, and errors.
- [x] Add x402 discovery manifest at `/.well-known/x402.json`.
  - [x] Existing `/discovery` endpoint lists resources, prices, chains/assets, and facilitator metadata.
  - [x] Publish `.well-known` manifest with resources, prices, chains/assets, facilitator, OpenAPI URL, and docs URL.
- [x] Add human agent docs at `/agents` or `/x402`.
- [x] Add LLM docs at `/llms.txt` and `/llms-full.txt`.
  - [x] Summarize endpoints, schemas, and usage examples (build-time generator from discovery snapshot).
- Completed GoPlausible facilitator catalog visibility pieces:
  - [x] Ensure endpoint uses supported x402 discovery metadata (`/discovery`, OpenAPI `x-x402`, and `.well-known/x402.json` exist).
  - [x] Run at least one successful paid request via facilitator (`npm run test:x402-production -w protocol` with `X402_PRODUCTION_PAID_TEST=1`).
  - [x] Verify live GoPlausible transaction visibility for `canix402-api.compx.io/opportunities`.
  - [x] Coinbase CDP Bazaar and x402Scan marketplace - out of scope (current listing support targets EVM/Solana/CDP-style resources; production uses Algorand via GoPlausible).
- [x] Submit manually where currently supported.
  - [x] Agent-tools.cloud listing live.
  - [x] x402-list.com - out of scope (does not accept Algorand).
  - [x] Awesome x402 GitHub PR - out of scope for now (current ecosystem list does not accept/feature Algorand services).
  - [x] x402Scan - out of scope (current listing support targets EVM/Solana-style resources).
- Completed trust metadata pieces:
  - [x] GitHub repo/docs link - N/A (private repo; public docs at `canix402.compx.io`).
  - [x] Contact/support email.
  - [x] Version number.
  - [x] Terms/risk disclaimer.
  - [x] Example successful responses.
