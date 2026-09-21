# Morpho Vault ERC-4626 redeem (execution shape)

- Shape key: `base:morpho:vault:redeem:erc4626`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/morpho/redeem-erc4626.ts`
- Supported opportunity types: `lending`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402 on Algorand or Base)

## Example request

```json
{
  "shapeKey": "base:morpho:vault:redeem:erc4626",
  "input": {
    "userAddress": "0xYOUR_BASE_ADDRESS",
    "vaultAddress": "0xef417a2512C5a41f69AE4e021648b69a7CdE5D03",
    "shares": "1000000"
  }
}
```

`shares` is vault share base units. `amount` is accepted as an alias. `owner` must equal `userAddress`. Optional `receiver` defaults to `userAddress`.

## Expected unsigned calls

1. Vault `redeem(shares, receiver, owner)` — selector `0xba087652`.

Force-withdraw is not registered.

## Caveats

- Previewed assets (`previewRedeem`) expire with the quote TTL.
- Protocol-wide notes: [protocol-caveats.md](./protocol-caveats.md#morpho-vaults).

## Tests

- Unit fixtures: `tests/unit/morpho-execution-shapes.test.ts`
- Integration fixtures: `tests/integration/morpho-execution-shapes.test.ts`
