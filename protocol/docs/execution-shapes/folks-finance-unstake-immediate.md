# Folks Finance xALGO Immediate Unstake (execution shape)

Burns xALGO to redeem ALGO from Folks Finance liquid staking immediately
(`burn`).

- Shape key: `mainnet:folks-finance:xalgo-v1:unstake:immediate`
- Source module: `src/execution/shapes/folks-finance/unstake-immediate.ts`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)
- Mainnet consensus app: `1134695678`
- xALGO asset id: `1134696561`

## Prerequisites

1. Hold enough xALGO in the user wallet for the burn amount.
2. Hold enough ALGO for fees.

## Example request

```json
{
  "shapeKey": "mainnet:folks-finance:xalgo-v1:unstake:immediate",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "amount": "1000000"
  }
}
```

Optional fields:

- `receiverAddress` — defaults to `userAddress` (ALGO recipient)
- `minReceivedAmount` — minimum ALGO out; defaults to `"0"`
- `includeOpUp` — defaults to `true`

## Expected transaction group

With `includeOpUp: true` (default): OpUp + (optional resource-allocation dummy
calls) + xALGO transfer to the consensus app + `burn` app call.

## Out of scope

Delayed stake / claim-delayed-mint and stake-and-deposit into lending are not
exposed by this shape.

## Related shapes

| Shape | Purpose |
|---|---|
| `stake:immediate` | Stake ALGO to mint xALGO |
