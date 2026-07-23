# Réti unstake ALGO

- Shape key: `mainnet:reti:v1:unstake:algo`
- Protocol: `reti` / `v1`
- Role: exit (staking positions)
- Required inputs: `userAddress`, `validatorId`, `poolAppId`, `amount`

## Behavior

Removes ALGO from a specific Réti **staking pool** via `StakingPool.removeStake`.

Group (unsigned):

1. `gas()` on the pool app
2. `gas()` on the pool app
3. `removeStake(staker, amountToUnstake)`
4. Optional reward-token ASA opt-in

## Eligibility (quote-time)

- Staker must have a positive ledger balance in `poolAppId`
- `amount <= stakedBalance`
- Partial unstake must leave `0` or `>= minEntryStake`

## Source

algorandfoundation/reti `StakingPool.removeStake`
