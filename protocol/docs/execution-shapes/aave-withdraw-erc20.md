# Aave V3 withdraw (execution shape)

- Shape key: `base:aave:v3:withdraw:erc20`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/aave/withdraw-erc20.ts`
- Supported opportunity types: `lending`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402 on Algorand or Base)

## Example request

```json
{
  "shapeKey": "base:aave:v3:withdraw:erc20",
  "input": {
    "userAddress": "0xYOUR_BASE_ADDRESS",
    "assetAddress": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "amount": "1000000"
  }
}
```

`amount` is underlying base units. The receiver is `userAddress`.

## Expected unsigned calls

1. `Pool.withdraw(asset, amount, to)`.

## Validation invariants

- One EVM call targeting the Aave V3 Base Pool.
- Calldata selector is `0x69328dec`.

## Caveats

- Quote-time `getConfiguration` rejects paused, frozen, or inactive reserves.
- Protocol-wide notes: [protocol-caveats.md](./protocol-caveats.md#aave-v3).
