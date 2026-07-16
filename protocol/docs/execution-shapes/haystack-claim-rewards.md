# Haystack v1 Staking Reward Claim (execution shape)

- Shape key: `mainnet:haystack:v1:claim:rewards`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/haystack/claim-rewards.ts`
- Supported opportunity types: `staking`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

Haystack single-token staking (TxnLab). Mainnet application `3321763884`. Rewards are
paid in USDC (`31566704`) and HAY (`3160000000`).

## Example request

```json
{
  "shapeKey": "mainnet:haystack:v1:claim:rewards",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS"
  }
}
```

## Expected transaction group

One or two outer transactions:

1. (Optional) USDC opt-in: user -> user, `0` USDC. Included only when the user is not yet
   opted into USDC.
2. Application call: user -> staking app with `claim()(uint64,uint64)`. The contract
   issues inner transfers paying accrued USDC and HAY to the user.

Built from `protocol/src/haystack-staking.arc56.json` using `AtomicTransactionComposer`
with `prepareGroupForSending` populating app-call resources (box reference, foreign USDC
and HAY assets) and covering inner transaction fees.

## Validation invariants

- Exactly 1 transaction, or 2 when the USDC opt-in is prefixed.
- App call selects `claim()(uint64,uint64)`, references the raw-address staker box, and
  includes both USDC and HAY in foreign assets.
- The opt-in (when present) is a zero-amount USDC transfer to the user.

## Caveats

- Requires an existing staker box; `resolveState` rejects claims for non-stakers.
- HAY opt-in is assumed (the user already holds/stakes HAY); only the USDC opt-in is
  auto-prefixed when needed.
- Prefer the unstake shape (`mainnet:haystack:v1:unstake:hay`) when exiting a position;
  it uses `unstakeHayAndClaim` and pays rewards in the same call.
- Rewards may be zero at execution time; the group still compiles.
- Quotes expire after 30 seconds.

## Tests

- Integration fixtures: `tests/integration/haystack-execution-shapes.test.ts`
- Production live: `tests/live/haystack-staking-production-test.test.ts` (`claim`).
