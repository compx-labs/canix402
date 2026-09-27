# Aave V3 variable borrow (execution shape)

- Shape key: `base:aave:v3:borrow:variable`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/aave/borrow-variable.ts`
- Supported opportunity types: `lending`
- Role: manage on a supplied position. Not an anonymous catalog enter shape.
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402 on Algorand or Base)

## Example request

```json
{
  "shapeKey": "base:aave:v3:borrow:variable",
  "input": {
    "userAddress": "0xYOUR_BASE_ADDRESS",
    "assetAddress": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "amount": "1000000"
  }
}
```

## Expected unsigned calls

1. `Pool.borrow(asset, amount, 2, 0, onBehalfOf)`. Interest-rate mode `2` is variable.

## Validation invariants

- One EVM call targeting the Aave V3 Base Pool.
- Calldata selector is `0xa415bcad`.

## Caveats

- Rejected when the reserve is paused, frozen, inactive, or borrowing is disabled.
- eMode and isolation-mode ceilings are not modeled.
- Protocol-wide notes: [protocol-caveats.md](./protocol-caveats.md#aave-v3).
