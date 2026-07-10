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

Single deposits-app `opt_escrow_into_asset` call (fee 2000 microAlgos).
