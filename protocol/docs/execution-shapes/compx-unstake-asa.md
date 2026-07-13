# CompX v1 ASA Staking Withdraw (execution shape)

- Shape key: `mainnet:compx:v1:unstake:asa`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/compx/unstake-asa.ts`
- Supported opportunity types: `staking`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

## Example request

```json
{
  "shapeKey": "mainnet:compx:v1:unstake:asa",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "poolAppId": 3500000001,
    "amount": "100000"
  }
}
```

## Expected transaction group

One or two outer transactions in order:

1. Optional reward-asset opt-in when the user is not yet opted into the reward ASA.
2. Application call: user -> pool app with `unstake(uint64)void`.

## Validation invariants

- Group size is 1 without opt-in, 2 with leading reward opt-in.
- Unstake quantity is bounded by the resolved staker box balance.
- App call references the staker box and foreign staked/reward assets.
- App call fee is at least `250000` microAlgos.

## Caveats

- User must already have a staker box for the pool.
- Reward opt-in may be required because unstake can deliver accrued rewards.
- Quotes expire after 30 seconds.

## Tests

- Integration fixtures: `tests/integration/compx-execution-shapes.test.ts`
- Production live: `tests/live/compx-production-test.test.ts` (`unstake` / `roundtrip`).
