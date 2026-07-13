# Pact v1 Two-Sided Add Liquidity (execution shape)

- Shape key: `mainnet:pact:v1:addLiquidity:twoSided`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/pact/add-liquidity-two-sided.ts`
- Supported opportunity types: `lp`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

## Example request

```json
{
  "shapeKey": "mainnet:pact:v1:addLiquidity:twoSided",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "poolAppId": 1072843805,
    "assetAId": 31566704,
    "assetAAmount": "100000",
    "assetBId": 0,
    "assetBAmount": "50000",
    "maxSlippageBps": 50
  }
}
```

## Expected transaction group

Three outer transactions in order:

1. Primary asset deposit: user -> pool escrow.
2. Secondary asset deposit: user -> pool escrow (ALGO payment when primary is ALGO).
3. Application call: user -> Pact pool app with `ADDLIQ` and minimum LP mint arg.

Pact ordering uses **primary = lower asset id** and **secondary = higher asset id**.
For ALGO/USDC, primary is ALGO (`0`) and secondary is USDC (`31566704`). Caller
`assetA`/`assetB` inputs are mapped to primary/secondary automatically.

## Validation invariants

- Exactly 3 transactions, atomically grouped.
- Deposits target the pool escrow address with requested amounts.
- App call targets `poolAppId` with first arg `ADDLIQ`.
- Foreign assets include primary, secondary, and LP token ids.

## Caveats

- User must be opted into the LP token ASA before receiving minted liquidity.
- First liquidity into an empty pool must satisfy `sqrt(a*b) - 1000 > 0`; 1000 LP
  tokens are permanently locked on initial mint.
- Amounts must fit in JavaScript safe integers for the Pact SDK builders.
- Quotes expire after 30 seconds; recompile before signing stale groups.

## Tests

- Integration fixtures: `tests/integration/pact-liquidity-shapes.test.ts`
- Production live (x402 + on-chain): `tests/live/pact-production-test.test.ts`
  scenarios `add` / `roundtrip` (0.1 USDC + balanced ALGO/USDC, gated by
  `X402_PACT_EXECUTION_LIVE=1`).
