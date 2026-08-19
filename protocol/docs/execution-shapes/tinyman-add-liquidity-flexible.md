# Tinyman v2 Flexible Add Liquidity (execution shape)

This document describes the first verified transaction-shape spec in the Canix
execution layer: adding two-sided liquidity to an existing Tinyman AMM v2 pool
with flexible amounts.

- Shape key: `mainnet:tinyman:v2:addLiquidity:flexible`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/tinyman/add-liquidity-flexible.ts`
- Supported opportunity types: `lp`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

## Calling the x402 execution quote endpoint

Agents can request an unsigned transaction group through the paid execution
API rather than calling the shape module directly.

1. Preflight `POST /execution/quotes` without `PAYMENT-SIGNATURE` to receive
   `402` and `PAYMENT-REQUIRED`.
2. Sign the USDC payment and retry with `PAYMENT-SIGNATURE`.
3. Parse `data.encodedTransactions` from the `200` response and sign those
   unsigned Algorand transactions locally. Canix does not submit them.

Example request body:

```json
{
  "shapeKey": "mainnet:tinyman:v2:addLiquidity:flexible",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "assetAId": 31566704,
    "assetAAmount": "1000000",
    "assetBId": 0,
    "assetBAmount": "2000000",
    "maxSlippageBps": 50
  }
}
```

The response includes `data.transactions` (fixture-friendly metadata),
`data.encodedTransactions` (base64 msgpack for signing), `data.expiresAt`, and
`meta.executionSubmitted: false`.

## What this shape does

Given an execution intent such as "add liquidity to a Tinyman pool", the shape
deterministically compiles the current pool state and requested amounts into an
unsigned transaction group. It never signs or submits; signing is the caller's
responsibility. Callers receive an `ExecutableQuote` with a serialized view of
the group, base64 unsigned transactions for signing, an expiry, and metadata.

## Role of Canix vs the Tinyman SDK

The Tinyman JavaScript SDK is the canonical builder. Canix wraps
`AddLiquidity.v2.flexible.getQuote` and `AddLiquidity.v2.flexible.generateTxns`
and then applies its own independent validation. The SDK is trusted to
construct the group; it is not trusted blindly. Every generated group must pass
Canix-owned invariants before a quote is returned.

Decision rationale (builder spike):

- The SDK exposes stable, unsigned transaction generation (`generateTxns`),
  returning a group that already has a group id assigned.
- Inspecting the SDK build confirms it uses the documented method arguments
  (`add_liquidity`, `flexible`) and `assignGroupID`, matching the protocol docs.
- Re-implementing group construction with `algosdk` directly would duplicate
  protocol logic (pool math, min output, fee loading) with no correctness gain,
  so we wrap the SDK and validate its output.

## Expected transaction group

For flexible add liquidity to an existing, ready pool, the group is exactly
three outer transactions in this order:

1. Asset transfer: user -> pool, asset 1, requested asset1 amount.
2. Asset transfer (or ALGO payment when asset 2 is ALGO): user -> pool, asset 2,
   requested asset2 amount.
3. Application call: user -> Tinyman AMM v2 validator app.
   - App args begin with `add_liquidity`, `flexible`, followed by min output.
   - Foreign assets include the pool token id.
   - Accounts include the pool address.
   - The app-call fee is loaded to cover inner transactions (3 x min fee per
     Tinyman v2 docs).

Asset ordering follows Tinyman convention: asset 1 is the higher asset id and
asset 2 is the lower id, so native ALGO (id `0`) is always asset 2. Caller
inputs (`assetA`/`assetB`) are normalized to this ordering by
`orderTinymanAssets`.

## Validation invariants

`validate` runs against the serialized group and rejects the quote unless all of
the following hold:

- The group has exactly three transactions.
- Transaction 1 is an asset transfer of asset 1 from the user to the pool for
  the requested amount.
- Transaction 2 is an asset transfer of asset 2 (or an ALGO payment when asset 2
  is ALGO) from the user to the pool for the requested amount.
- Transaction 3 is an application call from the user to the expected Tinyman v2
  validator app id, with first two app args `add_liquidity` and `flexible`,
  foreign assets including the pool token id, and accounts including the pool
  address.
- The application-call fee covers inner transactions.
- All transactions belong to a single atomic group.

## On-chain state resolution

`resolveTinymanV2PoolState` (`src/execution/shapes/tinyman/pool-state.ts`)
resolves execution-critical values from the Tinyman SDK / chain rather than the
discovery API:

- Pool info via `poolUtils.v2.getPoolInfo`.
- Pool address from the pool logicsig account.
- Pool token id from pool info.
- Validator app id via `getValidatorAppID(network, v2)`.
- Asset decimals via the shared `resolveAssetDecimals` service.

The resolver rejects pools that are not created, not ready, or missing a pool
token id.

## Inputs

| Field | Notes |
|---|---|
| `userAddress` | Signing/owning address. Basic format checks here; full checksum validation happens in the SDK build. |
| `assetAId`, `assetBId` | Distinct asset ids. Normalized to Tinyman asset1/asset2 ordering. |
| `assetAAmount`, `assetBAmount` | Positive integer amounts in base units. |
| `maxSlippageBps` | Integer basis points (0-10000). Converted to a fraction for the SDK quote. |
| `poolId` | Optional discovery/opportunity id, carried into quote metadata for traceability. |

## Evidence and tests

- Deterministic fixtures and validator negatives:
  `tests/integration/tinyman-add-liquidity-shape.test.ts`
- Registry, orchestration, serialization, and expiry:
  `tests/integration/execution-registry.test.ts`
- Optional live verification (generate, never submit):
  `tests/live/tinyman-add-liquidity-shape-live.test.ts`, gated behind
  `X402_TINYMAN_SHAPE_LIVE=1`.
- Production live (x402 + on-chain): `tests/live/tinyman-production-test.test.ts`
  scenarios `add` / `roundtrip` (0.1 USDC + proportional ALGO, gated by
  `X402_TINYMAN_EXECUTION_LIVE=1`).

Source references:

- SDK: `@tinymanorg/tinyman-js-sdk` `AddLiquidity.v2.flexible`.
- Docs: Tinyman v2 integration, add subsequent liquidity (flexible),
  <https://docs.tinyman.org/v2-integration/protocol-methods/add-subsequent-liquidity>.

## Scope and caveats

Protocol-wide Tinyman construction notes (pool discovery, LP-token opt-in, slippage
fraction, validator app id): [protocol-caveats.md](./protocol-caveats.md#tinyman).

- This shape covers subsequent (flexible) liquidity into an existing, ready
  pool only.
- Initial liquidity (`add_initial_liquidity`) and single-asset liquidity are
  intentionally out of scope for this shape and will be separate, separately
  verified shape modules.
- The shape does not opt the user into the pool token asset. Opt-in handling and
  minimum-balance checks are follow-up concerns for the execution/signing layer.
- Quotes carry an expiry; consumers must treat an expired quote as stale and
  recompile before signing. Submission of signed groups is not part of this
  slice.
- Only mainnet is registered today. The shape key is network-scoped so a testnet
  variant can be added without ambiguity.
