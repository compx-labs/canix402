# x402 Algorand DeFi Data API - Development Checklist

This living checklist tracks active and upcoming implementation work for the x402-gated Algorand DeFi opportunities API. Completed items are moved to `docs/development-archive.md`.

Status legend:

- [ ] Not started
- [~] In progress
- [x] Done


## 3) Testing and Quality Gates

- [~] Expand unit tests for normalization and adapter transforms (currently covered via integration test files; no dedicated `tests/unit/` suite yet).
- [~] Finalize minimum quality gate before deploy (`test:ci` + GitHub CI for protocol/website/MCP/Docker; live execution suites intentionally excluded; formal launch sign-off still open).

## 8) Strategy Marketplace and Execution Layer

Canix should become the validation, discovery, transaction-generation, execution, fee-sharing, and performance-tracking layer for third-party strategies. External AI agents or human creators are responsible for creating strategies; Canix should not generate strategies itself.

### Protocol Transaction Shape Mapping (Blocking Foundation)

- [~] Build golden fixtures for each supported protocol/action so generated groups can be compared deterministically. Tinyman + Folks + Pact + CompX + Dork.fi integration fixtures in CI (mock-SDK deterministic groups; not separate committed golden JSON blobs).
- [ ] Document protocol-specific caveats that can affect transaction construction (pool discovery, opt-ins, minimum balance, slippage math, liquidity limits, app upgrades).

### Validation and Safety

- [ ] Dry-run/simulation endpoint without signing (optional follow-up).
- [ ] Richer risk/caveat metadata on strategies.

### Marketplace Discovery

- [ ] Ranking/sorting beyond basic filters.

### Execution Compiler

- [ ] Richer opportunity-state refresh during compile beyond shape build.

### Fee Sharing and Monetization

- [ ] Production smoke for weekly payout job.

### Performance Tracking

- [ ] Track strategy compile volume and payouts from chain notes.
- [ ] Creator/strategy analytics endpoints.
- [ ] Safeguards against misleading performance claims.

### Tests and Quality Gates

- [ ] Broader publish → compile → payout E2E against mainnet/facilitator.
