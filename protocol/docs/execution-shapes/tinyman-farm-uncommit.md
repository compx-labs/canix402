# Tinyman farm uncommit

- Shape key: `mainnet:tinyman:staking-v1:farm:uncommit`
- Role: exit (`farm`)
- Source module: `protocol/src/execution/shapes/tinyman/farm-uncommit.ts`

Lowers or clears a Tinyman farm commitment by calling `prepareCommitTransactions`
with an absolute commitment amount. Use `commitAmount: 0` to fully uncommit.
LP tokens remain in the wallet.

## Required inputs

- `userAddress`
- `commitAmount` (non-negative base units; `0` allowed)
- `liquidityAssetId` **or** `assetAId` + `assetBId`
- Optional overrides: `programId` + `programAccount`, `requiredAssetId`, `poolId`

## Caveats

- Mid-cycle uncommit may forfeit unpaid rewards for the current farm cycle.
- Same commit builder as enter; only the amount semantics differ (zero allowed).
