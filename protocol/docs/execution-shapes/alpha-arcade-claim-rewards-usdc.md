# Alpha Arcade v1 Staking USDC Reward Claim (execution shape)

- Shape key: `mainnet:alpha-arcade:v1:claimRewards:usdc`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/alpha-arcade/claim-rewards.ts`
- Supported opportunity types: `staking`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

## Example request

```json
{
  "shapeKey": "mainnet:alpha-arcade:v1:claimRewards:usdc",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS"
  }
}
```

## Expected transaction group

1. Optional USDC ASA opt-in (amount 0) when the user is not opted into USDC.
2. Application call: `claim()` with flat 2000 microAlgo fee; foreign USDC.

## Caveats

- User must be opted into the staking app.
- Quotes expire after 30 seconds.
