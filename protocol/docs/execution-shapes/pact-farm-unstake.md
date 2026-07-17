# Pact farm unstake (execution shape)

- Shape key: `mainnet:pact:v1:farm:unstake`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/pact/farm-unstake.ts`
- Supported opportunity types: `farm`
- Opportunity role: `exit`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

## Example request

```json
{
  "shapeKey": "mainnet:pact:v1:farm:unstake",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "farmAppId": 3625283323,
    "amount": "1000000"
  }
}
```

## Expected transaction group

From `Escrow.buildUnstakeTxs(amount)`:

1. Optional gas-station opcode-increase call when needed.
2. Escrow application call that returns staked LP ASA to the wallet.

## Validation invariants

- Final transaction calls the user's escrow app with the farm in foreign apps and
  the staked LP asset in foreign assets.
- Requested amount must not exceed the resolved farm-local staked balance.

## Caveats

- Unstake returns LP to the wallet; it does not remove liquidity from the AMM.
- Quotes expire after 30 seconds.

## Tests

- Integration: `tests/integration/execution-quotes-route.test.ts` (mocked)
- Production live: `tests/live/pact-farm-production-test.test.ts` (`X402_PACT_FARM_EXECUTION_LIVE=1`)
