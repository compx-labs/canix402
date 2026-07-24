# Tinyman restake decrease stALGO

- Shape key: `mainnet:tinyman:restake-v1:decreaseStake:stAlgo`
- Role: exit (`staking`)
- Source module: `protocol/src/execution/shapes/tinyman/decrease-stake-stalgo.ts`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)
- Mainnet restake app: `2537022861`
- tALGO asset id: `2537013734`
- stALGO asset id: `2537023208`

Unrestakes stALGO from Tinyman's restaking app and returns tALGO via
`TinymanSTAlgoClient.decreaseStake`.

## Required inputs

- `userAddress`
- `amount` (stALGO base units to unrestake)

## Expected transaction group

SDK decreaseStake group: optional rate-change / tALGO opt-in and
`decrease_stake` app call.

## Caveats

- User must hold enough stALGO for the decrease amount.
- Related manage shape for TINY rewards: `restake-v1:claimRewards:stAlgo`.
