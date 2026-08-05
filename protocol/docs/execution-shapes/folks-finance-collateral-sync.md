# Folks Finance v2 Collateral Sync

Registers fAsset balance held by a loan escrow as collateral.

- Shape key: `mainnet:folks-finance:v2:collateral:sync`
- Source module: `src/execution/shapes/folks-finance/collateral-sync.ts`
- Opportunity role: `manage`

## Example request

```json
{
  "shapeKey": "mainnet:folks-finance:v2:collateral:sync",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "escrowAddress": "YOUR_LOAN_ESCROW_ADDRESS",
    "poolAppId": 971372237
  }
}
```

`includeOpUp` defaults to `true`. Deposit fAssets into the loan escrow before syncing.
