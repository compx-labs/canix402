# Mallow cancel resting order

- Shape key: `mainnet:mallow:v1:cancelOrder:resting`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/mallow/cancel-order.ts`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)
- Wallet snapshot: `GET /positions?address=` includes the order and `ownerOrderId`
- Walletless: unsigned groups only. Canix does not sign or submit.

Mallow is a perps interface. The cancel settles on People's Exchange. Canix reads the wallet's orders through the Mallow API proxy, then builds the group with `buildV2CancelOrderTransactions`. The builder fee is not part of a cancel.

## What this shape does

For one resting ALGO/USD or BTC/USD order that posts USDC:

1. Loads that order and refuses it when another wallet owns it, or when it is not an ALGO or BTC USDC order.
2. When the order is an open limit with attached children, the group includes those take-profit and stop-loss box ids so the bracket cancels together.
3. A lone child, including a take-profit or stop-loss left behind after a close, cancels by its own id.

## Required inputs

- `userAddress`
- `ownerOrderId`: from the `mallow:order:{ownerOrderId}` row on `GET /positions`

## Example

Cancel resting order `880000000001`:

```json
{
  "quotes": [
    {
      "shapeKey": "mainnet:mallow:v1:cancelOrder:resting",
      "input": {
        "userAddress": "SENDER_ADDRESS",
        "ownerOrderId": "880000000001"
      }
    }
  ]
}
```

## Out of scope

Partial closes, margin deposits, and margin withdrawals. A third party cancelling an expired order. Markets other than ALGO and BTC.
