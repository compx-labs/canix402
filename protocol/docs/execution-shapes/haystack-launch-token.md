# Haystack Launch token (execution shape)

- Shape key: `mainnet:haystack:v1:launch:token`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/haystack/launch-token.ts`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

Creates a 6-decimal ASA on HayLaunch (mainnet app `3452678093`) and a constant-product bonding curve. Canix does not pin images or generate art. Pass an existing `ipfs://` or `https://` `assetUrl`.

## Example request

```json
{
  "shapeKey": "mainnet:haystack:v1:launch:token",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "symbol": "LENIN",
    "name": "Lenin",
    "assetUrl": "ipfs://bafyexample",
    "bondingTokenId": 0,
    "description": "",
    "socialWebsite": "",
    "socialX": "",
    "socialTelegram": "",
    "socialDiscord": "",
    "targetBondingUsd": "0",
    "priceMultiplier": "0"
  }
}
```

`bondingTokenId` `0` is ALGO. Other ids must pass the app's `isBondingTokenSupported` (USDC `31566704` and HAY `3160000000` are supported when the app has opted in). `targetBondingUsd` is micro-USD; `0` uses the contract default. A custom target cannot be below the on-chain `bondingUsd` minimum (currently $2,500) or above $500,000. `priceMultiplier` is scaled by 1e9; `0` means 20x, otherwise 5x–250x.

Optional `initialBuyAmount` is a first buy in the bonding asset, in base units. A first buy that would finish the curve is refused. Graduation does not fit in the launch group.

## Expected transaction group

1. Bonding-asset opt-in, when the asset is not ALGO and the wallet is not opted in.
2. Two `gas()` calls.
3. MBR payment to the HayLaunch app address (`mbrToLaunchToken`, or `mbrToLaunchTokenThenBuy` when there is a first buy).
4. First-buy payment, when `initialBuyAmount` is set: an ALGO payment or a bonding-asset transfer.
5. `launchToken`, `launchTokenThenBuyWithAlgo`, or `launchTokenThenBuy`.

Byte caps: symbol 8, name 32, assetUrl 96, description 1024, website 256, each social 64.
