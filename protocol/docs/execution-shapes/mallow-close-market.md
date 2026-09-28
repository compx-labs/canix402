# Mallow market close

- Shape key: `mainnet:mallow:v1:close:market`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/mallow/close.ts`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)
- Free position read: `GET /protocols/mallow/positions?address=`
- Walletless: unsigned groups only. Canix does not sign or submit.

Mallow is a perps interface. The close settles on People's Exchange. Canix reads the position and the decrease quote through the Mallow API proxy, then builds the group with `prepareV2DecreaseOrCloseTransactions`. The group includes Mallow's 3 bps builder fee.

## What this shape does

For an open ALGO/USD or BTC/USD position:

1. Checks the wallet is opted into USDC (`31566704`).
2. Loads the wallet's positions and keeps the one whose market, side, and `positionId` match.
3. Reads a signed trading oracle and sets the acceptable price 1% against the close.
4. Quotes a full decrease for that position's `size_usd`.
5. Builds one unsigned group that closes the whole position.

The shape does not take a size. A missing id is `position-not-found`. A different open position on that market and side is `position-replaced`. Do not substitute another id.

Attached take-profit and stop-loss orders are not cancelled.

## Required inputs

- `userAddress`
- `market`: `ALGO` or `BTC`
- `side`: `long` or `short`
- `positionId`: from `GET /protocols/mallow/positions`

## Example

Close ALGO long position `77`:

```json
{
  "quotes": [
    {
      "shapeKey": "mainnet:mallow:v1:close:market",
      "input": {
        "userAddress": "WALLET_ADDRESS",
        "market": "ALGO",
        "side": "long",
        "positionId": "77"
      }
    }
  ]
}
```

Quote metadata includes `positionId`, `sizeUsd`, `acceptablePriceUsd`, `minPrimaryOutput`, `mallowFeeUsd`, and `pexFeeUsd`.

If the wallet is not opted into USDC, the error reason is `not-opted-in`. Compile `mainnet:mallow:v1:optIn:usdc` and submit it before retrying.
