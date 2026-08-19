# Dork.fi v1 ASA Lending Borrow (execution shape)

- Shape key: `mainnet:dorkfi:v1:borrow:asa`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/dorkfi/borrow-asa.ts`
- Supported opportunity types: `lending`
- Opportunity role: `enter` (also attached as manage on Dork.fi ASA supplied positions)
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

## Example request

```json
{
  "shapeKey": "mainnet:dorkfi:v1:borrow:asa",
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

The group includes a lending pool `borrow(market_id, amount)` application call and an
nt200 unwrap that delivers underlying ASA to the user. Dork.fi may add supporting
application calls and funding transactions around those core actions.

## Validation invariants

- Group size is between 2 and 16 transactions.
- Includes a lending pool borrow app call on `poolAppId`.
- All transactions are atomically grouped and signed only by the user.

## Caveats

- ASA-backed markets only; native ALGO and ARC-200/WAD paths are rejected.
- Requires existing collateral in the pool; health factor is not enforced client-side.
- User must be opted into the underlying ASA. The group does **not** include that opt-in.
- Empty-user `get_user` simulate is zero debt, not a coverage gap — borrow still
  needs collateral from a prior deposit. See
  [protocol-caveats.md](./protocol-caveats.md#empty-user-simulate-prs-79--80).
- Quotes expire after 30 seconds; recompile before signing stale groups.

## Tests

- Integration fixtures: `tests/integration/dorkfi-execution-shapes.test.ts`
