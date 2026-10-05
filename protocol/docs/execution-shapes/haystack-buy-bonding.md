# Haystack Launch bonding buy (execution shape)

- Shape key: `mainnet:haystack:v1:buy:bonding`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/haystack/buy-bonding.ts`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

Buys a token that is still on the HayLaunch curve (`bondingOn = 0`). This is not the swap SKU. Haystack's own router fee still applies inside a routed leg. The bought balance is virtual (`userHoldings`) until claim. The shape does not opt the wallet into the launched ASA.

List tokens with paid `GET /protocols/haystack/launches`. Read one token, free, at `GET /protocols/haystack/launches/{tokenNum}`.

## Example request

```json
{
  "shapeKey": "mainnet:haystack:v1:buy:bonding",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "tokenNum": 175,
    "fromAssetId": 0,
    "amount": "1000000",
    "slippageBps": 50
  }
}
```

Pass `tokenNum`, or `assetId` after the first buy has written the asset map. `fromAssetId` `0` is ALGO. `amount` is base units of `fromAssetId`. `slippageBps` is 0–10000.

## Direct buy

When `fromAssetId` is the token's bonding asset:

1. Bonding-asset opt-in, when required.
2. MBR payment from `mbrToBuy` (0.0225 ALGO on the first buy for that wallet; 0 after the holding box exists).
3. Payment of `amount` in the bonding asset.
4. `buyWithLimit` or `buyWithAlgoWithLimit`. `minTokensOut` is `tokensReceivedForBuy` minus slippage.

A direct buy may be the one that graduates the token into its Pact pool.

## Routed buy

Any other `fromAssetId` is quoted through the Haystack router only, fixed-input into the bonding asset. The group is the router transactions, then the MBR payment, a bonding-asset payment of the router's guaranteed minimum output, and `buyWithLimit`. Surplus bonding asset stays on the wallet.

A routed buy that would take 90% or more of the remaining real token reserves is refused. Pay in the bonding asset for that completing buy, because graduation also creates the Pact pool.

## Graduated tokens

`bondingOn` other than 0 is refused. Buy the ASA with `POST /swaps/quote`.
