# Tinyman restake claim TINY rewards

- Shape key: `mainnet:tinyman:restake-v1:claimRewards:stAlgo`
- Role: manage (`staking`)
- Source module: `protocol/src/execution/shapes/tinyman/claim-rewards-stalgo.ts`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)
- Mainnet restake app: `2537022861`
- TINY asset id: `2200000000`

Claims accrued TINY rewards from Tinyman's tALGO restaking app via
`TinymanSTAlgoClient.claimRewards`.

## Required inputs

- `userAddress`

## Expected transaction group

SDK claimRewards group: optional rate-change / TINY opt-in and `claim_rewards`
app call.

## Caveats

- No amount input; claims the full accrued TINY balance for the user.
- Opt-in to TINY may be included when the wallet is not already opted in.
