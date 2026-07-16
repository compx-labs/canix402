# Haystack v1 HAY Staking Deposit (execution shape)

- Shape key: `mainnet:haystack:v1:stake:hay`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/haystack/stake-hay.ts`
- Supported opportunity types: `staking`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

Haystack single-token staking (TxnLab). Mainnet application `3321763884`; staked asset
HAY (`3160000000`); rewards are paid in USDC (`31566704`) and HAY. This is a distinct
protocol from CompX and does not use the CompX SDK.

## Example request

```json
{
  "shapeKey": "mainnet:haystack:v1:stake:hay",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "amount": "100000000"
  }
}
```

`amount` is the HAY amount in base units (HAY has 6 decimals, so `100000000` = 100 HAY).

## Expected transaction group

For a first-time staker, three outer transactions in order:

1. Staker box MBR payment: user -> staking application address (`37700` microAlgos). This
   is a bare grouped payment the contract inspects; it is not an ABI argument.
2. HAY asset transfer: user -> staking application address. This is the `stakeHay` ABI
   argument (the transaction immediately preceding the app call).
3. Application call: user -> staking app with `stakeHay(axfer)void`.

For a returning staker (box already exists), the MBR payment is omitted and the group is
just the HAY transfer plus the `stakeHay` app call (2 transactions).

Built from `protocol/src/haystack-staking.arc56.json` using `AtomicTransactionComposer`
with `prepareGroupForSending` populating app-call resources (box reference, foreign
assets) and covering the inner oracle transaction fees.

## Validation invariants

- Exactly 3 transactions (new staker) or 2 transactions (returning staker), atomically
  grouped.
- HAY transfer amount matches the requested stake amount and targets the app address.
- MBR payment (when present) equals `37700` microAlgos and targets the app address.
- App call selects `stakeHay(axfer)void`, references the raw-address staker box, and
  includes USDC in foreign assets.

## Caveats

- Single known mainnet pool; the pool must not be paused.
- The staked asset must be HAY and the reward USDC id must match the expected constant.
- User must hold sufficient HAY balance (surfaced as a warning otherwise).
- Quotes expire after 30 seconds.

## Tests

- Integration fixtures: `tests/integration/haystack-execution-shapes.test.ts`
- Route: `tests/integration/execution-quotes-route.test.ts`
- Production live: `tests/live/haystack-staking-production-test.test.ts` (`stake` / `roundtrip`).
