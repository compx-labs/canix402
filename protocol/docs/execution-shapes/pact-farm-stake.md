# Pact farm stake (execution shape)

- Shape key: `mainnet:pact:v1:farm:stake`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/pact/farm-stake.ts`
- Supported opportunity types: `farm`
- Opportunity role: `enter`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

## Custody model

Unlike Tinyman farm commit (LP stays in the wallet), Pact Micro Farming moves LP
tokens **out of the wallet** into a per-user farm escrow ASA holding.

## Example request

```json
{
  "shapeKey": "mainnet:pact:v1:farm:stake",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "farmAppId": 3625283323,
    "amount": "1000000"
  }
}
```

Requires a previously deployed escrow (`mainnet:pact:v1:farm:deployEscrow`).

## Expected transaction group

From `Escrow.buildStakeTxs(amount)`:

1. Asset transfer: user -> farm escrow (staked LP ASA leaves the wallet).
2. Optional gas-station opcode-increase call when needed.
3. Farm update application call referencing the escrow.

## Validation invariants

- At least 2 transactions, atomically grouped.
- First txn transfers the farm staked LP asset to the escrow address for `amount`.
- Final txn calls the farm app with escrow in foreign apps/accounts.

## Caveats

- Wallet must hold at least `amount` of the LP ASA.
- User must already have farm local state / escrow; otherwise quote returns a state error pointing at deployEscrow.
- Amounts must fit JavaScript safe integers for the Pact SDK builders.

## Tests

- Integration: `tests/integration/execution-quotes-route.test.ts` (mocked)
- Live quote-only: `tests/live/pact-farm-shape-live.test.ts` (`X402_PACT_FARM_SHAPE_LIVE=1`)
- Production live: `tests/live/pact-farm-production-test.test.ts` (`X402_PACT_FARM_EXECUTION_LIVE=1`)
