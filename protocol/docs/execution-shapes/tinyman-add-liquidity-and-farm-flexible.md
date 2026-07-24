# Tinyman v2 flexible add liquidity and farm commit

- Shape key: `mainnet:tinyman:v2:addLiquidityAndFarm:flexible`
- Role: enter (`farm`)
- Source module: `protocol/src/execution/shapes/tinyman/add-liquidity-and-farm-flexible.ts`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

Atomically adds two-sided flexible liquidity to a Tinyman AMM v2 pool and
commits the resulting LP into a Tinyman farm. LP stays in the wallet after
commit (unlike Pact farm escrow).

## Required inputs

- `userAddress`
- `assetAId`, `assetAAmount`, `assetBId`, `assetBAmount`
- `maxSlippageBps`
- Optional: `programId` + `programAccount`, `commitAmount` (defaults to
  guaranteed minimum pool tokens from the add quote), `requiredAssetId`, `poolId`

## Expected transaction group

1. Three flexible add-liquidity transactions (same as `addLiquidity:flexible`).
2. Farm commit suffix via `prepareCommitTransactions`.

All transactions are regrouped into one atomic group.

## Caveats

- Caller must already hold / be able to fund both sides of the pool.
- Opt-in to the LP asset (if needed) is outside this shape.
- Quotes expire; recompile before signing if stale.
