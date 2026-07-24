# Tinyman restake increase stALGO

- Shape key: `mainnet:tinyman:restake-v1:increaseStake:stAlgo`
- Role: enter (`staking`)
- Source module: `protocol/src/execution/shapes/tinyman/increase-stake-stalgo.ts`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)
- Mainnet restake app: `2537022861`
- tALGO asset id: `2537013734`
- stALGO asset id: `2537023208`

Restakes tALGO into Tinyman's restaking app and mints stALGO via
`TinymanSTAlgoClient.increaseStake`.

## Required inputs

- `userAddress`
- `amount` (tALGO base units to restake)

## Expected transaction group

SDK increaseStake group: optional rate-change / box MBR / stALGO opt-in, tALGO
transfer, and `increase_stake` app call.

## Caveats

- User must already hold tALGO (mint via `liquid-stake-v1:mint:tAlgo` first).
- Opt-in / MBR steps may be included when needed; inspect the returned group.
