# CompX v1 ASA Staking Deposit (execution shape)

- Shape key: `mainnet:compx:v1:stake:asa`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/compx/stake-asa.ts`
- Supported opportunity types: `staking`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

## Example request

```json
{
  "shapeKey": "mainnet:compx:v1:stake:asa",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "poolAppId": 3500000001,
    "amount": "100000"
  }
}
```

## Expected transaction group

Three outer transactions in order:

1. Staked ASA transfer: user -> pool application address.
2. Staker box MBR payment: user -> pool application address (`22500` microAlgos for
   first-time stakers; `0` for existing stakers with a box).
3. Application call: user -> pool app with `stake(axfer,uint64,pay)void`.

Built from `protocol/src/staking.arc56.json` using `AtomicTransactionComposer` and
simulation-derived app-call resources/fees.

## Validation invariants

- Exactly 3 transactions, atomically grouped.
- Staked transfer amount matches the requested stake amount.
- MBR payment matches the resolved new/existing staker requirement.
- App call references the `st` + address staker box and foreign staked/reward assets.
- App call fee is at least `250000` microAlgos.

## Caveats

- ASA-staked pools only.
- Pool must be active, initialized, funded, and not ended.
- User must hold sufficient staked ASA balance.
- Quotes expire after 30 seconds.

## Tests

- Integration fixtures: `tests/integration/compx-execution-shapes.test.ts`
- Production live: `tests/live/compx-production-test.test.ts` (`stake` / `roundtrip`).
