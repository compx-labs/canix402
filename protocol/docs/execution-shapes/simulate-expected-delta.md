# Simulate / expected delta

- Paid API: `POST /execution/simulate` (0.10 USDC)
- MCP: `canix_simulate_execution`
- Walletless: unsigned groups only. Canix does not sign or submit.

Given compiled group(s) from `POST /plans`, `POST /plans/rebalance`,
`POST /execution/quotes`, or `POST /execution/compose`, returns predicted wallet
balance deltas and position deltas. The same summary is attached on
`POST /plans` (and rebalance) as `data.simulation` when compiled groups exist.

## Request

```json
{
  "address": "<wallet>",
  "groups": [
    {
      "shapeKey": "mainnet:reti:v1:stake:algo",
      "expiresAt": "2026-08-21T12:00:30.000Z",
      "opportunityId": "reti-staking-12",
      "transactions": [],
      "encodedTransactions": ["<base64 unsigned txn>"]
    }
  ]
}
```

Prefer the `transactions[]` view from an `ExecutableQuote`. If only
`encodedTransactions` are supplied, Canix decodes unsigned bytes locally.

## Fail closed

`wouldSucceed` is true only when every group is proven safe. Machine-readable
`reasons[].code` values:

| Code | Meaning |
| --- | --- |
| `stale-quote` | `expiresAt` has passed |
| `not-opted-in` | Group spends or receives an ASA the wallet is not opted into |
| `min-balance` | Predicted ALGO is below spend, fees, or estimated minimum balance |
| `health-factor-too-low` | Borrow group with missing HF or HF ≤ 1 |
| `capacity` | Réti stake is not accepting, has no slots, or lacks ALGO room — or capacity is unknown |
| `insufficient-balance` | ASA spend exceeds the held balance |
| `malformed-group` | Group cannot be decoded |
| `holdings-unavailable` | Wallet holdings could not be read |

Simulation never sets `signed` or `submitted` to true.
`meta.executionSubmitted` is always `false`.

## Agent loop

1. Compile with `canix_get_plan` / `canix_get_execution_quote` (unsigned groups)
2. Review `data.simulation` on the plan, or call `canix_simulate_execution`
3. If `wouldSucceed` is false, do not sign — publish `reasons[]`
4. Sign only user legs locally and submit before `expiresAt`
