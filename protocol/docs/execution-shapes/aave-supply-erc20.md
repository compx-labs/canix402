# Aave V3 supply (execution shape)

- Shape key: `base:aave:v3:supply:erc20`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/aave/supply-erc20.ts`
- Supported opportunity types: `lending`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402 on Algorand or Base)

## Example request

```json
{
  "shapeKey": "base:aave:v3:supply:erc20",
  "input": {
    "userAddress": "0xYOUR_BASE_ADDRESS",
    "assetAddress": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "amount": "1000000"
  }
}
```

`amount` is underlying ERC-20 base units. `poolId` is accepted as an alias for `assetAddress`. `onBehalfOf` must be omitted or equal `userAddress`.

## Expected unsigned calls

1. Optional ERC-20 `approve(pool, amount)` when `allowance < amount`. The spender is the Aave V3 Base Pool `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`.
2. `Pool.supply(asset, amount, onBehalfOf, 0)`.

`identity.network` is `base`. `encodedTransactions` are calldata hex. Canix does not sign or submit.

## Validation invariants

- Supply calldata selector is `0x617ba037`.
- Approve, when present, targets the underlying and uses `0x095ea7b3`.
- `executionSubmitted` remains `false`.

## Caveats

- Quote-time `getConfiguration` rejects paused, frozen, or inactive reserves.
- Protocol-wide notes: [protocol-caveats.md](./protocol-caveats.md#aave-v3).
