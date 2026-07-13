# Pact v1 Proportional Remove Liquidity (execution shape)

- Shape key: `mainnet:pact:v1:removeLiquidity:proportional`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/pact/remove-liquidity-proportional.ts`
- Supported opportunity types: `lp`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

## Example request

```json
{
  "shapeKey": "mainnet:pact:v1:removeLiquidity:proportional",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "poolAppId": 1072843805,
    "poolTokenAmount": "50000"
  }
}
```

## Expected transaction group

Two outer transactions in order:

1. LP token transfer: user -> pool escrow for the requested LP amount.
2. Application call: user -> Pact pool app with `REMLIQ` and minimum output args.

## SDK limitation (important)

`@pactfi/pactsdk` v0.8.1 `buildRemoveLiquidityTxs` hard-codes REMLIQ minimum
primary/secondary outputs as `0` / `0`. Canix surfaces a quote warning because
on-chain slippage protection is not encoded in the unsigned group. Review
expected outputs from quote metadata and pool state before signing.

## Validation invariants

- Exactly 2 transactions, atomically grouped.
- LP transfer uses the pool liquidity asset id and escrow receiver.
- App call targets `poolAppId` with first arg `REMLIQ` and fee >= 3000 microAlgos.
- Foreign assets include both pool assets.

## Tests

- Integration fixtures: `tests/integration/pact-liquidity-shapes.test.ts`
- Production live: `tests/live/pact-production-test.test.ts` scenarios `remove`
  / `roundtrip`, gated by `X402_PACT_EXECUTION_LIVE=1`.
