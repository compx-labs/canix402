# Folks Finance v2 Setup — Create Loan Escrow

Creates a new Folks Finance loan escrow for the user.

- Shape key: `mainnet:folks-finance:v2:setup:loanEscrow`
- Source module: `src/execution/shapes/folks-finance/setup-loan-escrow.ts`
- Opportunity role: `enter`

## Example request

```json
{
  "shapeKey": "mainnet:folks-finance:v2:setup:loanEscrow",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS"
  }
}
```

`loanAppId` is optional and defaults to `MainnetLoans.GENERAL` (`971388781`).

## Signing requirements

The group has **two signers**:

1. User — funding + registration transactions
2. Generated loan escrow — opt-in / `create_loan`

Metadata includes `escrowAddress` and `escrowPrivateKeyBase64`.

## Next steps

1. `setup:addCollateral` for the target pool
2. Deposit fAssets into the loan escrow (`deposit:escrow` with `escrowAddress` = loan escrow)
3. `collateral:sync`, then optionally `borrow:variable`
