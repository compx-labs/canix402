# Folks Finance v2 Setup — Add Deposit Escrow

Creates a new Folks Finance deposit escrow for the user.

- Shape key: `mainnet:folks-finance:v2:setup:depositEscrow`
- Source module: `src/execution/shapes/folks-finance/setup-deposit-escrow.ts`

## Example request

```json
{
  "shapeKey": "mainnet:folks-finance:v2:setup:depositEscrow",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS"
  }
}
```

## Signing requirements

The group has **two signers**:

1. User — first transaction
2. Generated escrow — second transaction (opt-in)

Metadata includes `escrowAddress` and `escrowPrivateKeyBase64`. Store the private
key securely; it is required to sign the escrow transaction and for future
escrow operations.

## Next step

Run `setup:optEscrowAsset` for each pool fAsset before `deposit:escrow`.
