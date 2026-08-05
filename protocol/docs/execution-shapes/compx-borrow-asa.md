# CompX v1 ASA Lending Borrow (execution shape)

- Shape key: `mainnet:compx:v1:borrow:asa`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/compx/borrow-asa.ts`
- Supported opportunity types: `lending`
- Opportunity role: `enter` (also attached as manage on CompX supplied positions)
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

## Example request

```json
{
  "shapeKey": "mainnet:compx:v1:borrow:asa",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "marketAppId": 3491050310,
    "borrowAmount": "50000",
    "collateralAmount": "100000"
  }
}
```

`borrowAmount` is **base-asset denominated**. `collateralAmount` is **LST-denominated**.
`collateralTokenId` is optional and defaults to the market LST.

## Expected transaction group

Three or four outer transactions in order:

1. Optional base-asset opt-in when the user is not yet opted into the market base ASA.
2. Application call: user -> market app with `gas()void`.
3. LST collateral transfer: user -> market application address.
4. Application call: user -> market app with `borrow(axfer,uint64,uint64,uint64)void`.

## Validation invariants

- Group size is 3 without opt-in, 4 with leading base opt-in.
- Collateral transfer amount matches the requested collateral amount and uses the market LST.
- Borrow app call targets `marketAppId` with the `borrow` ARC-4 selector.
- Borrow app call fee is at least `2000` microAlgos.
- All transactions are atomically grouped and signed only by the user.

## Caveats

- ASA-base markets only; ALGO-base lending markets are rejected.
- Collateral must be the market LST (`collateralTokenId` must match when provided).
- Quotes expire after 30 seconds; recompile before signing stale groups.

## Tests

- Integration fixtures: `tests/integration/compx-execution-shapes.test.ts`
- Production live (x402 + on-chain): `tests/live/compx-production-test.test.ts`
  scenarios `borrow` / `repay` / `credit-roundtrip` (gated by `X402_COMPX_EXECUTION_LIVE=1`).
