# Dork.fi v1 ASA Lending Deposit (execution shape)

- Shape key: `mainnet:dorkfi:v1:deposit:asa`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/dorkfi/deposit-asa.ts`
- Supported opportunity types: `lending`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

## Example request

```json
{
  "shapeKey": "mainnet:dorkfi:v1:deposit:asa",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "poolAppId": 3333688282,
    "marketAppId": 3210682240,
    "assetId": 31566704,
    "amount": "100000"
  }
}
```

`amount` is **underlying ASA base units** (micro-USDC for the mainnet USDC market).

## Expected transaction group

Two to sixteen outer transactions built via ulujs `custom()`:

The group includes an ASA transfer into nt200 (`deposit` with `xaid` / `aamt`),
ARC-200 approval for the lending pool, and a lending pool
`deposit(market_id, amount)` application call. Dork.fi may add supporting
application calls and funding transactions around those core actions.

## Validation invariants

- Group size is between 2 and 16 transactions.
- Includes an ASA transfer matching the requested deposit amount.
- Includes a lending pool deposit app call on `poolAppId`.
- All transactions are atomically grouped and signed only by the user.

## Caveats

- ASA-backed markets only; native ALGO and ARC-200/WAD paths are rejected.
- Mainnet beacon app `3209233839` and oracle app `3333688254` are included in builder metadata.
- User must be opted into the underlying ASA.
- Quotes expire after 30 seconds; recompile before signing stale groups.

## Tests

- Integration fixtures: `tests/integration/dorkfi-execution-shapes.test.ts`
- Production live (x402 + on-chain): `tests/live/dorkfi-production-test.test.ts`
  scenarios `deposit` / `roundtrip` (gated by `X402_DORKFI_EXECUTION_LIVE=1`).
