# Pact farm claim rewards (execution shape)

- Shape key: `mainnet:pact:v1:farm:claimRewards`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/pact/farm-claim-rewards.ts`
- Supported opportunity types: `farm`
- Opportunity role: `manage`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

## Example request

```json
{
  "shapeKey": "mainnet:pact:v1:farm:claimRewards",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "farmAppId": 3625283323
  }
}
```

## Expected transaction group

Single farm application call from `Escrow.buildClaimRewardsTx()` /
`Farm.buildClaimRewardsTx(escrow)` that pays accrued reward ASAs to the wallet.

## Validation invariants

- Exactly 1 application call to the farm app.
- Foreign apps include the escrow app id.
- Foreign assets include all farm reward asset ids.
- Accounts include the user address.

## Caveats

- Wallet must be opted into each reward ASA; missing opt-ins are surfaced as warnings.
- Requires an existing farm escrow / local state.
- Quotes expire after 30 seconds.

## Tests

- Integration: `tests/integration/execution-quotes-route.test.ts` (mocked)
- Production live: `tests/live/pact-farm-production-test.test.ts` (`X402_PACT_FARM_EXECUTION_LIVE=1`)
