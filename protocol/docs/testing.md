# Testing Guide

This document explains the current test suites, how to run them, and what each
suite validates for canix402.

The protocol package lives in `protocol/` within the monorepo. From repo root, prefer workspace scripts such as `npm run test:protocol`.

## Test Lanes

canix402 uses intentional test lanes. They are separate packages and access patterns — standard API tests do **not** invoke the MCP server.

| Lane | Location | Access pattern | Default CI |
|------|----------|----------------|------------|
| **API** | `protocol/tests/integration` | In-process Fastify (`buildApp` + `inject`) | Yes |
| **Gateway** | `protocol/tests/e2e` | Local Caddy + facilitator mock + `fetch` | Yes |
| **MCP (Local stdio)** | `mcp/tests/unit`, `mcp/tests/integration` | MCP tool handlers + mocked `fetch` | Yes |
| **MCP (Remote worker)** | `mcp-worker/tests` | Worker MCP server + mocked gateway `fetch` | Yes |
| **Live / production** | `protocol/tests/live`, `mcp/tests/live` | Real HTTP / mainnet (opt-in) | No |

### Quick commands (repo root)

```sh
# API + gateway (CI gate)
npm run test:protocol

# Lanes individually
npm run test:api
npm run test:gateway
npm run test:mcp
npm run test:mcp-worker

# Live / production (opt-in, may spend USDC)
npm run test:live:local
npm run test:live:production
npm run test:tinyman-production
npm run test:live:haystack-swap
npm run test:folks-production
CANIX402_LIVE_TESTS=1 npm run test:live:mcp

# Full local pre-merge check
npm run check
```

## Test Suites

### API tests (`protocol/tests/integration`)

Run with:

```sh
npm run test:api -w protocol
# or
npm run test:api
```

Coverage:

- Discovery contract coverage (`/discovery`) including MCP **advertisement metadata** (not MCP runtime)
- OpenAPI consistency coverage (`/openapi.json`)
- App-level x402 behavior simulation for paid/free routes
- Adapter and protocol-route coverage for:
  - Tinyman
  - Pact
  - Folks Finance
- Execution quote route coverage (`POST /execution/quotes`)
- Transaction-shape registry and Tinyman / Pact / Folks / CompX / Dork.fi execution shape fixtures

Files:

- `tests/integration/discovery-contract.test.ts`
- `tests/integration/openapi-consistency.test.ts`
- `tests/integration/x402-gating.test.ts`
- `tests/integration/execution-quotes-route.test.ts`
- `tests/integration/execution-registry.test.ts`
- `tests/integration/folks-finance-escrow-shapes.test.ts`
- `tests/integration/tinyman-remove-liquidity-shape.test.ts`
- `tests/integration/tinyman-adapter.test.ts`
- `tests/integration/pact-liquidity-shapes.test.ts`
- `tests/integration/pact-adapter.test.ts`
- `tests/integration/compx-execution-shapes.test.ts`
- `tests/integration/dorkfi-execution-shapes.test.ts`
- `tests/integration/folks-finance-adapter.test.ts`

### Gateway tests through Caddy (`protocol/tests/e2e`)

Run with:

```sh
npm run build:caddy-x402 -w protocol
npm run test:gateway -w protocol
# or
npm run test:gateway
```

Coverage:

- Real Caddy x402 gateway path for paid endpoints
- Facilitator `/verify` and `/settle` interaction sequence
- Paid endpoint negotiation:
  - missing signature -> `402` + `PAYMENT-REQUIRED`
  - valid signature -> `200`
  - malformed signature -> payment error response
  - invalid verification -> payment error response
- `POST /execution/quotes` preflight with JSON request body
- Free endpoint bypass (`/health`, `/metadata`) without facilitator calls

File:

- `tests/e2e/x402-caddy-e2e.test.ts`

### MCP tests (`mcp/tests`)

Run with:

```sh
npm run test:mcp
```

Coverage (local stdio package):

- MCP server tool/resource registration against the canonical tool manifest (`@canix402/x402-client`)
- Free and paid tool handler behavior with mocked gateway `fetch`
- x402 client payment preflight and retry-signature forwarding (mocked)
- Discovery `/discovery` tool list parity (protocol API contract test)

Live MCP tests (production gateway, opt-in):

```sh
CANIX402_LIVE_TESTS=1 npm run test:live:mcp
```

Files:

- `mcp/tests/unit/x402-client.test.ts`
- `mcp/tests/integration/mcp-server.test.ts`
- `mcp/tests/live/mcp-live.test.ts`

MCP always calls the **Caddy gateway** (`CANIX402_API_URL`), never the raw Fastify upstream.

### Remote MCP Worker tests (`mcp-worker/tests`)

Run with:

```sh
npm run test:mcp-worker
```

Coverage:

- Worker config and endpoint metadata defaults
- Gateway paid preflight (`402 + PAYMENT-REQUIRED`) parsing
- Retry forwarding with caller-supplied `PAYMENT-SIGNATURE`
- MCP tool registration parity with canonical tool manifest

## Prerequisites for gateway tests

The E2E suite requires a project-local Caddy binary with the x402 plugin.

Build once (or after plugin changes):

```sh
npm run build:caddy-x402
```

This generates `.bin/caddy-x402` used by the E2E harness.

The E2E harness loads `caddy/Caddyfile` as the project-owned gateway config.

## Full CI-equivalent run

```sh
npm run test:ci
```

This runs:

1. API tests (`test:api`)
2. Gateway tests (`test:gateway`)

MCP tests run in a separate CI job (`mcp_checks`).

## CI Lanes

GitHub Actions runs these lanes:

### Deterministic merge checks (`.github/workflows/ci.yml`)

Triggered on PRs/pushes to `dev` and `main`.

**Protocol checks** (`protocol_checks`):

- protocol typecheck
- API integration tests
- Caddy x402 binary build + gateway E2E tests
- Caddy module `go test ./...`

**MCP checks** (`mcp_checks`):

- `@canix402/x402-client` typecheck
- MCP typecheck
- MCP unit + integration tests (mocked fetch, no network)
- MCP worker typecheck + tests

**Website checks** (`website_checks`):

- website typecheck + build

**Docker smoke** (`docker_smoke`):

- protocol/caddy Docker build smoke

These checks are intended to be required merge gates.

### Production smoke (`.github/workflows/production-smoke.yml`)

Triggered manually and on a daily schedule.

Includes free live endpoint verification against the deployed API:

- `/health`
- `/discovery`
- `/.well-known/x402.json`
- `/openapi.json`
- `/opportunities` preflight (`402` + `PAYMENT-REQUIRED`)

No paid settlement is executed in this smoke workflow.

## Build and type checks

Before merging, also run:

```sh
npm run build
npm run typecheck
```

## Data Shape CLI

To inspect the current normalized output shape and live adapter payloads in JSON:

```sh
npm run cli:opportunities
```

Protocol-specific output:

```sh
npm run cli:opportunities -- --protocol tinyman
npm run cli:opportunities -- --protocol pact
```

Compact single-line JSON:

```sh
npm run cli:opportunities -- --compact
```

Fail if no data rows are returned:

```sh
npm run cli:opportunities -- --require-data
```

## Live Data Tests

To verify we can fetch real adapter data (non-mocked):

```sh
npm run test:live
```

This suite currently checks:

- Tinyman live records are returned with numeric `apy` and `tvlUsd`.
- Pact live records are returned with numeric `apy` and `tvlUsd`, including LP
  and farm opportunity type coverage when available.

## Environment variable alignment

Protocol live tests and MCP use different prefixes but share aliases:

| Purpose | Protocol | MCP |
|---------|----------|-----|
| Gateway base URL | `X402_PRODUCTION_BASE_URL` | `CANIX402_API_URL` |
| Live test gate | `X402_PRODUCTION_PAID_TEST`, `X402_TINYMAN_EXECUTION_LIVE`, etc. | `CANIX402_LIVE_TESTS=1` |

Shared x402 parsing + signing utilities live in `packages/x402-client`.
Server-side MCP layers (local and remote) are walletless and do not hold mnemonics.

## Live x402 Integration Tests

To verify live Caddy + facilitator compatibility and live paid settlement:

```sh
npm run test:live:local -w protocol
# or
npm run test:live:local
```

This performs a real local stack run:

- real Fastify API
- real Caddy x402 plugin
- real facilitator preflight compatibility checks (`PAYMENT-REQUIRED` from paid route)
- wallet-signed payment retry and facilitator settlement

Configuration source for the live suite:

- local `.env` and `caddy/.env` files are loaded automatically
- shell-exported values take precedence over local env file values
- Caddy payment policy from existing env (`X402_PAYMENT_RECEIVER_ADDRESS`, `X402_PAYMENT_AMOUNT_USDC`, etc.)
- facilitator URL from `X402_FACILITATOR_BASE_URL`
- Algod connection from shared vars used by all integrations:
  - `X402_ALGOD_URL` (default: `https://mainnet-api.algonode.cloud`)
  - `X402_ALGOD_TOKEN` (default: empty string)
- never commit mnemonic values to the repository

These live suites are intentionally excluded from default PR CI because they are
environment-sensitive and can incur paid request cost.

## Production x402 Paid Test

To verify the deployed gateway path (Cloudflare → DO Caddy → protocol API) with
real facilitator settlement:

```sh
X402_PRODUCTION_PAID_TEST=1 \
X402_PRODUCTION_BASE_URL=https://canix402-api.compx.io \
X402_CLIENT_MNEMONIC=... \
npm run test:live:production -w protocol
```

Preflight-only run (no wallet, no spend):

```sh
npm run test:live:production -w protocol
```

Scheduled production smoke (same preflight coverage, no wallet):

```sh
npm run test:production-smoke -w protocol
```

Coverage on every production test run:

- **Free (expect 200):** `/health`, `/metadata`, `/discovery`, `/openapi.json`, `/favicon.ico`, `/favicon.png`, `/.well-known/x402`, `/.well-known/x402.json`
- **Paid preflight (expect 402 + `PAYMENT-REQUIRED`):** `/opportunities`, `/opportunities/search`, `/opportunities/personalized`, `/positions?address=...`, `/protocols/tinyman/opportunities`, `/execution/quotes`

Behavior:

- Without `X402_PRODUCTION_PAID_TEST=1`, the paid settlement test is skipped.
- Free and paid preflight tests always run against production.
- With opt-in, the suite signs and retries against all paid routes sequentially.
- Personalized preflight/settlement uses `X402_PRODUCTION_PERSONALIZED_ADDRESS`, falling back to the configured pay-to address.
- Positions uses the same production address and must advertise exactly `5000`
  micro-USDC (`0.005 USDC`) in `PAYMENT-REQUIRED`.

Wallet requirements for paid settlement:

- ALGO balance for transaction fees
- USDC ASA opt-in
- enough USDC for all paid routes in one run, based on current discovery prices
- never commit `X402_CLIENT_MNEMONIC` to the repository

This suite is not part of `test`, `test:ci`, or default GitHub Actions. The daily
`Production Smoke` workflow runs `test:production-smoke` (preflight only).

## Haystack production swap test

The opt-in test in
[`tests/live/haystack-production-swap.test.ts`](../tests/live/haystack-production-swap.test.ts)
executes a real mainnet swap through the deployed production gateway:

```sh
X402_HAYSTACK_SWAP_LIVE=1 npm run test:live:haystack-swap
```

It requests a fixed-input quote for **0.1 USDC (100,000 micro-USDC) to ALGO**,
submits any Haystack app or asset opt-ins, pays the production
`/swaps/transactions` x402 charge, signs the returned user transactions locally,
preserves Haystack-signed group members, and submits the atomic group.

The test requires `X402_CLIENT_MNEMONIC`, at least **0.105 USDC** (0.1 USDC swap
input plus the 0.005 USDC x402 charge), and enough ALGO for opt-ins and network
fees. It is skipped unless explicitly enabled and is excluded from CI.

## Tinyman production liquidity tests

Production on-chain tests live in [`tests/live/tinyman-production-test.test.ts`](../tests/live/tinyman-production-test.test.ts).
They verify the full agent execution path against the **deployed production gateway**
(`X402_PRODUCTION_BASE_URL`, default `https://canix402-api.compx.io`) with
**on-chain submission** on mainnet.

Pool pair: **ALGO / USDC** (USDC `31566704`, ALGO `0`). Liquidity add legs use
**0.1 USDC (100,000 micro)** unless noted. Each `POST /execution/quotes` costs
**0.1 USDC** x402.

| Scenario | Shape(s) | Liquidity moved |
|---|---|---|
| `add` | flexible add | 0.1 USDC + proportional ALGO |
| `remove` | multipleAssetsOut remove | burns LP (both assets out) |
| `roundtrip` | flexible add → multipleAssetsOut remove | ~0.1 USDC net |
| `singleAssetAdd` | singleAsset add | 0.1 USDC only (no ALGO deposit) |
| `singleAssetOutRemove` | singleAssetOut remove | USDC out only |
| `singleAssetRoundtrip` | singleAsset add → singleAssetOut remove | ~0.1 USDC net |

`addLiquidity:initial` is **not** production-tested on ALGO/USDC — the pool
already has liquidity.

```sh
X402_TINYMAN_EXECUTION_LIVE=1 npm run test:tinyman-production -w protocol
```

Scenario selector (default: `roundtrip`):

```sh
# Flexible add: 0.1 USDC + proportional ALGO
X402_TINYMAN_EXECUTION_LIVE=1 X402_TINYMAN_EXECUTION_SCENARIO=add npm run test:tinyman-production -w protocol

# Multiple-assets-out remove (skip if wallet has no LP tokens)
X402_TINYMAN_EXECUTION_LIVE=1 X402_TINYMAN_EXECUTION_SCENARIO=remove npm run test:tinyman-production -w protocol

# Flexible roundtrip
X402_TINYMAN_EXECUTION_LIVE=1 X402_TINYMAN_EXECUTION_SCENARIO=roundtrip npm run test:tinyman-production -w protocol

# Single-asset add: 0.1 USDC only
X402_TINYMAN_EXECUTION_LIVE=1 X402_TINYMAN_EXECUTION_SCENARIO=singleAssetAdd npm run test:tinyman-production -w protocol

# Single-asset-out remove as USDC (skip if wallet has no LP tokens)
X402_TINYMAN_EXECUTION_LIVE=1 X402_TINYMAN_EXECUTION_SCENARIO=singleAssetOutRemove npm run test:tinyman-production -w protocol

# Single-asset roundtrip: 0.1 USDC add, then remove all LP as USDC
X402_TINYMAN_EXECUTION_LIVE=1 X402_TINYMAN_EXECUTION_SCENARIO=singleAssetRoundtrip npm run test:tinyman-production -w protocol
```

Optional partial remove amount (base units):

```sh
X402_TINYMAN_REMOVE_POOL_TOKEN_AMOUNT=500000
```

Flow per scenario:

1. Call deployed `POST /execution/quotes` through production Caddy x402
2. Pay for the quote with USDC (0.1 USDC per quote)
3. Sign `data.encodedTransactions` with `X402_CLIENT_MNEMONIC`
4. Submit and confirm on mainnet via Algod

Configuration:

- `X402_PRODUCTION_BASE_URL` — production API base (same as `test:live:production`)
- `X402_CLIENT_MNEMONIC` in `.env` (never commit)
- `X402_FACILITATOR_BASE_URL`, pay-to, and Algod vars from `.env` / `caddy/.env`

Wallet requirements:

- USDC ASA opted in
- ALGO for txn fees; proportional ALGO deposit only for flexible add scenarios
- For roundtrip scenarios: enough USDC for two execution quotes (~0.2 USDC) plus 0.1 USDC liquidity
- For remove-only scenarios: wallet must already hold Tinyman LP tokens

`test:live:execution` is an alias for `test:tinyman-production`. This suite is
excluded from `test:ci` and incurs real mainnet + x402 costs.

### Pact production liquidity tests

Production on-chain tests live in [`tests/live/pact-production-test.test.ts`](../tests/live/pact-production-test.test.ts).
They mirror the Tinyman production flow using the same ALGO/USDC pair and amounts:

- **0.1 USDC (100,000 micro)** balanced deposit with proportional ALGO
- **50 bps** add-liquidity slippage tolerance
- Each `POST /execution/quotes` costs **0.1 USDC** x402

| Scenario | Shape(s) | Notes |
|---|---|---|
| `add` | `mainnet:pact:v1:addLiquidity:twoSided` | Adds balanced ALGO/USDC liquidity |
| `remove` | `mainnet:pact:v1:removeLiquidity:proportional` | Removes LP tokens proportionally |
| `roundtrip` | add then remove | Removes LP minted by the add step |

```sh
X402_PACT_EXECUTION_LIVE=1 npm run test:pact-production -w protocol
```

Scenario selector (default: `roundtrip`):

```sh
X402_PACT_EXECUTION_LIVE=1 X402_PACT_EXECUTION_SCENARIO=add npm run test:pact-production -w protocol
X402_PACT_EXECUTION_LIVE=1 X402_PACT_EXECUTION_SCENARIO=remove npm run test:pact-production -w protocol
X402_PACT_EXECUTION_LIVE=1 X402_PACT_EXECUTION_SCENARIO=roundtrip npm run test:pact-production -w protocol
```

Optional configuration:

```sh
# Override LP amount burned on standalone remove
X402_PACT_REMOVE_POOL_TOKEN_AMOUNT=50000
```

Wallet requirements match Tinyman production tests: USDC opted in, ALGO for fees,
LP token opt-in before add, and enough USDC for x402 quote fees (~0.2 USDC on
roundtrip). `test:pact-execution-live` is an alias for `test:pact-production`.

### Folks Finance production lending tests

Opt-in suite that pays production x402 fees, builds execution quotes via
`POST /execution/quotes`, signs locally, and submits on mainnet. Uses the same
wallet as Tinyman (`X402_CLIENT_MNEMONIC`).

**0.1 USDC (100,000 micro)** deposit and withdraw in roundtrip scenarios.
Each `POST /execution/quotes` costs **0.1 USDC** x402.

| Scenario | Shape(s) | Notes |
|---|---|---|
| `deposit` | setup (if needed) → opt (if needed) → deposit:escrow | Deposits 0.1 USDC via escrow |
| `withdraw` | withdraw:escrow | Withdraws 0.1 USDC; skips if escrow has no fAssets |
| `roundtrip` | setup (if needed) → opt (if needed) → deposit → withdraw | ~0.1 USDC net liquidity |

```sh
X402_FOLKS_EXECUTION_LIVE=1 npm run test:folks-production -w protocol
```

Scenario selector (default: `roundtrip`):

```sh
# Deposit only (auto-runs escrow setup/opt when missing)
X402_FOLKS_EXECUTION_LIVE=1 X402_FOLKS_EXECUTION_SCENARIO=deposit npm run test:folks-production -w protocol

# Withdraw only (skip if escrow has no fAsset balance)
X402_FOLKS_EXECUTION_LIVE=1 X402_FOLKS_EXECUTION_SCENARIO=withdraw npm run test:folks-production -w protocol

# Roundtrip: deposit 0.1 USDC then withdraw 0.1 USDC
X402_FOLKS_EXECUTION_LIVE=1 X402_FOLKS_EXECUTION_SCENARIO=roundtrip npm run test:folks-production -w protocol
```

Optional configuration:

```sh
# Pin a specific deposit escrow when the wallet has multiple
X402_FOLKS_ESCROW_ADDRESS=YOUR_ESCROW_ADDRESS

# Override underlying asset (default: mainnet USDC 31566704)
X402_FOLKS_ASSET_ID=31566704
```

Flow per scenario:

1. Call deployed `POST /execution/quotes` through production Caddy x402
2. Pay for each quote with USDC (0.1 USDC per quote)
3. Sign `data.encodedTransactions` with `X402_CLIENT_MNEMONIC` (and generated
   escrow key for `setup:depositEscrow`)
4. Submit and confirm on mainnet via Algod

Wallet requirements:

- USDC ASA opted in
- ALGO for txn fees
- Enough USDC for x402 quote fees (up to ~0.4 USDC on first roundtrip if escrow
  setup and opt-in are required, plus 0.1 USDC deposit liquidity)

`test:folks-execution-live` and `test:live:folks-execution` are aliases for
`test:folks-production`. Excluded from `test:ci`.

### CompX production lending and staking tests

Production on-chain tests live in
[`tests/live/compx-production-test.test.ts`](../tests/live/compx-production-test.test.ts).

Lending uses the active mainnet USDC ASA market (`marketAppId`
3491050310) with **0.1 USDC (100,000 micro)** deposit and LST-denominated
withdraw of exactly the minted LST.

| Lending scenario | Shape(s) | Notes |
|---|---|---|
| `deposit` | `mainnet:compx:v1:deposit:asa` | Deposits 0.1 USDC base asset |
| `withdraw` | `mainnet:compx:v1:withdraw:asa` | Burns wallet LST balance |
| `roundtrip` | deposit then withdraw | Withdraws LST minted by deposit |

```sh
X402_COMPX_EXECUTION_LIVE=1 npm run test:compx-production -w protocol
```

Lending scenario selector (default: `roundtrip`):

```sh
X402_COMPX_EXECUTION_LIVE=1 X402_COMPX_LENDING_SCENARIO=deposit npm run test:compx-production -w protocol
X402_COMPX_EXECUTION_LIVE=1 X402_COMPX_LENDING_SCENARIO=withdraw npm run test:compx-production -w protocol
X402_COMPX_EXECUTION_LIVE=1 X402_COMPX_LENDING_SCENARIO=roundtrip npm run test:compx-production -w protocol
```

Staking tests require `X402_COMPX_STAKING_POOL_APP_ID` and a funded stake amount.
Claim runs only when accrued rewards exist.

```sh
X402_COMPX_EXECUTION_LIVE=1 \
X402_COMPX_STAKING_POOL_APP_ID=YOUR_POOL_APP_ID \
X402_COMPX_STAKE_AMOUNT=100000 \
X402_COMPX_STAKING_SCENARIO=roundtrip \
npm run test:compx-production -w protocol
```

Integration fixtures for all five CompX shapes:
`tests/integration/compx-execution-shapes.test.ts`.

`test:compx-execution-live` is an alias for `test:compx-production`. Excluded
from `test:ci`.

### Dork.fi production lending tests

Production on-chain tests live in
[`tests/live/dorkfi-production-test.test.ts`](../tests/live/dorkfi-production-test.test.ts).

Lending uses the active mainnet USDC ASA market by default (`poolAppId`
3333688282, `marketAppId` 3210682240, `assetId` 31566704) with **0.1 USDC
(100,000 micro)** deposit and nToken-denominated withdraw of exactly the minted
nToken balance.

| Scenario | Shape(s) | Notes |
|---|---|---|
| `deposit` | `mainnet:dorkfi:v1:deposit:asa` | Deposits 0.1 USDC base asset |
| `withdraw` | `mainnet:dorkfi:v1:withdraw:asa` | Burns wallet nToken balance |
| `roundtrip` | deposit then withdraw | Withdraws nToken minted by deposit |

```sh
X402_DORKFI_EXECUTION_LIVE=1 npm run test:dorkfi-production -w protocol
```

Scenario selector (default: `roundtrip`):

```sh
X402_DORKFI_EXECUTION_LIVE=1 X402_DORKFI_EXECUTION_SCENARIO=deposit npm run test:dorkfi-production -w protocol
X402_DORKFI_EXECUTION_LIVE=1 X402_DORKFI_EXECUTION_SCENARIO=withdraw npm run test:dorkfi-production -w protocol
X402_DORKFI_EXECUTION_LIVE=1 X402_DORKFI_EXECUTION_SCENARIO=roundtrip npm run test:dorkfi-production -w protocol
```

Optional configuration:

```sh
X402_DORKFI_USDC_POOL_APP_ID=3333688282
X402_DORKFI_USDC_MARKET_APP_ID=3210682240
X402_DORKFI_USDC_ASSET_ID=31566704
```

Wallet requirements:

- USDC ASA opted in
- ALGO for txn fees and optional nt200 box funding
- Enough USDC for x402 quote fees (~0.2 USDC on roundtrip) plus 0.1 USDC deposit

Integration fixtures for both Dork.fi shapes:
`tests/integration/dorkfi-execution-shapes.test.ts`.

`test:dorkfi-execution-live` is an alias for `test:dorkfi-production`. Excluded
from `test:ci`.

## Troubleshooting

- `Caddy binary not found`:
  - run `npm run build:caddy-x402`
- `Caddy exited early`:
  - inspect test output logs from `tests/helpers/caddyHarness.ts`
  - verify `caddy/Caddyfile` syntax and environment values
- E2E passes locally but fails in CI:
  - confirm the CI environment has Go and `xcaddy` available for binary build

