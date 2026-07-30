# Alpha Arcade v1 ALPHA Staking Deposit (execution shape)

- Shape key: `mainnet:alpha-arcade:v1:stake:alpha`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/alpha-arcade/stake-alpha.ts`
- Supported opportunity types: `staking`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

Alpha Arcade fee-sharing staking pool. Mainnet application `3626756314`; staked asset
ALPHA (`2726252423`); rewards are paid in USDC (`31566704`). Built to match
`@alpha-arcade/sdk` `stakeAlpha` group ordering (unsigned ATC, empty signer).

## Example request

```json
{
  "shapeKey": "mainnet:alpha-arcade:v1:stake:alpha",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "amount": "10000000"
  }
}
```

`amount` is micro-ALPHA (6 decimals, so `10000000` = 10 ALPHA).

## Expected transaction group

For a first-time staker, three outer transactions in order:

1. Application opt-in: `opt_in()` with OptIn on-completion (funds local-state MBR).
2. ALPHA asset transfer: user -> staking application address.
3. Application call: `stake()` — must immediately follow the ALPHA axfer; foreign USDC.

For a returning staker (already opted in), the opt-in is omitted (2 transactions).

## Validation invariants

- Exactly 3 transactions (new staker) or 2 (returning), atomically grouped when length > 1.
- ALPHA transfer amount matches the requested stake and targets the app address.
- Stake app call selects `stake()uint64` and includes USDC in foreign assets.

## Caveats

- First-time stakers need ~0.2385 ALGO free for app local-state MBR + fees.
- User must hold sufficient ALPHA (surfaced as a warning otherwise).
- Quotes expire after 30 seconds.

## Tests

- Integration fixtures: `tests/integration/alpha-arcade-execution-shapes.test.ts`
- Production live: `tests/live/alpha-arcade-staking-production-test.test.ts`
