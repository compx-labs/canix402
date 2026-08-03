# x402 Algorand DeFi Data API - Development Checklist

This living checklist tracks active and upcoming implementation work for the x402-gated Algorand DeFi opportunities API. Completed items are moved to `docs/development-archive.md`.

Status legend:

- [ ] Not started
- [~] In progress
- [x] Done


## 3) Testing and Quality Gates

- [~] Expand unit tests for normalization and adapter transforms (currently covered via integration test files; no dedicated `tests/unit/` suite yet).
- [~] Finalize minimum quality gate before deploy (`test:ci` + GitHub CI for protocol/website/MCP/Docker; live execution suites intentionally excluded; formal launch sign-off still open).

## 8) Execution Layer

### Protocol Transaction Shape Mapping (Blocking Foundation)

- [~] Build golden fixtures for each supported protocol/action so generated groups can be compared deterministically. Tinyman + Folks + Pact + CompX + Dork.fi integration fixtures in CI (mock-SDK deterministic groups; not separate committed golden JSON blobs).
- [ ] Document protocol-specific caveats that can affect transaction construction (pool discovery, opt-ins, minimum balance, slippage math, liquidity limits, app upgrades).

### Validation and Safety

- [ ] Dry-run/simulation endpoint without signing (optional follow-up).

### Execution Compiler

- [ ] Richer opportunity-state refresh during quote compilation beyond shape build.
