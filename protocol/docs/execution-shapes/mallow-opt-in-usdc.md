# Mallow USDC opt-in

- Shape key: `mainnet:mallow:v1:optIn:usdc`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/mallow/opt-in.ts`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)
- Walletless: unsigned groups only. Canix does not sign or submit.

Compiles a single 0-amount USDC (`31566704`) transfer from the wallet to itself. Submit it before `mainnet:mallow:v1:openLimit:attached` when that shape returns `not-opted-in`.

Already-opted-in wallets are rejected with `already-opted-in`.

## Example

```json
{
  "quotes": [
    {
      "shapeKey": "mainnet:mallow:v1:optIn:usdc",
      "input": {
        "userAddress": "WALLET_ADDRESS"
      }
    }
  ]
}
```
