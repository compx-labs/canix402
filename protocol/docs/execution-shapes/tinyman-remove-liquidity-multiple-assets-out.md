# Tinyman v2 Remove Liquidity — Multiple Assets Out (execution shape)

This document describes the Tinyman AMM v2 remove-liquidity transaction shape
that returns both pool assets proportionally.

- Shape key: `mainnet:tinyman:v2:removeLiquidity:multipleAssetsOut`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/tinyman/remove-liquidity-multiple-assets-out.ts`
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
  "shapeKey": "mainnet:tinyman:v2:removeLiquidity:multipleAssetsOut",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "assetAId": 31566704,
    "assetBId": 0,
    "poolTokenAmount": "500000",
    "maxSlippageBps": 50
  }
}
```

The response includes `data.transactions` (fixture-friendly metadata),
`data.encodedTransactions` (base64 msgpack for signing), `data.expiresAt`, and
`meta.executionSubmitted: false`.

## What this shape does

Given a strategy leg such as "remove liquidity from a Tinyman pool", the shape
deterministically compiles the current pool state and requested LP token burn
amount into an unsigned transaction group. It never signs or submits; signing is
the caller's responsibility. Callers receive an `ExecutableQuote` with a
serialized view of the group, base64 unsigned transactions for signing, an
expiry, and metadata.

## Role of Canix vs the Tinyman SDK

The Tinyman JavaScript SDK is the canonical builder. Canix wraps
`RemoveLiquidity.v2.getQuote` and `RemoveLiquidity.v2.generateTxns` and then
applies its own independent validation. The SDK is trusted to construct the
group; it is not trusted blindly. Every generated group must pass Canix-owned
invariants before a quote is returned.

## Expected transaction group

For multiple-assets-out remove liquidity from an existing, ready pool, the group
is exactly two outer transactions in this order:

1. Asset transfer: user → pool, pool token asset, requested pool token amount.
2. Application call: user → Tinyman AMM v2 validator app.
   - App args begin with `remove_liquidity`, followed by min asset 1 out and
     min asset 2 out.
   - Foreign assets include both pool assets (asset 1 and asset 2).
   - Accounts include the pool address.
   - The app-call fee is loaded to cover inner transactions (3 × min fee per
     Tinyman v2 docs).

Asset ordering follows Tinyman convention: asset 1 is the higher asset id and
asset 2 is the lower id, so native ALGO (id `0`) is always asset 2. Caller
inputs (`assetA`/`assetB`) identify the pool pair and are normalized by
`orderTinymanAssets`.

## Validation invariants

`validate` runs against the serialized group and rejects the quote unless all of
the following hold:

- The group has exactly two transactions.
- Transaction 1 is a pool token asset transfer from the user to the pool for
  the requested amount.
- Transaction 2 is an application call from the user to the expected Tinyman v2
  validator app id, with first app arg `remove_liquidity`, foreign assets
  including both pool assets, and accounts including the pool address.
- The application-call fee covers inner transactions.
- All transactions belong to a single atomic group.

## On-chain state resolution

`resolveTinymanV2PoolState` and `resolveTinymanV2PoolReserves`
(`src/execution/shapes/tinyman/pool-state.ts`) resolve execution-critical
values from the Tinyman SDK / chain rather than the discovery API:

- Pool info via `poolUtils.v2.getPoolInfo`.
- Pool reserves via `poolUtils.v2.getPoolReserves`.
- Pool address from the pool logicsig account.
- Pool token id from pool info.
- Validator app id via `getValidatorAppID(network, v2)`.

The resolver rejects pools that are not created, not ready, or missing a pool
token id.

## Inputs

| Field | Notes |
|---|---|
| `userAddress` | Signing/owning address. Basic format checks here; full checksum validation happens in the SDK build. |
| `assetAId`, `assetBId` | Distinct asset ids identifying the pool pair. Normalized to Tinyman asset1/asset2 ordering. |
| `poolTokenAmount` | Positive integer amount of pool tokens to burn in base units. |
| `maxSlippageBps` | Integer basis points (0-10000). Converted to a fraction for the SDK quote. |
| `poolId` | Optional discovery/opportunity id, carried into quote metadata for traceability. |

## Evidence and tests

- Deterministic fixtures and validator negatives:
  `tests/integration/tinyman-remove-liquidity-shape.test.ts`
- Registry, orchestration, serialization, and expiry:
  `tests/integration/execution-registry.test.ts`
- Optional live verification (generate, never submit):
  `tests/live/tinyman-remove-liquidity-shape-live.test.ts`, gated behind
  `X402_TINYMAN_SHAPE_LIVE=1`.
- Production live (x402 + on-chain): `tests/live/tinyman-production-test.test.ts`
  scenarios `remove` / `roundtrip` (gated by `X402_TINYMAN_EXECUTION_LIVE=1`).

Source references:

- SDK: `@tinymanorg/tinyman-js-sdk` `RemoveLiquidity.v2`.
- Docs: Tinyman v2 integration, remove liquidity (multiple assets out),
  <https://docs.tinyman.org/v2-integration/protocol-methods/remove-liquidity>.

## Scope and caveats

- This shape covers multiple-assets-out removal from an existing, ready pool
  only.
- Single-asset-out removal is intentionally out of scope for this shape and
  will be a separate, separately verified shape module.
- The caller must already hold the pool token asset. Balance checks and
  opt-in handling are follow-up concerns for the execution/signing layer.
- Quotes carry an expiry; consumers must treat an expired quote as stale and
  recompile before signing. Submission of signed groups is not part of this
  slice.
- Only mainnet is registered today. The shape key is network-scoped so a testnet
  variant can be added without ambiguity.
