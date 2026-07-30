# Alpha Arcade v1 ALPHA Staking Withdraw (execution shape)

- Shape key: `mainnet:alpha-arcade:v1:unstake:alpha`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/alpha-arcade/unstake-alpha.ts`
- Supported opportunity types: `staking`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

## Example request

```json
{
  "shapeKey": "mainnet:alpha-arcade:v1:unstake:alpha",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "amount": "5000000"
  }
}
```

## Expected transaction group

Single application call: `unstake(uint64)` with flat 2000 microAlgo fee. Foreign assets
include USDC and ALPHA. The contract inner-transfers ALPHA back to the caller.

## Caveats

- User must be opted into the staking app with sufficient staked balance.
- Quotes expire after 30 seconds.
