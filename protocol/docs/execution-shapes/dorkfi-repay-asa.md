# Dork.fi v1 ASA Lending Repay (execution shape)

- Shape key: `mainnet:dorkfi:v1:repay:asa`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/dorkfi/repay-asa.ts`
- Supported opportunity types: `lending`
- Opportunity role: `exit`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

## Example request

```json
{
  "shapeKey": "mainnet:dorkfi:v1:repay:asa",
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

The group includes an ASA transfer wrapping through nt200 (`deposit` with `xaid` / `aamt`),
ARC-200 approval for the lending pool, and a lending pool
`repay(market_id, amount)` application call. Dork.fi may add supporting
application calls and funding transactions around those core actions.

## Validation invariants

- Group size is between 2 and 16 transactions.
- Includes a lending pool repay app call on `poolAppId`.
- All transactions are atomically grouped and signed only by the user.

## Caveats

- ASA-backed markets only; native ALGO and ARC-200/WAD paths are rejected.
- User must be opted into the underlying ASA and hold enough balance to repay.
- Quotes expire after 30 seconds; recompile before signing stale groups.

## Tests

- Integration fixtures: `tests/integration/dorkfi-execution-shapes.test.ts`
