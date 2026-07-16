# Haystack v1 HAY Staking Withdraw (execution shape)

- Shape key: `mainnet:haystack:v1:unstake:hay`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/haystack/unstake-hay.ts`
- Supported opportunity types: `staking`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

Haystack single-token staking (TxnLab). Mainnet application `3321763884`; staked asset
HAY (`3160000000`). This shape uses `unstakeHayAndClaim`, so unstaking also pays out any
pending USDC and HAY rewards.

## Example request

```json
{
  "shapeKey": "mainnet:haystack:v1:unstake:hay",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "amount": "100000000"
  }
}
```

`amount` is the HAY amount to unstake in base units (6 decimals).

## Expected transaction group

One or two outer transactions:

1. (Optional) USDC opt-in: user -> user, `0` USDC. Included only when the user is not yet
   opted into USDC (required because this method claims USDC rewards).
2. Application call: user -> staking app with `unstakeHayAndClaim(uint64)(uint64,uint64)`.
   The contract issues inner transfers returning unstaked HAY plus accrued USDC and HAY
   rewards to the user.

Built from `protocol/src/haystack-staking.arc56.json` using `AtomicTransactionComposer`
with `prepareGroupForSending` populating app-call resources (box reference, foreign HAY
and USDC assets) and covering inner transaction fees.

## Validation invariants

- Exactly 1 transaction, or 2 when the USDC opt-in is prefixed.
- App call selects `unstakeHayAndClaim(uint64)(uint64,uint64)`, references the
  raw-address staker box, and includes both HAY and USDC in foreign assets.
- The uint64 amount argument equals the requested amount.

## Caveats

- Requires an existing staker box; `resolveState` rejects unstake for non-stakers.
- The requested amount must not exceed the resolved staked balance.
- Rewards may be zero at execution time; the group still compiles and returns the unstaked
  HAY.
- Use the dedicated claim shape (`mainnet:haystack:v1:claim:rewards`) when you want to
  claim without unstaking.
- Quotes expire after 30 seconds.

## Tests

- Integration fixtures: `tests/integration/haystack-execution-shapes.test.ts`
- Production live: `tests/live/haystack-staking-production-test.test.ts` (`unstake` / `roundtrip`).
