# Dork.fi v1 ASA Lending Withdraw (execution shape)

- Shape key: `mainnet:dorkfi:v1:withdraw:asa`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/dorkfi/withdraw-asa.ts`
- Supported opportunity types: `lending`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

## Example request

```json
{
  "shapeKey": "mainnet:dorkfi:v1:withdraw:asa",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "poolAppId": 3333688282,
    "marketAppId": 3210682240,
    "assetId": 31566704,
    "amount": "100000"
  }
}
```

`amount` is **nToken-denominated** (ARC-200 units on the market nt200 contract), not underlying ASA units.

## Expected transaction group

Two to three outer transactions built via ulujs `custom()`:

1. Lending pool `withdraw(market_id, amount)` application call.
2. nt200 `withdraw` unwrap to return underlying ASA to the user.
3. Optional box-funding transaction when required by simulation.

## Validation invariants

- Group size is between 2 and 3 transactions.
- Includes a lending pool withdraw app call on `poolAppId`.
- All transactions are atomically grouped and signed only by the user.
- Metadata may include `expectedUnderlyingAmount` from on-chain withdraw simulation.

## Caveats

- ASA-backed markets only; native ALGO and ARC-200/WAD paths are rejected.
- Withdraw amount must not exceed the wallet's nToken ARC-200 balance.
- Underlying ASA received may differ slightly from a naive 1:1 estimate due to index accrual.
- A naked `withdraw` simulate (without the ulujs custom group) often fails;
  positions use nToken × deposit index instead. See
  [protocol-caveats.md](./protocol-caveats.md#dorkfi).
- Quotes expire after 30 seconds; recompile before signing stale groups.

## Tests

- Integration fixtures: `tests/integration/dorkfi-execution-shapes.test.ts`
- Production live (x402 + on-chain): `tests/live/dorkfi-production-test.test.ts`
  scenarios `withdraw` / `roundtrip` (gated by `X402_DORKFI_EXECUTION_LIVE=1`).
