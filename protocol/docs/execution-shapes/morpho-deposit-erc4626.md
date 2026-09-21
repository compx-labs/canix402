# Morpho Vault ERC-4626 deposit (execution shape)

- Shape key: `base:morpho:vault:deposit:erc4626`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/morpho/deposit-erc4626.ts`
- Supported opportunity types: `lending`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402 on Algorand)

## Example request

```json
{
  "shapeKey": "base:morpho:vault:deposit:erc4626",
  "input": {
    "userAddress": "0xYOUR_BASE_ADDRESS",
    "vaultAddress": "0xef417a2512C5a41f69AE4e021648b69a7CdE5D03",
    "amount": "1000000"
  }
}
```

`amount` is **underlying ERC-20 base units** (6 decimals for USDC/EURC). `poolId` is accepted as an alias for `vaultAddress`. Optional `receiver` defaults to `userAddress`. Optional `assetAddress` is resolved on-chain via `asset()` when omitted.

## Expected unsigned calls

1. Optional ERC-20 `approve(vault, amount)` when `allowance < amount`.
2. Vault `deposit(assets, receiver)`.

`identity.network` is `base`. `encodedTransactions` are calldata hex. Structured `{ to, data, value, chainId }` also appears on `transactions[].evmCall` and `metadata.evmCalls`. Algorand `pay`/`axfer`/`appl` members are not present.

Canix does not sign, submit, use Permit2, or wrap native ETH.

## Validation invariants

- Every member has `type: "evm"` and `chainId` 8453.
- Deposit calldata selector is `0x6e553f65`.
- Approve, when present, targets the vault underlying and uses `0x095ea7b3`.
- `executionSubmitted` remains `false`.

## Caveats

- Quote-time `previewDeposit` shares are a snapshot. Re-quote if share price moves.
- Native ETH Morpho vaults are rejected.
- Protocol-wide notes: [protocol-caveats.md](./protocol-caveats.md#morpho-vaults).

## Tests

- Unit fixtures: `tests/unit/morpho-execution-shapes.test.ts`
- Integration fixtures: `tests/integration/morpho-execution-shapes.test.ts`
