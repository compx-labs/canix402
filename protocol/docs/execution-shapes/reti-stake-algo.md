# Réti stake ALGO

- Shape key: `mainnet:reti:v1:stake:algo`
- Protocol: `reti` / `v1`
- Role: enter (staking)
- Required inputs: `userAddress`, `validatorId`, `amount`
- Optional inputs: `valueToVerify` (gate ASA id or NFD app id; required when the validator is gated)

## Behavior

Stakes ALGO to a Réti **validator** via `ValidatorRegistry.addStake`. The registry
allocates the stake into one of that validator's pools.

Group (unsigned):

1. `gas()` on the registry (opcode budget)
2. `gas()` on the registry
3. ALGO payment to the registry app address + `addStake(payment, validatorId, valueToVerify)`
4. Optional reward-token ASA opt-in when the validator pays an extra reward ASA

## Eligibility (quote-time)

- `amount >= minEntryStake`
- Validator `capacity.acceptingStake`
- Gating:
  - none → `valueToVerify` may be `0`
  - ASA gates → `valueToVerify` must be one of the gate ASA ids (auto-picked when exactly one)
  - creator / NFD gates → `valueToVerify` must be supplied by the agent

## Source

algorandfoundation/reti `ValidatorRegistry.addStake`
