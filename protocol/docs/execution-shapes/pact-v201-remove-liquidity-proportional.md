# Pact v201 Proportional Remove Liquidity (execution shape)

- Shape key: `mainnet:pact:v201:removeLiquidity:proportional`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/pact/remove-liquidity-managed-weighted.ts`
- Supported opportunity types: `lp`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

This is the exit shape on listed Pact LP opportunities and on wallet LP
positions whose catalog pool is not deprecated. Deprecated v100 positions keep
`mainnet:pact:v1:removeLiquidity:proportional`.

## Example request

```json
{
  "shapeKey": "mainnet:pact:v201:removeLiquidity:proportional",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "poolAppId": 3662410374,
    "liquidityAmount": "1000000",
    "maxSlippageBps": 50
  }
}
```

## Expected transaction group

1. LP asset transfer of `liquidityAmount` to the pool application address.
2. Application call on the pool. Selector `U6NrJA==`, then two uint64 minimum
   outputs (`asset_a`, then `asset_b`). Foreign app is the vault. Foreign
   assets are the non-ALGO pool asset. The outer fee is 3000 microAlgos.

Minimums are `reserve * liquidityAmount / issued_lp`, then reduced by
`maxSlippageBps`.

## Validation invariants

- Exactly 2 transactions, atomically grouped.
- LP transfer receiver is the pool application address, amount is `liquidityAmount`.
- App-call arguments decode to the proportional minimums for the quoted slippage.

## Caveats

- Pools with `bootstrapped` other than `1`, or with zero reserves, are rejected.
- Quotes expire after 30 seconds; recompile before signing stale groups.

## Tests

- Integration fixtures: `tests/integration/pact-managed-weighted-shapes.test.ts`
