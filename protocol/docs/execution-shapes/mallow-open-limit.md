# Mallow open limit with take-profit and stop-loss

- Shape key: `mainnet:mallow:v1:openLimit:attached`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/mallow/open-limit.ts`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)
- Free market read: `GET /protocols/mallow/markets`
- Walletless: unsigned groups only. Canix does not sign or submit.

Mallow is a perps interface. The order settles on People's Exchange. Canix reads the market and the order quote through the Mallow API proxy, then builds the group with the PEX SDK. The group includes Mallow's 3 bps builder fee.

## What this shape does

For an ALGO/USD or BTC/USD limit:

1. Checks the wallet is opted into USDC (`31566704`).
2. Resolves the pair, max leverage, and signed index.
3. Quotes the limit on the Mallow proxy.
4. Places take-profit and stop-loss from return-on-margin percents.
5. Builds one unsigned group. A limit still beyond the index rests, with both attached orders, storage funding, and keeper fees. A limit already through the index opens at market, with the same take-profit and stop-loss. Quote metadata `openedAsMarket` is true in that case.

`collateralUsd` is USDC margin. Notional is `collateralUsd × leverage`. `takeProfitPct: 20` and `stopLossPct: 25` mean +20% and −25% on that margin. At 10×, those are about a 2% and 2.5% price move.

## Required inputs

- `userAddress`
- `market`: `ALGO` or `BTC`
- `side`: `long` or `short`
- `collateralUsd`: USDC margin, greater than 0
- `leverage`: integer, at or below the market maximum from `GET /protocols/mallow/markets`
- `entryPriceUsd`: limit trigger in USD
- `takeProfitPct`: profit on margin, for example `20`
- `stopLossPct`: loss on margin as a positive number, for example `25`

## Example

An ALGO long, 10×, $25 of USDC margin, limit at $0.10, take profit +20%, stop loss −25%:

```json
{
  "quotes": [
    {
      "shapeKey": "mainnet:mallow:v1:openLimit:attached",
      "input": {
        "userAddress": "WALLET_ADDRESS",
        "market": "ALGO",
        "side": "long",
        "collateralUsd": 25,
        "leverage": 10,
        "entryPriceUsd": 0.1,
        "takeProfitPct": 20,
        "stopLossPct": 25
      }
    }
  ]
}
```

The same input with `"market": "BTC"` and an `entryPriceUsd` on the BTC scale is a BTC order.

Quote metadata includes `entryPriceUsd`, `takeProfitPriceUsd`, `stopLossPriceUsd`, `liquidationPriceUsd`, `mallowFeeUsd`, `keeperFeeAmount`, and `storageMicroAlgo`.

If the wallet is not opted into USDC, the error reason is `not-opted-in`. Compile `mainnet:mallow:v1:optIn:usdc` and submit it before retrying.
