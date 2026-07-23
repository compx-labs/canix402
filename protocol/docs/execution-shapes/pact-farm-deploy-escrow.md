# Pact farm deploy escrow (execution shape)

- Shape key: `mainnet:pact:v1:farm:deployEscrow`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/pact/farm-deploy-escrow.ts`
- Supported opportunity types: `farm`
- Opportunity role: `enter` (setup step)
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

## Example request

```json
{
  "shapeKey": "mainnet:pact:v1:farm:deployEscrow",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "farmAppId": 3625283323
  }
}
```

`farmAppId` may also be supplied as a numeric `poolId` for farm-only shapes.
Farm opportunity ids remain `{farmAppId}:farm`. Enter hints set `farmAppId` and,
when known, the distinct AMM `poolAppId` (not the farm id).

## Expected transaction group

Three outer transactions in order (from `@pactfi/pactsdk` `prepareDeployEscrowTxs`):

1. Payment: user -> Pact gas station (funds escrow creation).
2. Application create: user deploys a personal farm escrow app bound to the farm.
3. Application opt-in: user opts into the farm application.

## Why this is a separate step

The escrow application id is unknown until the create transaction confirms, so
stake cannot be atomic with deploy. After confirm, re-quote
`mainnet:pact:v1:farm:stake` or `mainnet:pact:v1:addLiquidityAndFarm:twoSided`.

## Validation invariants

- Exactly 3 transactions, atomically grouped.
- Create foreign apps include the farm app id; foreign assets include the staked LP asset.
- Opt-in targets the farm app with on-completion OptIn.

## Caveats

- Fails if the user already has an escrow for this farm (skip to stake).
- Quotes expire after 30 seconds; recompile before signing stale groups.

## Tests

- Integration: `tests/integration/execution-quotes-route.test.ts` (mocked)
- Live quote-only: `tests/live/pact-farm-shape-live.test.ts` (`X402_PACT_FARM_SHAPE_LIVE=1`)
