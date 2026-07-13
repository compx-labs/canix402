# Tinyman v2 Single-Asset Add Liquidity (execution shape)

This document describes the Tinyman AMM v2 single-asset add-liquidity transaction
shape for depositing one side of a pair into an existing pool.

- Shape key: `mainnet:tinyman:v2:addLiquidity:singleAsset`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/tinyman/add-liquidity-single-asset.ts`
- Supported opportunity types: `lp`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

## Example request

```json
{
  "shapeKey": "mainnet:tinyman:v2:addLiquidity:singleAsset",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "assetAId": 31566704,
    "assetBId": 0,
    "depositAssetId": 31566704,
    "depositAmount": "1000000",
    "maxSlippageBps": 50
  }
}
```

## What this shape does

Compiles a one-sided liquidity deposit into an unsigned 2-transaction group. Tinyman
performs an internal swap to balance the deposit and mints pool tokens. Requires an
existing, ready pool with liquidity.

## Expected transaction group

1. Asset transfer (or ALGO payment): user → pool, deposit asset, deposit amount.
2. Application call: user → Tinyman AMM v2 validator app.
   - App args: `[add_liquidity, single, minPoolTokenOut]`
   - Foreign assets: `[poolTokenId]`
   - Accounts: `[poolAddress]`
   - Fee: 3 × min_fee

## Inputs

| Field | Notes |
|---|---|
| `userAddress` | Signing/owning address |
| `assetAId`, `assetBId` | Pool pair identifiers |
| `depositAssetId` | Must equal `assetAId` or `assetBId` |
| `depositAmount` | Positive integer amount in base units |
| `maxSlippageBps` | Integer basis points (0–10000) |
| `poolId` | Optional discovery id for traceability |

## Evidence and tests

- Integration: `tests/integration/tinyman-add-liquidity-single-asset-shape.test.ts`
- Production live (x402 + on-chain): `tests/live/tinyman-production-test.test.ts`
  scenarios `singleAssetAdd` / `singleAssetRoundtrip` (0.1 USDC deposit, gated by
  `X402_TINYMAN_EXECUTION_LIVE=1`)
- SDK: `@tinymanorg/tinyman-js-sdk` `AddLiquidity.v2.withSingleAsset`
- Docs: <https://docs.tinyman.org/v2-integration/protocol-methods/add-subsequent-liquidity>

## Scope and caveats

- Existing ready pools only; use `addLiquidity:initial` for empty pools.
- Does not opt the user into the pool token asset.
- Mainnet only today.
