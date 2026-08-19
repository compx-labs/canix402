# CompX v1 ASA Lending Deposit (execution shape)

- Shape key: `mainnet:compx:v1:deposit:asa`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/compx/deposit-asa.ts`
- Supported opportunity types: `lending`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

## Example request

```json
{
  "shapeKey": "mainnet:compx:v1:deposit:asa",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "marketAppId": 3491050310,
    "amount": "100000"
  }
}
```

`amount` is **base-asset denominated** (micro-USDC for the USDC market).

## Expected transaction group

Two or three outer transactions in order:

1. Optional LST opt-in when the user is not yet opted into the market LST.
2. Base ASA transfer: user -> market application address.
3. Application call: user -> market app with `depositASA(axfer,uint64)void`.

## Validation invariants

- Group size is 2 without opt-in, 3 with leading LST opt-in.
- Base transfer amount matches the requested deposit amount.
- App call targets `marketAppId` with the `depositASA` ARC-4 selector.
- App call foreign assets include the market LST token id.
- App call fee is at least `2000` microAlgos.
- All transactions are atomically grouped and signed only by the user.

## Caveats

Protocol-wide CompX construction notes (marketAppId discovery, LST opt-in, active
`contractState`, staker-box MBR): [protocol-caveats.md](./protocol-caveats.md#compx).

- ASA-base markets only; ALGO-base lending markets are rejected.
- Inactive or mismatched market state fails at quote compile time.
- Quotes expire after 30 seconds; recompile before signing stale groups.

## Tests

- Integration fixtures: `tests/integration/compx-execution-shapes.test.ts`
- Production live (x402 + on-chain): `tests/live/compx-production-test.test.ts`
  scenarios `deposit` / `roundtrip` (gated by `X402_COMPX_EXECUTION_LIVE=1`).
