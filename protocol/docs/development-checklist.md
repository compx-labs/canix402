# x402 Algorand DeFi Data API - Development Checklist

This living checklist tracks active and upcoming implementation work for the x402-gated Algorand DeFi opportunities API. Completed items are moved to `docs/development-archive.md`.

Status legend:

- [ ] Not started
- [~] In progress
- [x] Done

## 1) Initial Delivery Mode (No Storage)

- [~] Add retry behavior for upstream calls (timeouts and degraded aggregate behavior are implemented).
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

- [~] Expand unit tests for normalization and adapter transforms (currently covered via integration test files).
- [~] Finalize minimum quality gate before deploy.

## 4) Deployment and Operations

- [ ] Define deployment target and runtime config strategy.
- [ ] Add health probes and readiness checks.
- [ ] Add structured logs and baseline metrics.
- [ ] Add alerting for upstream adapter failures and latency spikes.
- [ ] Document incident response path for degraded upstream data quality.

## 5) Go-Live Readiness

- [~] Run protocol accuracy checks against source systems (live smoke tests for Tinyman/Pact/Dork.fi; CompX/Folks pending broader coverage).
- [~] Confirm API consumer onboarding documentation is complete.
- [ ] Complete launch checklist sign-off.

## 6) Ongoing Maintenance

- [~] Keep this checklist updated as tasks are completed or expanded.
- [~] Reflect major architectural decisions first in `docs/project-overview.md`.

## 7) Discoverability and Agent Indexing

- [~] Expand human agent docs with fuller agent examples (`/x402`, quickstart, and examples pages exist).
- [x] Add MCP server (`mcp/` workspace, stdio transport, free + paid tools wrapping gateway endpoints).
  - [x] Include tools for opportunity discovery and execution quotes (`canix_list_opportunities`, `canix_get_execution_quote`, etc.). Strategy marketplace tools (`build_strategy`, `simulate_strategy`) remain deferred until those APIs exist.
  - [x] Link MCP server from docs and manifest.
- [~] Enable GoPlausible facilitator catalog visibility (optional).
  - [ ] Optional: verify the API appears in GoPlausible facilitator discovery (`GET https://facilitator.goplausible.xyz/discovery/resources`, filter for `canix402-api.compx.io`).
- [~] Confirm trust metadata is complete and current.
- [ ] Add monitoring.
  - [ ] Track x402 requests, failed payments, successful settlements, referrers, and user agents.
  - [ ] Log which directories/agents send traffic.

## 8) Strategy Marketplace and Execution Layer

Canix should become the validation, discovery, transaction-generation, execution, fee-sharing, and performance-tracking layer for third-party strategies. External AI agents or human creators are responsible for creating strategies; Canix should not generate strategies itself.

### Execution API

- [x] Add paid x402 `POST /execution/quotes` endpoint (0.1 USDC) returning unsigned transaction groups for verified shapes.
- [x] Expose all five Tinyman v2 LP execution shapes via execution quote endpoint (flexible/initial/single-asset add; multiple-assets-out/single-asset-out remove).
- [x] Expose Folks Finance v2 lending escrow shapes (setup depositEscrow/optEscrowAsset; deposit:escrow; withdraw:escrow).
- [x] Expose Pact v1 LP execution shapes (two-sided add; proportional remove).
- [x] Expose CompX v1 lending and staking execution shapes (deposit/withdraw ASA; stake/unstake/claim rewards).
- [x] Expose Dork.fi v1 ASA lending execution shapes (deposit/withdraw ASA).
- [~] Dork.fi production lending live verification via gated `test:dorkfi-production` (`X402_DORKFI_EXECUTION_LIVE=1`; excluded from `test:ci`).

### Protocol Transaction Shape Mapping (Blocking Foundation)

- [~] Inventory executable actions for each integrated DeFi protocol (Tinyman, Pact, Folks Finance, CompX, Dork.fi). Tinyman LP + Folks lending deposit/withdraw + Pact LP add/remove + CompX lending/staking + Dork.fi lending deposit/withdraw mapped.
- [~] Map the exact transaction shape/group required for each supported action (for example: Tinyman add LP, remove LP, swap; Pact add/remove LP; lending deposit/withdraw; staking/farm enter/exit where supported). Folks wallet deposit/withdraw + Pact LP + CompX lending/staking + Dork.fi lending deposit/withdraw documented.
- [ ] Verify every transaction shape against protocol SDKs, docs, on-chain app specs, and successful dry-run/localnet or testnet executions.
- [~] Define typed transaction-shape specs with required inputs, derived values, app/asset IDs, foreign arrays, boxes, fees, group ordering, signer roles, and validation rules. Tinyman LP + Folks lending wallet deposit/withdraw + Pact LP + CompX lending/staking + Dork.fi lending deposit/withdraw implemented.
- [~] Build golden fixtures for each supported protocol/action so generated groups can be compared deterministically. Tinyman + Folks + Pact + CompX + Dork.fi integration fixtures in CI.
- [ ] Treat unsupported or unverified protocol actions as non-executable until a verified transaction-shape spec exists.
- [ ] Document protocol-specific caveats that can affect transaction construction (pool discovery, opt-ins, minimum balance, slippage math, liquidity limits, app upgrades).

### Strategy Model and Contracts

- [ ] Define intent-based strategy schema (objective, risk profile, asset allocations, constraints, creator metadata, fee terms).
- [ ] Explicitly reject raw/pre-built transaction groups in published strategy payloads.
- [ ] Define strategy lifecycle states (`draft`, `validated`, `published`, `suspended`, `archived`).
- [ ] Add versioning rules for strategy schema and published strategy revisions.
- [ ] Publish API contract updates for strategy publish, validate, list, detail, compile, execute, and performance endpoints.

### Publishing and Creator Identity

- [ ] Add strategy publishing endpoint for external agents and human creators.
- [ ] Define creator identity model (wallet address, agent identifier, display metadata, contact/support metadata).
- [ ] Add strategy ownership and update permissions.
- [ ] Add moderation/suspension path for unsafe, stale, or misleading strategies.
- [ ] Add creator-facing documentation and examples for publishing strategies.

### Validation and Safety

- [ ] Build validation pipeline that checks strategy intent maps only to verified protocol transaction-shape specs.
- [ ] Validate asset support, allocation bounds, slippage constraints, minimum APY constraints, and diversification rules.
- [ ] Add dry-run/simulation endpoint that returns expected transaction groups, warnings, and unmet constraints without requiring signing.
- [ ] Add risk and caveat metadata to validated strategies.
- [ ] Define failure modes when market conditions make a strategy temporarily non-executable.

### Marketplace Discovery

- [ ] Add published strategy listing endpoint with filters for protocol, asset, risk profile, creator, estimated APY, and fee.
- [ ] Add strategy detail endpoint with validation status, constraints, creator fee, performance summary, and caveats.
- [ ] Add ranking/sorting inputs without implying Canix-created recommendations.
- [ ] Include strategy marketplace resources in `/discovery`, `/openapi.json`, `.well-known/x402.json`, `/llms.txt`, and `/llms-full.txt`.
- [ ] Add agent-readable marketplace examples.

### Execution Compiler

- [ ] Build strategy compiler that converts strategy intent into fresh transaction groups using only verified protocol transaction-shape specs.
- [ ] Resolve current market data and opportunity data during compilation.
- [ ] Select the correct protocol/action transaction template for each strategy leg.
- [ ] Populate transaction inputs deterministically from current pool/app state, user address, allocation amounts, and strategy constraints.
- [ ] Validate generated transaction groups against golden fixtures and protocol-specific invariants before returning them.
- [ ] Enforce current slippage, allocation, liquidity, and APY constraints before returning transactions.
- [ ] Include execution quote metadata, expiry, expected fees, and warnings with compiled transaction groups.
- [ ] Prevent execution of stale compiled transaction groups.

### User Signing and Execution Flow

- [ ] Define unsigned transaction group response format for wallets and agents.
- [ ] Add execution submission flow for signed transaction groups.
- [ ] Track execution status from compiled quote through confirmation or failure.
- [ ] Add idempotency keys for compile/execute requests.
- [ ] Document wallet and agent signing expectations.

### Fee Sharing and Monetization

- [ ] Define execution fee model and split between strategy creator and Canix.
- [ ] Decide whether fees are collected through x402, transaction-group payments, protocol-level fees, or a hybrid model.
- [ ] Add creator payout accounting and reporting.
- [ ] Add fee disclosure fields to marketplace, quote, and execution responses.
- [ ] Add tests for fee calculation, rounding, settlement, and failed execution handling.

### Performance Tracking

- [ ] Track strategy executions, volume, fees, confirmation status, and execution failures.
- [ ] Define performance metrics that can be computed from public chain data and Canix execution history.
- [ ] Add creator and strategy analytics endpoints.
- [ ] Add safeguards against misleading performance claims when data is incomplete.
- [ ] Add monitoring for strategy execution errors and abnormal failure rates.

### Tests and Quality Gates

- [ ] Add transaction-shape fixture tests for every supported protocol/action before enabling marketplace execution.
- [ ] Add contract tests for strategy schema, marketplace endpoints, quote responses, and execution responses.
- [ ] Add integration tests for publish -> validate -> list -> compile -> execute flow.
- [ ] Add negative tests for invalid strategy intent, unsupported assets, stale quotes, and raw transaction payload rejection.
- [ ] Add negative tests for unsupported or unverified protocol actions.
- [ ] Add simulation tests for fee sharing and creator payout accounting.
- [ ] Add production smoke coverage for read-only marketplace and validation paths.
