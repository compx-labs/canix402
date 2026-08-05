# CompX v1 ASA Lending Repay (execution shape)

- Shape key: `mainnet:compx:v1:repay:asa`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/compx/repay-asa.ts`
- Supported opportunity types: `lending`
- Opportunity role: `exit` (attached to CompX debt positions)
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

## Example request

```json
{
  "shapeKey": "mainnet:compx:v1:repay:asa",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "marketAppId": 3491050310,
    "amount": "50000"
  }
}
```

`amount` is **base-asset denominated** (the borrowed asset being repaid).

## Expected transaction group

Exactly two outer transactions in order:

1. Base ASA transfer: user -> market application address.
2. Application call: user -> market app with `repayLoanASA(axfer,uint64)void`.

## Validation invariants

- Group size is exactly 2.
- Base transfer amount matches the requested repay amount.
- App call targets `marketAppId` with the `repayLoanASA` ARC-4 selector.
- App call fee is at least `2000` microAlgos.
- All transactions are atomically grouped and signed only by the user.

## Caveats

- ASA-base markets only; ALGO-base lending markets are rejected.
- Quotes expire after 30 seconds; recompile before signing stale groups.

## Tests

- Integration fixtures: `tests/integration/compx-execution-shapes.test.ts`
- Production live (x402 + on-chain): `tests/live/compx-production-test.test.ts`
  scenarios `borrow` / `repay` / `credit-roundtrip` (gated by `X402_COMPX_EXECUTION_LIVE=1`).
