# Myth Finance dualSTAKE Mint LST (execution shape)

Mints a Myth Finance dualSTAKE liquid-staking token.

- Shape key: `mainnet:myth-finance:dualstake-v1:mint:lst`
- Source module: `src/execution/shapes/myth-finance/mint-lst.ts`
- Opportunity role: `enter` for `staking` and `farm`

dualSTAKE is **not** a pure ALGO stake: mint deposits **ALGO plus a small amount
of the paired ASA**. The receipt LST represents a claim on both legs (redeem
returns mostly ALGO and a small ASA amount — not 1:1 ALGO).

## Inputs

```json
{
  "userAddress": "ALGORAND_ADDRESS",
  "amount": "1000000",
  "appId": 3028076093
}
```

- `amount` is ALGO microunits to deposit (the primary leg).
- Paired ASA deposit is derived from the on-chain rate (typically a minor share).
- `appId` / `poolAppId` is the dualSTAKE application id.

## Group structure

1. Optional LST opt-in (axfer amount 0)
2. Mint app call
3. ALGO payment to the dualSTAKE app address
4. Paired ASA transfer to the dualSTAKE app address (when rate > 0)
