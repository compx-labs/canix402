# Tinyman v2 Initial Add Liquidity (execution shape)

This document describes the Tinyman AMM v2 initial add-liquidity transaction shape for
depositing the first liquidity into a bootstrapped but empty pool.

- Shape key: `mainnet:tinyman:v2:addLiquidity:initial`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/tinyman/add-liquidity-initial.ts`
- Supported opportunity types: `lp`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

## Example request

```json
{
  "shapeKey": "mainnet:tinyman:v2:addLiquidity:initial",
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

## What this shape does

Compiles a two-sided initial liquidity deposit into an unsigned 3-transaction group.
Use this only when the pool exists but has no reserves yet. For pools that already
have liquidity, use `addLiquidity:flexible` or `addLiquidity:singleAsset`.

## Expected transaction group

1. Asset transfer: user → pool, asset 1, requested asset1 amount.
2. Asset transfer (or ALGO payment when asset 2 is ALGO): user → pool, asset 2.
3. Application call: user → Tinyman AMM v2 validator app.
   - App args: `[add_initial_liquidity]`
   - Foreign assets: `[poolTokenId]`
   - Accounts: `[poolAddress]`
   - Fee: 2 × min_fee

## Pool state requirements

`resolveTinymanV2PoolStateForInitialAdd` rejects:

- Pools that do not exist
- Pools that are already `READY` (have liquidity)
- Pools with non-empty reserves

## Inputs

| Field | Notes |
|---|---|
| `userAddress` | Signing/owning address |
| `assetAId`, `assetBId` | Distinct asset ids; normalized to Tinyman asset1/asset2 ordering |
| `assetAAmount`, `assetBAmount` | Positive integer amounts in base units |
| `maxSlippageBps` | Integer basis points (0–10000) |
| `poolId` | Optional discovery id for traceability |

## Evidence and tests

- Integration: `tests/integration/tinyman-add-liquidity-initial-shape.test.ts`
- SDK: `@tinymanorg/tinyman-js-sdk` `AddLiquidity.v2.initial`
- Docs: <https://docs.tinyman.org/v2-integration/protocol-methods/add-initial-liquidity>

## Scope and caveats

- Empty/bootstrapped pools only; rejects ready pools with existing liquidity.
- Does not opt the user into the pool token asset.
- Mainnet only today.
