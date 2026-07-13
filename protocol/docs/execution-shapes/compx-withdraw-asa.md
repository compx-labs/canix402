# CompX v1 ASA Lending Withdraw (execution shape)

- Shape key: `mainnet:compx:v1:withdraw:asa`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/compx/withdraw-asa.ts`
- Supported opportunity types: `lending`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

## Example request

```json
{
  "shapeKey": "mainnet:compx:v1:withdraw:asa",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "marketAppId": 3475099935,
    "amount": "100000"
  }
}
```

`amount` is **LST-denominated**, not base-asset denominated. After a deposit,
withdraw exactly the LST minted by that deposit for a clean roundtrip.

## Expected transaction group

Two or three outer transactions in order:

1. Optional base-asset opt-in when the user is not yet opted into the underlying ASA.
2. LST transfer: user -> market application address.
3. Application call: user -> market app with `withdrawDeposit(axfer,uint64)void`.

## Validation invariants

- Group size is 2 without opt-in, 3 with leading base-asset opt-in.
- LST transfer amount matches the requested withdraw amount.
- App call targets `marketAppId` with the `withdrawDeposit` ARC-4 selector.
- Foreign assets include both base and LST token ids.
- App call fee is at least `250000` microAlgos.

## Caveats

- Requested LST amount must not exceed the user's LST balance.
- ASA-base markets only.
- Quotes expire after 30 seconds.

## Tests

- Integration fixtures: `tests/integration/compx-execution-shapes.test.ts`
- Production live: `tests/live/compx-production-test.test.ts` (`withdraw` / `roundtrip`).
