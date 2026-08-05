# Folks Finance v2 Reduce Collateral

Withdraws collateral from a loan escrow to a receiver (typically the deposit escrow).

- Shape key: `mainnet:folks-finance:v2:collateral:reduce`
- Source module: `src/execution/shapes/folks-finance/collateral-reduce.ts`
- Opportunity role: `exit` (attached to Folks collateral positions)

## Example request

```json
{
  "shapeKey": "mainnet:folks-finance:v2:collateral:reduce",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "escrowAddress": "YOUR_LOAN_ESCROW_ADDRESS",
    "poolAppId": 971372237,
    "amount": "500000",
    "amountDenomination": "fAsset",
    "receiverAddress": "YOUR_DEPOSIT_ESCROW_ADDRESS"
  }
}
```

`amountDenomination` is `"asset"` or `"fAsset"`. `includeOpUp` defaults to `true`.
