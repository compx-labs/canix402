# Tinyman v2 Remove Liquidity — Single Asset Out (execution shape)

This document describes the Tinyman AMM v2 remove-liquidity transaction shape that
returns a single chosen pool asset via an internal swap.

- Shape key: `mainnet:tinyman:v2:removeLiquidity:singleAssetOut`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/tinyman/remove-liquidity-single-asset-out.ts`
- Supported opportunity types: `lp`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

## Example request

```json
{
  "shapeKey": "mainnet:tinyman:v2:removeLiquidity:singleAssetOut",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "assetAId": 31566704,
    "assetBId": 0,
    "outputAssetId": 31566704,
    "poolTokenAmount": "500000",
    "maxSlippageBps": 50
  }
}
```

## What this shape does

Compiles an LP token burn into an unsigned 2-transaction group. Tinyman removes
liquidity proportionally, then performs an internal swap so the user receives only
the requested output asset.

## Expected transaction group

1. Asset transfer: user → pool, pool token asset, requested pool token amount.
2. Application call: user → Tinyman AMM v2 validator app.
   - App args: `[remove_liquidity, minAsset1Out, minAsset2Out]`
   - Foreign assets: `[outputAssetId]` only (not both pool assets)
   - Accounts: `[poolAddress]`
   - Fee: 3 × min_fee

## Inputs

| Field | Notes |
|---|---|
| `userAddress` | Signing/owning address |
| `assetAId`, `assetBId` | Pool pair identifiers |
| `outputAssetId` | Must equal `assetAId` or `assetBId` — the asset to receive |
| `poolTokenAmount` | Positive integer LP tokens to burn in base units |
| `maxSlippageBps` | Integer basis points (0–10000) |
| `poolId` | Optional discovery id for traceability |

## Evidence and tests

- Integration: `tests/integration/tinyman-remove-liquidity-single-asset-out-shape.test.ts`
- Production live (x402 + on-chain): `tests/live/tinyman-production-test.test.ts`
  scenarios `singleAssetOutRemove` / `singleAssetRoundtrip` (USDC output only,
  gated by `X402_TINYMAN_EXECUTION_LIVE=1`)
- SDK: `@tinymanorg/tinyman-js-sdk` `RemoveLiquidity.v2.generateSingleAssetOutTxns`
- Docs: <https://docs.tinyman.org/v2-integration/protocol-methods/remove-liquidity>

## Scope and caveats

- Caller must already hold the pool token asset.
- Use `removeLiquidity:multipleAssetsOut` to receive both pool assets.
- Mainnet only today.
