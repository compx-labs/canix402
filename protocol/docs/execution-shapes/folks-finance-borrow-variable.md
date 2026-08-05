# Folks Finance v2 Variable Borrow

Borrows an underlying asset against loan escrow collateral at a variable rate.

- Shape key: `mainnet:folks-finance:v2:borrow:variable`
- Source module: `src/execution/shapes/folks-finance/borrow-variable.ts`
- Opportunity role: `enter` (also attached as manage on Folks collateral positions)

## Example request

```json
{
  "shapeKey": "mainnet:folks-finance:v2:borrow:variable",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "escrowAddress": "YOUR_LOAN_ESCROW_ADDRESS",
    "poolAppId": 971372237,
    "borrowAmount": "1000000"
  }
}
```

`receiverAddress` defaults to the user. `includeOpUp` defaults to `true`. Uses `maxStableRate=0`.
