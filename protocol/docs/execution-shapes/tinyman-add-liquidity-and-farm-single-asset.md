# Tinyman v2 single-asset add liquidity and farm commit

- Shape key: `mainnet:tinyman:v2:addLiquidityAndFarm:singleAsset`
- Role: enter (`farm`)
- Source module: `protocol/src/execution/shapes/tinyman/add-liquidity-and-farm-single-asset.ts`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

Atomically adds single-asset liquidity to a Tinyman AMM v2 pool and commits the
resulting LP into a Tinyman farm. LP stays in the wallet after commit.

## Required inputs

- `userAddress`
- `assetAId`, `assetBId`
- `depositAssetId`, `depositAmount`
- `maxSlippageBps`
- Optional: `programId` + `programAccount`, `commitAmount` (defaults to
  guaranteed minimum pool tokens from the add quote), `requiredAssetId`, `poolId`

## Expected transaction group

1. Two single-asset add-liquidity transactions (same as `addLiquidity:singleAsset`).
2. Farm commit suffix via `prepareCommitTransactions`.

All transactions are regrouped into one atomic group.

## Caveats

- Single-asset add swaps part of the deposit into the other side inside the pool.
- Opt-in to the LP asset (if needed) is outside this shape.
- Quotes expire; recompile before signing if stale.
