# Tinyman liquid stake mint tALGO

- Shape key: `mainnet:tinyman:liquid-stake-v1:mint:tAlgo`
- Role: enter (`staking`)
- Source module: `protocol/src/execution/shapes/tinyman/mint-talgo.ts`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)
- Mainnet stake app: `2537013674`
- tALGO asset id: `2537013734`

Stakes ALGO into Tinyman's liquid-staking app and mints tALGO via
`TinymanTAlgoClient.mint`.

## Required inputs

- `userAddress`
- `amount` (ALGO base units to stake)

## Expected transaction group

SDK mint group: optional tALGO opt-in, ALGO payment into the stake app, and
`mint` app call.

## Caveats

- Hold enough ALGO for the stake amount plus fees / MBR.
- Yield accrues in the tALGO/ALGO exchange rate.
