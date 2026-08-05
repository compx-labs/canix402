# Folks Finance v2 Setup — Add Collateral

Opts a loan escrow into a pool fAsset so collateral can be deposited and synced.

- Shape key: `mainnet:folks-finance:v2:setup:addCollateral`
- Source module: `src/execution/shapes/folks-finance/setup-add-collateral.ts`
- Opportunity role: `enter`

## Example request

```json
{
  "shapeKey": "mainnet:folks-finance:v2:setup:addCollateral",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "escrowAddress": "YOUR_LOAN_ESCROW_ADDRESS",
    "poolAppId": 971372237
  }
}
```

Provide exactly one of `poolAppId` or `assetId`. `loanAppId` defaults to GENERAL.
