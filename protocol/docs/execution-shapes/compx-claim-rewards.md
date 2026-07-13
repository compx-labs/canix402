# CompX v1 Staking Reward Claim (execution shape)

- Shape key: `mainnet:compx:v1:claim:rewards`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/compx/claim-rewards.ts`
- Supported opportunity types: `staking`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

## Example request

```json
{
  "shapeKey": "mainnet:compx:v1:claim:rewards",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "poolAppId": 3500000001
  }
}
```

No `amount` input — the contract pays accrued rewards for the resolved staker box.

## Expected transaction group

One or two outer transactions in order:

1. Optional reward-asset opt-in when the user is not yet opted into the reward ASA.
2. Application call: user -> pool app with `claimRewards()void`.

## Validation invariants

- Group size is 1 without opt-in, 2 with leading reward opt-in.
- App call references the staker box and foreign reward asset.
- App call fee is at least `250000` microAlgos.

## Caveats

- User must already have a staker box for the pool.
- Production claim tests run only when accrued rewards exist.
- Quotes expire after 30 seconds.

## Tests

- Integration fixtures: `tests/integration/compx-execution-shapes.test.ts`
- Production live: `tests/live/compx-production-test.test.ts` (`claim` scenario when rewards exist).
