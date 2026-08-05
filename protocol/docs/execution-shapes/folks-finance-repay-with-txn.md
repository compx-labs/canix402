# Folks Finance v2 Repay With Transfer

Repays Folks Finance debt by transferring the underlying asset from the user wallet.

- Shape key: `mainnet:folks-finance:v2:repay:withTxn`
- Source module: `src/execution/shapes/folks-finance/repay-with-txn.ts`
- Opportunity role: `exit` (attached to Folks debt positions)

## Example request

```json
{
  "shapeKey": "mainnet:folks-finance:v2:repay:withTxn",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "escrowAddress": "YOUR_LOAN_ESCROW_ADDRESS",
    "poolAppId": 971372237,
    "repayAmount": "500000"
  }
}
```

`isStable` defaults to `false`. `receiverAddress` (reward residual) defaults to the user; deposit escrow is typical in production.
