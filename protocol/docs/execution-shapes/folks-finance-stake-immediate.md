# Folks Finance xALGO Immediate Stake (execution shape)

Stakes ALGO into Folks Finance liquid staking and mints xALGO immediately
(`immediate_mint`). Yield accrues in the xALGO/ALGO exchange rate.

- Shape key: `mainnet:folks-finance:xalgo-v1:stake:immediate`
- Source module: `src/execution/shapes/folks-finance/stake-immediate.ts`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)
- Mainnet consensus app: `1134695678`
- xALGO asset id: `1134696561`

## Prerequisites

1. Opt the user wallet into xALGO (`1134696561`) before submit.
2. Hold enough ALGO for the stake amount plus fees.

## Example request

```json
{
  "shapeKey": "mainnet:folks-finance:xalgo-v1:stake:immediate",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "amount": "1000000"
  }
}
```

Optional fields:

- `receiverAddress` — defaults to `userAddress`
- `minReceivedAmount` — minimum xALGO out; defaults to `"0"`
- `includeOpUp` — defaults to `true`

## Expected transaction group

With `includeOpUp: true` (default): OpUp + (optional resource-allocation dummy
calls) + ALGO payment to the consensus app + `immediate_mint` app call.

## Out of scope

Delayed stake / claim-delayed-mint and stake-and-deposit into lending are not
exposed by this shape.

## Related shapes

| Shape | Purpose |
|---|---|
| `unstake:immediate` | Burn xALGO to redeem ALGO |
