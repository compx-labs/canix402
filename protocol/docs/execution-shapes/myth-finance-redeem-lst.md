# Myth Finance dualSTAKE Redeem LST (execution shape)

Redeems a Myth Finance dualSTAKE liquid-staking token for mostly ALGO plus a small amount of the paired ASA (not 1:1 ALGO).

- Shape key: `mainnet:myth-finance:dualstake-v1:redeem:lst`
- Source module: `src/execution/shapes/myth-finance/redeem-lst.ts`
- Opportunity role: `exit` for `staking` and `farm`

The LST is **not** 1:1 with ALGO. Burning LST pays out **mostly ALGO** plus a
**small amount of the paired ASA** (amounts follow the on-chain redeem rate).
Users must be opted into the paired ASA to receive that leg.

## Inputs

```json
{
  "userAddress": "ALGORAND_ADDRESS",
  "amount": "1000000",
  "appId": 3028076093
}
```

- `amount` is LST base units to burn (wallet LST balance is the position size).
- `appId` / `poolAppId` is the dualSTAKE application id.
- ALGO and ASA redeem amounts are derived on-chain from that LST amount; do not
  treat `amount` as microALGO 1:1.

## Group structure

1. Optional paired-ASA opt-in (axfer amount 0) — required to receive the ASA leg
2. LST transfer to the dualSTAKE app address
3. Redeem app call (app sends ALGO + paired ASA to the user)
