# Folks Finance v2 Escrow Withdraw (execution shape)

Withdraws underlying assets from a Folks Finance lending pool via a **deposit
escrow** to the user's wallet.

- Shape key: `mainnet:folks-finance:v2:withdraw:escrow`
- Source module: `src/execution/shapes/folks-finance/withdraw-escrow.ts`

## Example request

```json
{
  "shapeKey": "mainnet:folks-finance:v2:withdraw:escrow",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "poolAppId": 971372237,
    "escrowAddress": "YOUR_DEPOSIT_ESCROW_ADDRESS",
    "amount": "500000",
    "amountDenomination": "fAsset"
  }
}
```

## Amount semantics

| `amountDenomination` | SDK mapping |
|---|---|
| `fAsset` | `isfAssetAmount=true`, underlying sent to user wallet |
| `asset` | `isfAssetAmount=false`, exact asset amount requested |

## Expected transaction group

Single deposits-app `withdraw` application call (fee 6000 microAlgos).
