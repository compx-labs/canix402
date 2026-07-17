# Pact v1 two-sided add liquidity and farm stake (execution shape)

- Shape key: `mainnet:pact:v1:addLiquidityAndFarm:twoSided`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/pact/add-liquidity-and-farm-two-sided.ts`
- Supported opportunity types: `farm`
- Opportunity role: `enter`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

## Example request

```json
{
  "shapeKey": "mainnet:pact:v1:addLiquidityAndFarm:twoSided",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "farmAppId": 3625283323,
    "poolAppId": 1072843805,
    "assetAId": 31566704,
    "assetAAmount": "100000",
    "assetBId": 0,
    "assetBAmount": "50000",
    "maxSlippageBps": 50
  }
}
```

Requires an existing farm escrow (`mainnet:pact:v1:farm:deployEscrow` first).
Optional `amount` overrides the default stake amount (guaranteed minimum minted LP).

## Expected transaction group

1. Three two-sided add-liquidity transactions (same as `addLiquidity:twoSided`).
2. Farm stake suffix (`Escrow.buildStakeTxs`) transferring minted LP into escrow.

All transactions are regrouped into one atomic group. Newly minted LP leaves the
wallet into the farm escrow in the same group.

## Validation invariants

- Pool LP asset id must equal the farm staked asset id.
- Add-liquidity prefix matches the two-sided add shape.
- Stake suffix transfers LP to the farm escrow and updates the farm app.

## Caveats

- Cannot atomically create the escrow and stake; deploy must confirm first.
- Caller must supply both `farmAppId` and the underlying AMM `poolAppId`.
- Quotes expire after 30 seconds.

## Tests

- Integration: `tests/integration/execution-quotes-route.test.ts` (mocked)
- Live quote-only: `tests/live/pact-farm-shape-live.test.ts` (`X402_PACT_FARM_SHAPE_LIVE=1`)
