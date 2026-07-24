# Tinyman farm commit

- Shape key: `mainnet:tinyman:staking-v1:farm:commit`
- Role: enter (`farm`)
- Source module: `protocol/src/execution/shapes/tinyman/farm-commit.ts`

Commits an absolute LP amount into a Tinyman farm via
`prepareCommitTransactions`. LP tokens remain in the wallet; the farm tracks
the committed balance. Tinyman farms stake the full LP balance (no partial
stake semantics beyond the absolute commit amount).

## Required inputs

- `userAddress`
- `commitAmount` (positive base units; must not exceed wallet LP balance)
- `liquidityAssetId` **or** `assetAId` + `assetBId`
- Optional overrides: `programId` + `programAccount`, `requiredAssetId`, `poolId`

## Expected transaction group

SDK commit group: optional required-asset transfer (when the farm requires one)
plus the staking-app commit / log-balance app calls.

## Caveats

- Mid-cycle commit changes may affect unpaid rewards for the current farm cycle.
- Same commit builder as uncommit; only the amount semantics differ (must be > 0).
