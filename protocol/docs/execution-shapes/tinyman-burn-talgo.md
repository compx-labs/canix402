# Tinyman liquid stake burn tALGO

- Shape key: `mainnet:tinyman:liquid-stake-v1:burn:tAlgo`
- Role: exit (`staking`)
- Source module: `protocol/src/execution/shapes/tinyman/burn-talgo.ts`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)
- Mainnet stake app: `2537013674`
- tALGO asset id: `2537013734`

Burns tALGO to redeem ALGO from Tinyman's liquid-staking app via
`TinymanTAlgoClient.burn`.

## Required inputs

- `userAddress`
- `amount` (tALGO base units to burn)

## Expected transaction group

SDK burn group: tALGO transfer into the stake app and `burn` app call.

## Caveats

- User must hold enough tALGO for the burn amount.
- Related enter shape: `mainnet:tinyman:liquid-stake-v1:mint:tAlgo`.
