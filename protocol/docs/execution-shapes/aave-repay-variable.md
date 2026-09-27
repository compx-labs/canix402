# Aave V3 variable repay (execution shape)

- Shape key: `base:aave:v3:repay:variable`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/aave/repay-variable.ts`
- Supported opportunity types: `lending`
- Role: exit on a variable-debt position.
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402 on Algorand or Base)

## Example request

```json
{
  "shapeKey": "base:aave:v3:repay:variable",
  "input": {
    "userAddress": "0xYOUR_BASE_ADDRESS",
    "assetAddress": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "amount": "1000000"
  }
}
```

## Expected unsigned calls

1. Optional ERC-20 `approve(pool, amount)` when allowance is short.
2. `Pool.repay(asset, amount, 2, onBehalfOf)`. Interest-rate mode `2` is variable.

## Validation invariants

- Repay calldata selector is `0x573ade81`.
- Approve, when present, uses `0x095ea7b3`.

## Caveats

- Quote-time `getConfiguration` rejects paused, frozen, or inactive reserves.
- Protocol-wide notes: [protocol-caveats.md](./protocol-caveats.md#aave-v3).
