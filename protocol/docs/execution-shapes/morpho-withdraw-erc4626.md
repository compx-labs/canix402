# Morpho Vault ERC-4626 withdraw (execution shape)

- Shape key: `base:morpho:vault:withdraw:erc4626`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/morpho/withdraw-erc4626.ts`
- Supported opportunity types: `lending`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402 on Algorand or Base)

## Example request

```json
{
  "shapeKey": "base:morpho:vault:withdraw:erc4626",
  "input": {
    "userAddress": "0xYOUR_BASE_ADDRESS",
    "vaultAddress": "0xef417a2512C5a41f69AE4e021648b69a7CdE5D03",
    "amount": "1000000"
  }
}
```

`amount` is **underlying asset** base units to withdraw. `owner` must equal `userAddress` (walletless; no share Permit2). Optional `receiver` defaults to `userAddress`.

## Expected unsigned calls

1. Vault `withdraw(assets, receiver, owner)` — selector `0xb460af94`.

No approve of the underlying is required. Force-withdraw is not registered.

## Caveats

- Previewed shares (`previewWithdraw`) expire with the quote TTL.
- Protocol-wide notes: [protocol-caveats.md](./protocol-caveats.md#morpho-vaults).

## Tests

- Unit fixtures: `tests/unit/morpho-execution-shapes.test.ts`
- Integration fixtures: `tests/integration/morpho-execution-shapes.test.ts`
