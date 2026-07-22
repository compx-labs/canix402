# Tinyman farm claim rewards

- Shape key: `mainnet:tinyman:staking-v1:farm:claimRewards`
- Role: manage (`farm`)
- Source module: `protocol/src/execution/shapes/tinyman/farm-claim-rewards.ts`

Claims unpaid Tinyman farm rewards. Transaction bytes are prepared by Tinyman
Analytics (`POST /staking/rewards/prepare-claim-transactions/`). Canix returns
the unsigned group for local signing and does **not** call the Analytics submit
endpoint.

## Required inputs

- `userAddress` (pooler address)
- `programId`
- `poolAddress`

## Caveats

- Depends on Tinyman Analytics availability and response format.
- Always inspect the returned group before signing.
