# Folks Finance v2 Setup — Opt Escrow Into Pool fAsset

Opts an existing deposit escrow into a pool fAsset so it can receive deposits.

- Shape key: `mainnet:folks-finance:v2:setup:optEscrowAsset`
- Source module: `src/execution/shapes/folks-finance/setup-opt-escrow-asset.ts`

## Example request

```json
{
  "shapeKey": "mainnet:folks-finance:v2:setup:optEscrowAsset",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "escrowAddress": "YOUR_DEPOSIT_ESCROW_ADDRESS",
    "poolAppId": 971372237
  }
}
```

## Expected transaction group

Two outer transactions:

1. Payment: user → escrow for the recoverable **0.1 ALGO** (100_000 µA) fAsset
   opt-in minimum balance.
2. Deposits-app `opt_escrow_into_asset` call.

Do not drop the funding payment. See
[protocol-caveats.md](./protocol-caveats.md#minimum-balance-and-escrow-funding).
