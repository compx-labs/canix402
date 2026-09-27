# Aerodrome unstake and remove liquidity (execution shape)

- Shape key: `base:aerodrome:v2:withdraw:gauge`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/aerodrome/withdraw-gauge.ts`
- Supported opportunity types: `farm`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402 on Algorand or Base)

## Example request

```json
{
  "shapeKey": "base:aerodrome:v2:withdraw:gauge",
  "input": {
    "userAddress": "0xYOUR_BASE_ADDRESS",
    "poolId": "0xPOOL",
    "liquidity": "1000000000000000000"
  }
}
```

`liquidity` is staked LP base units. `amount` is an alias. This shape does not claim AERO.

## Expected unsigned calls

1. `Gauge.withdraw(liquidity)`.
2. Optional `approve(router, liquidity)` on the pool LP token.
3. `Router.removeLiquidity(token0, token1, stable, liquidity, amountAMin, amountBMin, user, deadline)`.

## Validation invariants

- The group starts with `Gauge.withdraw` selector `0x2e1a7d4d`.
- Remove-liquidity selector is `0x0dede6c4`.
- Algorand transactions are rejected.

## Caveats

- Broadcast the calls in order. The LP approve and remove-liquidity must follow the gauge withdraw in the same ordered batch, or after it confirms.
- Protocol-wide notes: [protocol-caveats.md](./protocol-caveats.md#aerodrome).
