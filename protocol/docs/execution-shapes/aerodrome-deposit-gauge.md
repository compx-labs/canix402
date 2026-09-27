# Aerodrome add liquidity and stake (execution shape)

- Shape key: `base:aerodrome:v2:deposit:gauge`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/aerodrome/deposit-gauge.ts`
- Supported opportunity types: `farm`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402 on Algorand or Base)

## Example request

```json
{
  "shapeKey": "base:aerodrome:v2:deposit:gauge",
  "input": {
    "userAddress": "0xYOUR_BASE_ADDRESS",
    "poolId": "0xPOOL",
    "amountA": "1000000000000000000",
    "amountB": "2000000000",
    "slippageBps": 50
  }
}
```

`amountA` and `amountB` are token0 and token1 base units. `poolAddress` is an alias for `poolId`. `to` must be omitted or equal `userAddress`. `slippageBps` defaults to 50 and cannot exceed 1000.

## Expected unsigned calls

1. Optional ERC-20 `approve(router, amountA)` and `approve(router, amountB)` when allowance is short. The spender is Router `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43`.
2. `Router.addLiquidity(token0, token1, stable, amountADesired, amountBDesired, amountAMin, amountBMin, user, deadline)`.
3. Optional `approve(gauge, liquidity)` on the pool LP token.
4. `Gauge.deposit(liquidity)`.

`identity.network` is `base`. `encodedTransactions` are calldata hex. Canix does not sign or submit.

## Validation invariants

- Add-liquidity selector is `0x5a47ddc3`.
- The group ends with `Gauge.deposit` selector `0xb6b55f25`.
- Approve, when present, uses `0x095ea7b3`.
- Algorand transactions are rejected.

## Caveats

- Broadcast the calls in order. The LP approve and deposit must follow add-liquidity in the same ordered batch, or after it confirms. Quoted liquidity can fail if reserves move.
- Quote-time reads reject a dead gauge and any pool whose factory is not the basic pool factory.
- Protocol-wide notes: [protocol-caveats.md](./protocol-caveats.md#aerodrome).
